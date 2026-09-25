import { captureVault } from '../test-support/capture';
import type { QueueItem } from './item';
import { MemoryQueueStore } from './store';
import { NotThisAccountError, Uploader, type UploadEvent } from './uploader';

const PDF = new TextEncoder().encode('%PDF-1.4\n%%EOF\n');
const KEY = '5b1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

async function queued(over: Partial<QueueItem> = {}) {
  const store = new MemoryQueueStore();
  const item: QueueItem = {
    id: 'item-1',
    key: KEY,
    origin: 'https://vault.test',
    account: 'fake-member',
    createdAt: 0,
    state: 'waiting',
    metadata: {
      type_key: 'passport',
      title: "Aisha's passport",
      owner_member_id: 'fake-member',
    },
    filename: "Aisha's passport.pdf",
    mime: 'application/pdf',
    size: PDF.length,
    attempts: 0,
    nextAt: 0,
    askFirst: false,
    problem: null,
    kind: 'capture',
    target: null,
    lastCode: null,
    ...over,
  };
  await store.add(item, PDF);
  return store;
}

describe('the uploader', () => {
  it('sends a capture with its details, and forgets it once the vault has it', async () => {
    const cv = await captureVault();
    const store = await queued();
    const events: UploadEvent[] = [];
    await new Uploader(cv.deps(store, { onEvent: (e) => events.push(e) })).kick();
    expect(cv.vault.state.documents).toEqual([
      expect.objectContaining({
        title: "Aisha's passport",
        type_key: 'passport',
        owner_member_id: 'fake-member',
      }),
    ]);
    expect(await store.list()).toEqual([]);
    expect(await store.bytes('item-1')).toBeNull();
    expect(events.at(-1)).toMatchObject({
      kind: 'sent',
      documentId: cv.vault.state.documents[0]?.id,
    });
  });

  it('a 429 waits for Retry-After', async () => {
    const cv = await captureVault();
    cv.turns.push({ status: 429, code: 'rate_limited', retryAfter: 7 });
    const store = await queued();
    let now = 1_000;
    const planned: number[] = [];
    const uploader = new Uploader(
      cv.deps(store, {
        now: () => now,
        schedule: (ms) => {
          planned.push(ms);
          return () => undefined;
        },
      }),
    );
    await uploader.kick();
    const [item] = await store.list();
    expect(item).toMatchObject({
      state: 'waiting',
      nextAt: 8_000,
      attempts: 1,
    });
    // Nothing more before its time.
    now = 7_999;
    await uploader.kick();
    expect(cv.vault.state.documents).toHaveLength(0);
    now = 8_000;
    await uploader.kick();
    expect(cv.vault.state.documents).toHaveLength(1);
    expect(planned[0]).toBe(7_000);
  });

  it('a 503 retries', async () => {
    const cv = await captureVault();
    cv.turns.push({ status: 503, code: 'unavailable' }, { status: 503, code: 'unavailable' });
    const store = await queued();
    let now = 0;
    const uploader = new Uploader(cv.deps(store, { now: () => now }));
    for (let i = 0; i < 3; i += 1) {
      await uploader.kick();
      now += 600_000;
    }
    expect(cv.vault.state.documents).toHaveLength(1);
    expect(await store.list()).toEqual([]);
  });

  it('a lost response asks /uploads/{key} before sending again and makes one document', async () => {
    const cv = await captureVault();
    cv.turns.push('lost');
    const store = await queued();
    let now = 0;
    const uploader = new Uploader(cv.deps(store, { now: () => now }));
    await uploader.kick();
    // The vault made it; the phone never heard.
    expect(cv.vault.state.documents).toHaveLength(1);
    expect(await store.list()).toEqual([expect.objectContaining({ state: 'waiting', askFirst: true })]);
    now = 600_000;
    await uploader.kick();
    expect(cv.calls.filter((c) => c.startsWith('POST /api/v1/capture'))).toHaveLength(1);
    expect(cv.calls).toContain(`GET /api/v1/uploads/${KEY}`);
    expect(cv.vault.state.documents).toHaveLength(1);
    expect(await store.list()).toEqual([]);
  });

  it('an app closed halfway through a try asks first when it opens again', async () => {
    const cv = await captureVault();
    const store = await queued({ state: 'sending', askFirst: true });
    await new Uploader(cv.deps(store)).kick();
    expect(cv.calls.slice(-2)).toEqual([`GET /api/v1/uploads/${KEY}`, 'POST /api/v1/capture']);
    expect(cv.vault.state.documents).toHaveLength(1);
  });

  it('a 415 stops with the plain reason', async () => {
    const cv = await captureVault();
    cv.turns.push({
      status: 415,
      code: 'unsupported_media_type',
      message: "The vault can't keep this kind of file.",
    });
    const store = await queued();
    const uploader = new Uploader(cv.deps(store));
    await uploader.kick();
    expect(await store.list()).toEqual([
      expect.objectContaining({
        state: 'needs_you',
        problem: {
          status: 415,
          code: 'unsupported_media_type',
          message: "The vault can't keep this kind of file.",
        },
      }),
    ]);
    // Never tried again by itself.
    await uploader.kick();
    expect(cv.calls.filter((c) => c === 'POST /api/v1/capture')).toHaveLength(1);
  });

  it('only this vault’s and this account’s captures are sent', async () => {
    const cv = await captureVault();
    const store = await queued({ account: 'someone-else' });
    await new Uploader(cv.deps(store)).kick();
    expect(cv.calls.filter((c) => c === 'POST /api/v1/capture')).toHaveLength(0);
    await new Uploader(cv.deps(store, { who: () => null })).kick();
    expect(cv.calls.filter((c) => c === 'POST /api/v1/capture')).toHaveLength(0);
  });

  it('two at once are sent one after the other, oldest first', async () => {
    const cv = await captureVault();
    const store = await queued({
      id: 'b',
      key: '6b1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
      createdAt: 2,
      metadata: { title: 'Second' },
    });
    await store.add(
      {
        ...(await store.list())[0]!,
        id: 'a',
        key: '7b1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
        createdAt: 1,
        metadata: { title: 'First' },
      },
      PDF,
    );
    const uploader = new Uploader(cv.deps(store));
    await Promise.all([uploader.kick(), uploader.kick()]);
    expect(cv.vault.state.documents.map((d) => d.title)).toEqual(['First', 'Second']);
  });

  it('stopped, it starts nothing new', async () => {
    const cv = await captureVault();
    const store = await queued();
    const uploader = new Uploader(cv.deps(store));
    uploader.stop();
    // Saves, network changes, sign-ins: none of them starts it again.
    await uploader.kick();
    await uploader.kick({ fresh: true });
    expect(cv.calls.filter((c) => c === 'POST /api/v1/capture')).toHaveLength(0);
    // Only coming back to the front does.
    await uploader.resume();
    expect(cv.vault.state.documents).toHaveLength(1);
  });

  it('someone else signing in while one capture is on its way sends none of the first person’s others as them', async () => {
    const cv = await captureVault();
    const store = await queued({
      id: 'a1',
      key: '8b1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
      createdAt: 1,
      metadata: { title: 'A1' },
    });
    await store.add(
      {
        ...(await store.list())[0]!,
        id: 'a2',
        key: '9b1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
        createdAt: 2,
        metadata: { title: 'A2' },
      },
      PDF,
    );
    let who = { origin: 'https://vault.test', account: 'fake-member' };
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => (release = r));
    const sent: string[] = [];
    const base = cv.deps(store);
    const uploader = new Uploader(
      cv.deps(store, {
        who: () => who,
        send: async (item, bytes) => {
          sent.push(`${item.id} as ${who.account}`);
          if (item.id === 'a1') await held;
          return base.send(item, bytes);
        },
      }),
    );
    const pass = uploader.kick();
    await new Promise((r) => setImmediate(r));
    // A signs out and B signs in while a1 is still going.
    who = { origin: 'https://vault.test', account: 'member-b' };
    release();
    await pass;
    expect(sent).toEqual(['a1 as fake-member']);
    expect((await store.list()).map((i) => i.id)).toEqual(['a2']);
  });

  it('a send refused because the session is someone else’s leaves the item as it was', async () => {
    const cv = await captureVault();
    const store = await queued();
    await new Uploader(
      cv.deps(store, {
        send: async () => {
          throw new NotThisAccountError();
        },
      }),
    ).kick();
    expect(await store.list()).toEqual([expect.objectContaining({ state: 'waiting', problem: null })]);
    expect(cv.vault.state.documents).toHaveLength(0);
  });

  it('online again, it tries at once what waited only for a connection — not what the vault asked to wait', async () => {
    const cv = await captureVault();
    const store = await queued({ id: 'offline-one', createdAt: 1 });
    await store.add(
      {
        ...(await store.list())[0]!,
        id: 'busy-one',
        key: 'ab1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
        createdAt: 2,
      },
      PDF,
    );
    cv.turns.push('offline', {
      status: 503,
      code: 'unavailable',
      retryAfter: 120,
    });
    let now = 0;
    const uploader = new Uploader(cv.deps(store, { now: () => now }));
    await uploader.kick();
    now = 500; // long before either backoff is up
    await uploader.kick({ fresh: true });
    expect((await store.list()).map((i) => i.id)).toEqual(['busy-one']);
  });
});
