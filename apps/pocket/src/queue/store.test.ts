import { nodeSqlDb } from '../test-support/node-sqlite';
import type { QueueItem } from './item';
import { SqliteQueueStore } from './sqlite-store';
import { MemoryQueueStore, type QueueStore } from './store';

const item = (id: string, over: Partial<QueueItem> = {}): QueueItem => ({
  id,
  key: `key-${id}`,
  origin: 'https://vault.test',
  account: 'member-1',
  createdAt: 1_000,
  state: 'waiting',
  metadata: {
    type_key: 'passport',
    title: "Aisha's passport",
    issued: { date: '2021-03-14', precision: 'day' },
  },
  filename: 'Scan.pdf',
  mime: 'application/pdf',
  size: 3,
  attempts: 0,
  nextAt: 0,
  askFirst: false,
  problem: null,
  kind: 'capture',
  target: null,
  lastCode: null,
  ...over,
});

const stores: [string, () => Promise<QueueStore>][] = [
  ['memory', async () => new MemoryQueueStore()],
  ['queue.db (its SQL, on Node’s SQLite)', async () => SqliteQueueStore.over(nodeSqlDb())],
];

describe.each(stores)('the queue store: %s', (_name, make) => {
  it('keeps an item with its bytes, and gives them back', async () => {
    const store = await make();
    await store.add(item('a'), new Uint8Array([1, 2, 3]));
    expect(await store.list()).toEqual([item('a')]);
    expect(await store.bytes('a')).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('keeps the card’s names for the details, and which ones it went without', async () => {
    const store = await make();
    await store.add(item('d', { labels: { fuel: 'Fuel' } }), new Uint8Array([1]));
    expect(await store.list()).toEqual([item('d', { labels: { fuel: 'Fuel' } })]);
    await store.update('d', { dropped: ['fuel'] });
    expect(await store.list()).toEqual([item('d', { labels: { fuel: 'Fuel' }, dropped: ['fuel'] })]);
  });

  it('a Skip keeps no details at all', async () => {
    const store = await make();
    await store.add(item('s', { metadata: null }), new Uint8Array([9]));
    expect((await store.list())[0]?.metadata).toBeNull();
  });

  it('lists oldest first', async () => {
    const store = await make();
    await store.add(item('late', { createdAt: 3 }), new Uint8Array([1]));
    await store.add(item('early', { createdAt: 1 }), new Uint8Array([1]));
    expect((await store.list()).map((i) => i.id)).toEqual(['early', 'late']);
  });

  it('changes only what it is told to', async () => {
    const store = await make();
    await store.add(item('a'), new Uint8Array([1]));
    await store.update('a', {
      state: 'needs_you',
      attempts: 2,
      askFirst: true,
      problem: { status: 415, code: 'unsupported_media_type', message: 'No.' },
    });
    expect((await store.list())[0]).toEqual(
      item('a', {
        state: 'needs_you',
        attempts: 2,
        askFirst: true,
        problem: {
          status: 415,
          code: 'unsupported_media_type',
          message: 'No.',
        },
      }),
    );
  });

  it('a Save and a clean-up after a 201 at the same moment both land, and leave nothing behind', async () => {
    const store = await make();
    await store.add(item('a'), new Uint8Array([1]));
    await Promise.all([
      store.remove('a'),
      store.add(item('b'), new Uint8Array([2])),
      store.update('b', { attempts: 1 }),
    ]);
    expect((await store.list()).map((i) => [i.id, i.attempts])).toEqual([['b', 1]]);
    expect(await store.bytes('a')).toBeNull();
    expect(await store.bytes('b')).toEqual(new Uint8Array([2]));
  });

  it("forgets a vault's card data, and nobody else's", async () => {
    const s = await make();
    await s.cache('card|https://vault.test|member-1', { types: ['passport'] });
    await s.cache('card|https://vault.test|member-2', { types: ['will'] });
    await s.cache('card|https://other.test|member-1', { types: ['deed'] });
    await s.forgetCached('card|https://vault.test|');
    expect(await s.cached('card|https://vault.test|member-1')).toBeNull();
    expect(await s.cached('card|https://vault.test|member-2')).toBeNull();
    expect(await s.cached('card|https://other.test|member-1')).toEqual({ types: ['deed'] });
  });

  it('removing an item takes its bytes and its key with it', async () => {
    const store = await make();
    await store.add(item('a'), new Uint8Array([1]));
    await store.remove('a');
    expect(await store.list()).toEqual([]);
    expect(await store.bytes('a')).toBeNull();
  });
});

describe('queue.db on opening', () => {
  it('drops bytes whose item is gone', async () => {
    const db = nodeSqlDb();
    const store = await SqliteQueueStore.over(db);
    await store.add(item('a'), new Uint8Array([1]));
    await db.runAsync('insert into queue_bytes (id, bytes) values (?, ?)', ['orphan', new Uint8Array([9])]);
    const reopened = await SqliteQueueStore.over(db);
    expect(await reopened.bytes('orphan')).toBeNull();
    expect(await reopened.bytes('a')).toEqual(new Uint8Array([1]));
  });
});
