import { rmSync } from 'fs';
import { tmpdir } from 'os';
import { reassignChoices } from '../capture/queue-row';
import { captureVault, jpeg } from '../test-support/capture';
import { addCar, fieldOf, ownerApi } from '../test-support/kinds';
import { nodeSqlDb } from '../test-support/node-sqlite';
import { commitCapture, type CommitDeps } from './commit';
import { filedWithout, type QueueItem } from './item';
import { SqliteQueueStore } from './sqlite-store';
import { MemoryQueueStore, type QueueStore } from './store';
import { Uploader } from './uploader';

const ORIGIN = 'https://vault.test';

function phone(store: QueueStore) {
  const disk = new Map<string, Uint8Array>([
    ['cache:/scan/1.jpg', jpeg('letter-with-exif.jpg')],
    ['cache:/scan/2.jpg', jpeg('card.jpg')],
  ]);
  let n = 0;
  const deps: CommitDeps = {
    store,
    read: async (uri) => disk.get(uri) ?? Promise.reject(new Error(uri)),
    discard: async (uri) => {
      disk.delete(uri);
    },
    uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    now: () => 1_000,
  };
  return deps;
}

const PAGES = { kind: 'pages' as const, pages: [{ uri: 'cache:/scan/1.jpg' }, { uri: 'cache:/scan/2.jpg' }] };

describe('the queue in airplane mode', () => {
  it('saved offline with details, sent later with the same key', async () => {
    const store = new MemoryQueueStore();
    const item = await commitCapture(
      {
        source: PAGES,
        metadata: { type_key: 'passport', title: "Aisha's passport", owner_member_id: 'fake-member', visibility: 'household' },
        origin: ORIGIN,
        account: 'fake-member',
      },
      phone(store),
    );
    const cv = await captureVault();
    cv.turns.push('offline', 'offline', 'offline');
    const keys: string[] = [];
    let now = 0;
    const base = cv.deps(store);
    const uploader = new Uploader(
      cv.deps(store, {
        now: () => now,
        send: (i, b) => {
          keys.push(i.key);
          return base.send(i, b);
        },
      }),
    );
    for (let i = 0; i < 3; i += 1) {
      await uploader.kick();
      now += 1;
    }
    expect(await store.list()).toEqual([expect.objectContaining({ state: 'waiting', lastCode: 'offline' })]);
    // Online again: straight away, not after the backoff.
    cv.turns.length = 0;
    await uploader.kick({ fresh: true });
    expect(cv.vault.state.documents).toEqual([
      expect.objectContaining({ title: "Aisha's passport", type_key: 'passport', owner_member_id: 'fake-member' }),
    ]);
    expect(new Set(keys)).toEqual(new Set([item.key]));
    expect(await store.list()).toEqual([]);
  });

  it('a restart in airplane mode keeps the scan', async () => {
    const path = `${tmpdir()}/fdv-offline-${Date.now()}.db`;
    const first = nodeSqlDb(path);
    const item = await commitCapture(
      { source: PAGES, metadata: { title: 'Kept' }, origin: ORIGIN, account: 'fake-member' },
      phone(await SqliteQueueStore.over(first)),
    );
    first.close();
    // The app is killed, and opened again, still with no connection.
    const again = nodeSqlDb(path);
    const store = await SqliteQueueStore.over(again);
    expect((await store.list()).map((i) => [i.id, i.key])).toEqual([[item.id, item.key]]);
    // Then the connection comes back.
    const cv = await captureVault();
    await new Uploader(cv.deps(store)).kick();
    expect(cv.vault.state.documents.map((d) => d.title)).toEqual(['Kept']);
    again.close();
    rmSync(path, { force: true });
  });

  it('a queued capture with details survives a restart and is sent once', async () => {
    const cv = await captureVault();
    const car = await addCar(cv.vault);
    const plate = fieldOf(car, 'Registration plate');
    const fuel = fieldOf(car, 'Fuel');
    const extra = { [plate]: 'AB12 CDE', [fuel]: 'Electric' };
    const path = `${tmpdir()}/fdv-details-${Date.now()}.db`;
    const first = nodeSqlDb(path);
    const item = await commitCapture(
      {
        source: PAGES,
        metadata: { type_key: car.key, title: 'The car', owner_member_id: 'fake-member', extra },
        origin: ORIGIN,
        account: 'fake-member',
      },
      phone(await SqliteQueueStore.over(first)),
    );
    first.close();
    // Killed in airplane mode, opened again: the details are still with the scan.
    const again = nodeSqlDb(path);
    const store = await SqliteQueueStore.over(again);
    expect(await store.list()).toEqual([
      expect.objectContaining({ key: item.key, metadata: expect.objectContaining({ extra }) }),
    ]);
    // The connection comes back; the answer is lost on the way, and the phone asks again.
    cv.turns.push('lost');
    const uploader = new Uploader(cv.deps(store));
    await uploader.kick();
    await uploader.kick({ fresh: true });
    await uploader.kick({ fresh: true });
    expect(cv.vault.state.documents).toEqual([expect.objectContaining({ title: 'The car', type_key: car.key, extra })]);
    expect(cv.calls.filter((c) => c === 'POST /api/v1/capture')).toHaveLength(1);
    expect(await store.list()).toEqual([]);
    again.close();
    rmSync(path, { force: true });
  });

  it('a detail its kind lost while the scan waited is left out: the scan is filed once, and says which', async () => {
    const cv = await captureVault();
    const car = await addCar(cv.vault);
    const plate = fieldOf(car, 'Registration plate');
    const fuel = fieldOf(car, 'Fuel');
    const path = `${tmpdir()}/fdv-dropped-${Date.now()}.db`;
    const db = nodeSqlDb(path);
    const item = await commitCapture(
      {
        source: PAGES,
        metadata: { type_key: car.key, title: 'The car', extra: { [plate]: 'AB12 CDE', [fuel]: 'Electric' } },
        origin: ORIGIN,
        account: 'fake-member',
        labels: { [plate]: 'Registration plate', [fuel]: 'Fuel' },
      },
      phone(await SqliteQueueStore.over(db)),
    );
    // While it waits on the phone, somebody at a computer takes Fuel off the Car.
    const { api, token } = await ownerApi(cv.vault);
    await api.updateDocumentType(token, car.key, { fields: [{ key: plate, required: true }] });

    const store = await SqliteQueueStore.over(db);
    const sent: QueueItem[] = [];
    const keys: string[] = [];
    const base = cv.deps(store);
    const uploader = new Uploader(
      cv.deps(store, {
        send: (i, b) => {
          keys.push(i.key);
          return base.send(i, b);
        },
        onEvent: (e) => void (e.kind === 'sent' && sent.push(e.item)),
      }),
    );
    await uploader.kick();
    // Filed, not left for a person: once, with what the kind still asks for, under the one key.
    expect(cv.vault.state.documents).toEqual([
      expect.objectContaining({ title: 'The car', type_key: car.key, extra: { [plate]: 'AB12 CDE' } }),
    ]);
    expect(keys).toEqual([item.key, item.key]);
    expect(await store.list()).toEqual([]);
    // What was left out is said by the card's name for it, never its key.
    expect(sent).toEqual([expect.objectContaining({ dropped: [fuel] })]);
    expect(filedWithout(sent[0] as QueueItem)).toEqual({ title: 'The car', names: ['Fuel'] });
    // Nothing more goes: a later look sends nothing again.
    await uploader.kick({ fresh: true });
    expect(cv.calls.filter((c) => c === 'POST /api/v1/capture')).toHaveLength(2);
    db.close();
    rmSync(path, { force: true });
  });

  it('a refusal that names no detail leaves them all out, and still files the scan', async () => {
    const store = new MemoryQueueStore();
    await commitCapture(
      {
        source: PAGES,
        metadata: { title: 'Kept anyway', extra: { a: 'x', b: 'y' } },
        origin: ORIGIN,
        account: 'fake-member',
        labels: { a: 'Colour' },
      },
      phone(store),
    );
    const cv = await captureVault();
    cv.turns.push({ status: 422, code: 'invalid_extra', message: 'No.' });
    const sent: QueueItem[] = [];
    await new Uploader(cv.deps(store, { onEvent: (e) => void (e.kind === 'sent' && sent.push(e.item)) })).kick();
    expect(cv.vault.state.documents).toEqual([expect.objectContaining({ title: 'Kept anyway' })]);
    expect(sent[0]?.metadata).not.toHaveProperty('extra');
    // One of them had no name kept: "some of its details", never a key.
    expect(filedWithout(sent[0] as QueueItem)).toEqual({ title: 'Kept anyway', names: null });
  });

  it('session_ended pauses and keeps the scans', async () => {
    const store = new MemoryQueueStore();
    await commitCapture({ source: PAGES, metadata: null, origin: ORIGIN, account: 'fake-member' }, phone(store));
    const cv = await captureVault();
    cv.turns.push({ status: 401, code: 'session_ended', message: 'Sign in again.' });
    await new Uploader(cv.deps(store)).kick();
    expect(await store.list()).toEqual([
      expect.objectContaining({ state: 'waiting', lastCode: 'signed_out', problem: null }),
    ]);
    expect(await store.bytes((await store.list())[0]?.id ?? '')).not.toBeNull();
  });

  it('scans made by another account are never sent under this one', async () => {
    const store = new MemoryQueueStore();
    await commitCapture({ source: PAGES, metadata: null, origin: ORIGIN, account: 'someone-else' }, phone(store));
    const cv = await captureVault();
    await new Uploader(cv.deps(store)).kick({ fresh: true });
    expect(cv.calls.filter((c) => c === 'POST /api/v1/capture')).toEqual([]);
    expect(await store.list()).toHaveLength(1);
  });

  it('a Needs you item never loses its Only me', () => {
    const members = [
      { id: 'me', display_name: 'Aisha' },
      { id: 'omar', display_name: 'Omar' },
    ];
    const item = {
      state: 'needs_you',
      problem: { status: 422, code: 'validation_failed', message: 'That person is not in the family.' },
      metadata: { owner_member_id: 'gone', visibility: 'private' },
    } as unknown as QueueItem;
    // Only me stays Only me: the only person it can be for is you.
    expect(reassignChoices(item, members, 'me')).toEqual([{ id: 'me', name: 'Aisha' }]);
    const household = { ...item, metadata: { owner_member_id: 'gone', visibility: 'household' } } as QueueItem;
    expect(reassignChoices(household, members, 'me')).toEqual([
      { id: 'me', name: 'Aisha' },
      { id: 'omar', name: 'Omar' },
      { id: null, name: null },
    ]);
  });

  it('a renewal becomes version 2 of the same document', async () => {
    const cv = await captureVault();
    // The passport already in the vault.
    const made = await cv.api.capture(
      cv.token,
      { file: { kind: 'bytes', filename: 'old.pdf', contentType: 'application/pdf', bytes: new Uint8Array([37, 80, 68, 70]) } },
      '11111111-1111-4111-8111-111111111111',
    );
    const store = new MemoryQueueStore();
    const item = await commitCapture(
      { source: PAGES, metadata: null, origin: ORIGIN, account: 'fake-member', renews: made.document_id },
      phone(store),
    );
    expect(item).toMatchObject({ kind: 'version', target: made.document_id });
    await new Uploader(cv.deps(store)).kick();
    expect(cv.calls).toContain(`POST /api/v1/documents/${made.document_id}/versions`);
    expect(cv.vault.state.documents).toHaveLength(1);
    expect(await store.list()).toEqual([]);
  });

  it('a vault that cannot reach its storage is waited for, and says so', async () => {
    const store = new MemoryQueueStore();
    await commitCapture({ source: PAGES, metadata: null, origin: ORIGIN, account: 'fake-member' }, phone(store));
    const cv = await captureVault();
    cv.turns.push({ status: 503, code: 'storage_unreachable', retryAfter: 30 });
    await new Uploader(cv.deps(store, { now: () => 0 })).kick();
    expect(await store.list()).toEqual([
      expect.objectContaining({ state: 'waiting', lastCode: 'storage_unreachable', nextAt: 30_000 }),
    ]);
  });
});

describe('queue.db from 0.1.2', () => {
  it('opens with its scans, now able to hold renewals', async () => {
    const db = nodeSqlDb();
    // 0.1.2's tables, with one scan waiting, and no schema count.
    await db.execAsync(`
      create table queue_item (id text primary key, key text not null, origin text not null, account text not null,
        created_at integer not null, state text not null, metadata text, filename text not null, mime text not null,
        size integer not null, attempts integer not null, next_at integer not null, ask_first integer not null, problem text);
      create table queue_bytes (id text primary key, bytes blob not null);
      insert into queue_item values ('old', 'k', 'https://vault.test', 'fake-member', 1, 'waiting', null, 'Scan.pdf',
        'application/pdf', 3, 0, 0, 0, null);
    `);
    await db.runAsync('insert into queue_bytes values (?, ?)', ['old', new Uint8Array([1, 2, 3])]);
    const store = await SqliteQueueStore.over(db);
    expect(await store.list()).toEqual([
      expect.objectContaining({ id: 'old', kind: 'capture', target: null, lastCode: null }),
    ]);
    expect(await store.bytes('old')).toEqual(new Uint8Array([1, 2, 3]));
    await store.cache('card|x', { types: [1] });
    expect(await store.cached('card|x')).toEqual({ types: [1] });
    // 0.2.1: it can say, later, which details it had to go without.
    await store.update('old', { labels: { fuel: 'Fuel' }, dropped: ['fuel'] });
    expect(await store.list()).toEqual([expect.objectContaining({ labels: { fuel: 'Fuel' }, dropped: ['fuel'] })]);
    // Opened again: nothing runs twice.
    await SqliteQueueStore.over(db);
    expect((await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []))?.user_version).toBe(3);
  });

  it('an upgrade stopped halfway is simply run again', async () => {
    const db = nodeSqlDb();
    await db.execAsync(`
      create table queue_item (id text primary key, key text not null, origin text not null, account text not null,
        created_at integer not null, state text not null, metadata text, filename text not null, mime text not null,
        size integer not null, attempts integer not null, next_at integer not null, ask_first integer not null, problem text);
      create table queue_bytes (id text primary key, bytes blob not null);
      create table card_cache (key text);
    `);
    // The step's last statement fails (here: the table is in the way).
    await expect(SqliteQueueStore.over(db)).rejects.toThrow();
    const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(queue_item)', []);
    expect(columns.map((c) => c.name)).not.toContain('kind');
    // Whatever stopped it is gone: the next open finishes the upgrade.
    await db.execAsync('drop table card_cache');
    const store = await SqliteQueueStore.over(db);
    expect(await store.list()).toEqual([]);
    expect((await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []))?.user_version).toBe(3);
  });
});
