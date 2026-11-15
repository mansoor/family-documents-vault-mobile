import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import NotesScreen from '../app/(tabs)/notes';
import type { FetchLike } from '@fdv/client';
import { setPhoneOffline } from '../net/reach';
import type { QueueItem } from '../queue/item';
import { NOTE_MIME, noteBody, readNote } from '../queue/note';
import { KEY_SAFE_MS } from '../queue/note-send';
import { MemoryQueueStore } from '../queue/store';
import { audit } from '../test-support/a11y';
import { unlocked } from '../test-support/lookup';
import { installed, respond, testCapture } from '../test-support/render';
import { resetRoutes, routes } from '../test-support/router';
import { caps0519, capabilities, keysAsDev45, testVault, type TestVault } from '../test-support/vault';

jest.mock(
  'expo-router',
  () => jest.requireActual<typeof import('../test-support/router')>('../test-support/router').routerMock,
);

/**
 * Notes written on the phone, sent to a vault that keeps a new note's
 * Idempotency-Key (0.9.0-dev.45; app 0.13.1) — the test vault keeping it
 * as the real one does (keysAsDev45): the request checked before the key,
 * the key the household's, the account's and the person's, 24 hours on the
 * test's clock.
 */

const ORIGIN = 'https://vault.test';
const DOCS = `${ORIGIN}/api/v1/documents`;
const CAPS = `${ORIGIN}/api/v1/capabilities`;

beforeEach(() => {
  installed();
  resetRoutes();
  setPhoneOffline(false);
});

/** A vault of 0.9.0-dev.45: notes, and a new note's key kept — or not (`keys: false`). */
function vault(keys = true): TestVault {
  const v = testVault([ORIGIN]);
  v.caps = capabilities({
    features: { ...caps0519().features, notes: true, collections: true, ...(keys ? { idempotent_create: true } : {}) },
  });
  return v;
}

const networkChanged = () =>
  act(() => {
    for (const l of (globalThis as unknown as { __networkListeners: Set<() => void> }).__networkListeners) l();
  });

/** The vault's notes with this title. */
const made = (v: TestVault, title: string) => v.vault.state.documents.filter((d) => d.title === title);

/** New note, from Notes' +: a title, words, then Save. */
async function writeNote(title: string, words: string) {
  await fireEvent.press(await screen.findByTestId('notes-new'));
  await fireEvent.changeText(await screen.findByTestId('new-note-title'), title);
  await fireEvent.changeText(screen.getByTestId('new-note-words'), words);
  await fireEvent.press(screen.getByTestId('new-note-save'));
  await waitFor(() => expect(routes()).toEqual([]));
}

/** A queued note opened from Notes, its words changed, saved. */
async function changeWords(id: string, words: string, notice?: string | RegExp) {
  await fireEvent.press(screen.getByTestId(`queued-note-open-${id}`));
  const shown = await screen.findByTestId('new-note-queued');
  if (notice) expect(shown).toHaveTextContent(notice);
  await fireEvent.changeText(screen.getByTestId('new-note-words'), words);
  await fireEvent.press(screen.getByTestId('new-note-save'));
  await waitFor(() => expect(routes()).toEqual([]));
}

function queuedIds(): string[] {
  return screen.queryAllByTestId(/^queued-note-state-/).map((r) => String(r.props.testID).replace('queued-note-state-', ''));
}
async function queuedId(): Promise<string> {
  await waitFor(() => expect(queuedIds()).toHaveLength(1));
  return queuedIds()[0] as string;
}
const stateOf = (id: string) => screen.getByTestId(`queued-note-state-${id}`);

/** A note already in the phone's queue, as the queue keeps one. */
async function queued(store: MemoryQueueStore, over: Partial<QueueItem> & { id: string }, payload: Record<string, unknown>) {
  const item: QueueItem = {
    kind: 'note',
    target: null,
    key: `key-${over.id}`,
    origin: ORIGIN,
    account: 'fake-member',
    createdAt: 1,
    state: 'waiting',
    metadata: null,
    filename: 'note',
    mime: NOTE_MIME,
    size: 2,
    attempts: 0,
    nextAt: 0,
    askFirst: false,
    problem: null,
    lastCode: null,
    ...over,
  };
  await store.add(item, new TextEncoder().encode(JSON.stringify(payload)));
}

/** What the phone keeps of a queued note: its words, its key's try, where it landed. */
const keptOf = async (store: MemoryQueueStore, id: string) => readNote((await store.bytes(id)) ?? new Uint8Array());

/** Every POST /documents that reached the vault: its Idempotency-Key and its body. Outermost: wrap last. */
function recordPosts(v: TestVault) {
  const sent: { key: string | undefined; body: Record<string, unknown> }[] = [];
  const inner = v.fetch;
  v.fetch = async (url, init) => {
    if (v.reachable.has(ORIGIN) && init.method === 'POST' && url === DOCS) {
      sent.push({ key: init.headers['idempotency-key'], body: JSON.parse(String(init.body)) as Record<string, unknown> });
    }
    return inner(url, init);
  };
  return sent;
}

/** The POSTs of notes, by try: `script(n, send)` answers the nth itself, or passes it on. */
function scripted(v: TestVault, script: (n: number, send: () => ReturnType<FetchLike>) => ReturnType<FetchLike>) {
  const inner = v.fetch;
  let n = 0;
  v.fetch = async (url, init) => {
    if (init.method !== 'POST' || url !== DOCS || !v.reachable.has(ORIGIN)) return inner(url, init);
    n += 1;
    return script(n, () => inner(url, init));
  };
}

/** Made, and the answer lost on its way back; with `gone`, the vault out of reach after. */
const lose = async (send: () => ReturnType<FetchLike>, v: TestVault, gone = false, words = 'Network request failed') => {
  await send();
  if (gone) v.reachable.delete(ORIGIN);
  throw new TypeError(words);
};

/** The phone's clock and the uploader's timers, moved by the test. */
function fakeClock() {
  let at = Date.now();
  const timers: { ms: number; fn: () => void; live: boolean }[] = [];
  return {
    now: () => at,
    advance: (ms: number) => {
      at += ms;
    },
    schedule: (ms: number, fn: () => void) => {
      const t = { ms, fn, live: true };
      timers.push(t);
      return () => {
        t.live = false;
      };
    },
    /** The uploader's next timer: its wait passed, and run. Returns how long it waited. */
    async fire(): Promise<number> {
      await waitFor(() => expect(timers.some((t) => t.live)).toBe(true));
      const t = timers.filter((x) => x.live).at(-1) as (typeof timers)[number];
      for (const x of timers) x.live = false;
      at += t.ms;
      await act(async () => t.fn());
      return t.ms;
    },
  };
}

/** The vault's own error envelope. */
const vaultError = (status: number, code: string, message: string, headers: Record<string, string> = {}) =>
  respond(status, { error: { code, message, retriable: status === 409 || status >= 500 } }, headers);

describe('what the vault says now decides the key (B1, S6)', () => {
  it.each([0, 300])(
    'just after a launch, the vault answering in %i ms: every note goes under its key — none without one',
    async (delay) => {
      const v = vault();
      keysAsDev45(v);
      const inner = v.fetch;
      v.fetch = async (url, init) => {
        if (url === CAPS && delay) await new Promise((r) => setTimeout(r, delay));
        return inner(url, init);
      };
      const sent = recordPosts(v);
      const store = new MemoryQueueStore();
      const body = noteBody({ title: 'Frozen', notes: 'x', visibility: 'private' }, 'fake-member');
      await queued(store, { id: 'a' }, { ...body, clientId: 'k-a', sent: { body, firstAt: Date.now() - 60_000, failed: 0, busy: 0 } });
      await queued(store, { id: 'b' }, { title: 'Plain', notes: 'y', visibility: 'private', clientId: 'k-b' });
      await unlocked(v, <NotesScreen />, { capture: testCapture({ openStore: async () => store }) });
      await waitFor(() => expect(made(v, 'Frozen')).toHaveLength(1));
      await waitFor(() => expect(made(v, 'Plain')).toHaveLength(1));
      await waitFor(async () => expect(await store.list()).toEqual([]));
      expect(sent.map((p) => p.key).sort()).toEqual(['k-a', 'k-b']);
    },
  );

  it('the vault not answering at all: nothing goes, and nothing is taken for a vault that keeps no key', async () => {
    const v = vault();
    keysAsDev45(v);
    const sent = recordPosts(v);
    const store = new MemoryQueueStore();
    const body = noteBody({ title: 'Frozen', notes: 'x', visibility: 'private' }, 'fake-member');
    await queued(store, { id: 'a' }, { ...body, clientId: 'k-a', sent: { body, firstAt: Date.now() - 60_000, failed: 0, busy: 0 } });
    await queued(store, { id: 'b' }, { title: 'Plain', notes: 'y', visibility: 'private', clientId: 'k-b' });
    await unlocked(v, <NotesScreen />, {
      capture: testCapture({ openStore: async () => store }),
      // Signed in; the vault gone before the app looks.
      before: () => {
        v.reachable.delete(ORIGIN);
      },
    });
    await waitFor(() => expect(queuedIds()).toHaveLength(2));
    await networkChanged();
    expect(sent).toEqual([]);
    expect((await store.list()).map((i) => i.state)).toEqual(['waiting', 'waiting']);
    expect((await keptOf(store, 'a'))?.sent?.body).toEqual(body);
  });

  it('sent once under its key, then the vault says it keeps none: Might already be in your vault — never sent without one', async () => {
    const v = vault();
    keysAsDev45(v);
    scripted(v, (n, send) => (n === 1 ? lose(send, v, true) : send()));
    const sent = recordPosts(v);
    const store = new MemoryQueueStore();
    await unlocked(v, <NotesScreen />, { capture: testCapture({ openStore: async () => store }) });
    await screen.findByTestId('notes-none');
    await writeNote('Boiler', 'Ring Ann first.');
    const id = await queuedId();
    expect(sent).toHaveLength(1);

    // Rolled back: the vault keeps no key now.
    v.caps = capabilities({ features: { ...caps0519().features, notes: true, collections: true } });
    v.reachable.add(ORIGIN);
    await networkChanged();
    await waitFor(() => expect(stateOf(id)).toHaveTextContent('Might already be in your vault'));
    expect(sent).toHaveLength(1);
    expect(made(v, 'Boiler')).toHaveLength(1);
  });
});

describe('a cut-off try (B2)', () => {
  it('one that went under its key goes again under it, as it first went — one note', async () => {
    const v = vault();
    keysAsDev45(v);
    const sent = recordPosts(v);
    const store = new MemoryQueueStore();
    const body = noteBody({ title: 'Cut off', notes: 'x', visibility: 'private' }, 'fake-member');
    await queued(
      store,
      { id: 'cut', state: 'sending' },
      { ...body, clientId: 'k-cut', sent: { body, firstAt: Date.now() - 60_000, failed: 0, busy: 0 } },
    );
    await unlocked(v, <NotesScreen />, { capture: testCapture({ openStore: async () => store }) });
    await waitFor(() => expect(made(v, 'Cut off')).toHaveLength(1));
    await waitFor(() => expect(queuedIds()).toEqual([]));
    expect(sent).toEqual([{ key: 'k-cut', body }]);
  });

  it('one that went without its key, on a vault that keeps keys now: Might already be in your vault — not sent', async () => {
    const v = vault();
    keysAsDev45(v);
    const sent = recordPosts(v);
    const store = new MemoryQueueStore();
    await queued(store, { id: 'cut', state: 'sending' }, { title: 'Cut off', notes: 'x', visibility: 'private', clientId: 'k-cut' });
    await unlocked(v, <NotesScreen />, { capture: testCapture({ openStore: async () => store }) });
    await waitFor(() => expect(stateOf('cut')).toHaveTextContent('Might already be in your vault'));
    await networkChanged();
    expect(sent).toEqual([]);
    expect((await store.list())[0]?.state).toBe('unsure');
  });

  it('New note puts it in the queue, frozen with its key, before anything goes: an app killed mid-Save keeps it (M3)', async () => {
    const v = vault();
    keysAsDev45(v);
    const store = new MemoryQueueStore();
    let seen: { state: string | undefined; frozen: boolean } | null = null;
    scripted(v, async (_n, send) => {
      const [item] = await store.list();
      seen = { state: item?.state, frozen: !!(item && (await keptOf(store, item.id))?.sent) };
      return send();
    });
    await unlocked(v, <NotesScreen />, { capture: testCapture({ openStore: async () => store }) });
    await screen.findByTestId('notes-none');
    await fireEvent.press(await screen.findByTestId('notes-new'));
    await fireEvent.changeText(await screen.findByTestId('new-note-title'), 'Boiler');
    await fireEvent.changeText(screen.getByTestId('new-note-words'), 'Ring Ann first.');
    await fireEvent.press(screen.getByTestId('new-note-save'));
    await waitFor(() => expect(made(v, 'Boiler')).toHaveLength(1));
    expect(seen).toEqual({ state: 'sending', frozen: true });
    await waitFor(async () => expect(await store.list()).toEqual([]));
  });
});

describe('"not yet" under the key (S1)', () => {
  it.each([
    [409, 'idempotency_in_progress', 'That request is still being made.', '2', 2000],
    [503, 'busy_try_again', 'Busy for a moment. Try again.', '1', 1000],
  ] as const)(
    'a %i %s: sent again under the same key once the vault’s Retry-After is up, never a refusal — one note',
    async (status, code, message, retryAfter, wait) => {
      const v = vault();
      const clock = fakeClock();
      keysAsDev45(v, clock.now);
      scripted(v, (n, send) =>
        n === 1 ? lose(send, v) : n === 2 ? Promise.resolve(vaultError(status, code, message, { 'retry-after': retryAfter })) : send(),
      );
      const sent = recordPosts(v);
      await unlocked(v, <NotesScreen />, { capture: testCapture({ now: clock.now, schedule: clock.schedule }) });
      await screen.findByTestId('notes-none');
      await writeNote('Boiler', 'Ring Ann first.');
      await waitFor(() => expect(sent).toHaveLength(2));
      const id = await queuedId();
      await waitFor(() => expect(stateOf(id)).toHaveTextContent('Waiting to send'));

      expect(await clock.fire()).toBe(wait);
      await waitFor(() => expect(queuedIds()).toEqual([]));
      expect(sent).toHaveLength(3);
      expect(new Set(sent.map((p) => p.key)).size).toBe(1);
      expect(sent[0]?.key).toMatch(/^[0-9a-f-]{36}$/);
      expect(sent.every((p) => JSON.stringify(p.body) === JSON.stringify(sent[0]?.body))).toBe(true);
      expect(made(v, 'Boiler')).toHaveLength(1);
    },
  );

  it('a 500 again and again — a gateway’s 502 among them: tried again for as long as the vault keeps the key, then Might already be in your vault', async () => {
    const v = vault();
    const clock = fakeClock();
    keysAsDev45(v, clock.now);
    scripted(v, (n) =>
      Promise.resolve(n % 2 ? vaultError(500, 'internal', 'Something went wrong.') : respond(502, {})),
    );
    const sent = recordPosts(v);
    await unlocked(v, <NotesScreen />, { capture: testCapture({ now: clock.now, schedule: clock.schedule }) });
    await screen.findByTestId('notes-none');
    await writeNote('Boiler', 'Ring Ann first.');
    const id = await queuedId();
    const waits: number[] = [];
    for (let i = 0; i < 8; i += 1) waits.push(await clock.fire());
    // More than five tries, waiting longer each time, at most five minutes apart.
    expect(waits).toEqual([2000, 4000, 8000, 16000, 32000, 64000, 128000, 256000]);
    expect(stateOf(id)).toHaveTextContent('Waiting to send');
    expect(sent).toHaveLength(9);
    expect(new Set(sent.map((p) => p.key)).size).toBe(1);

    // The key's day nearly over: the next wait would end after it.
    clock.advance(KEY_SAFE_MS - 10 * 60_000);
    await clock.fire();
    await waitFor(() => expect(stateOf(id)).toHaveTextContent('Might already be in your vault'));
    const tried = sent.length;
    await networkChanged();
    expect(sent).toHaveLength(tried);
  });

  it('an edit keeps the Retry-After the vault just gave (M5)', async () => {
    const v = vault();
    const clock = fakeClock();
    keysAsDev45(v, clock.now);
    scripted(v, (n, send) =>
      n === 1 ? lose(send, v) : n === 2 ? Promise.resolve(vaultError(409, 'idempotency_in_progress', 'Still.', { 'retry-after': '30' })) : send(),
    );
    const store = new MemoryQueueStore();
    await unlocked(v, <NotesScreen />, {
      capture: testCapture({ openStore: async () => store, now: clock.now, schedule: clock.schedule }),
    });
    await screen.findByTestId('notes-none');
    await writeNote('Boiler', 'Ring Ann first.');
    const id = await queuedId();
    await waitFor(async () => expect((await store.list())[0]?.lastCode).toBe('idempotency_in_progress'));
    const due = (await store.list())[0]?.nextAt;
    expect(due).toBe(clock.now() + 30_000);
    await changeWords(id, 'Ring Ann first, then Bob.');
    expect((await store.list())[0]?.nextAt).toBe(due);
  });
});

describe('made, and no longer theirs to see (404 created_not_visible)', () => {
  it('sent, said plainly — kept on the phone until Notes has said it — and never sent again', async () => {
    const v = vault();
    const keys = keysAsDev45(v);
    scripted(v, async (n, send) => {
      if (n > 1) return send();
      const res = await send();
      // Its person made it Only me since.
      keys.hide(((await res.json()) as { id: string }).id);
      throw new TypeError('Network request failed');
    });
    const sent = recordPosts(v);
    const store = new MemoryQueueStore();
    await unlocked(v, <NotesScreen />, { capture: testCapture({ openStore: async () => store }) });
    await screen.findByTestId('notes-none');
    await writeNote('Boiler', 'Ring Ann first.');
    expect(await screen.findByTestId('notes-hidden')).toHaveTextContent(
      /^“Boiler” reached your vault\. It's now kept private by the person it's about, so it isn't in your list\./,
    );
    await waitFor(() => expect(queuedIds()).toEqual([]));
    expect(await store.list()).toEqual([]);
    expect(sent).toHaveLength(2);
    expect(sent[1]?.key).toBe(sent[0]?.key);
    expect(made(v, 'Boiler')).toHaveLength(1);
    // Said: no longer kept to say again.
    await waitFor(async () => expect(await store.cached(`card|${ORIGIN}|fake-member|notesHidden`)).toEqual([]));
    expect(audit()).toEqual([]);
    await networkChanged();
    expect(sent).toHaveLength(2);
    await fireEvent.press(screen.getByTestId('notes-hidden-done'));
    await waitFor(() => expect(screen.queryByTestId('notes-hidden')).toBeNull());
  });

  it('not yet said when the app closed: Notes says it next time (M6)', async () => {
    const v = vault();
    const store = new MemoryQueueStore();
    await store.cache(`card|${ORIGIN}|fake-member|notesHidden`, ['Boiler']);
    await unlocked(v, <NotesScreen />, { capture: testCapture({ openStore: async () => store }) });
    expect(await screen.findByTestId('notes-hidden')).toHaveTextContent(/^“Boiler” reached your vault\./);
  });
});

describe('a change after a lost answer: the words it first went with settle it (S7, M1, M4)', () => {
  it('in the vault with them: Put my changes in that note — the change goes into it', async () => {
    const v = vault();
    keysAsDev45(v);
    scripted(v, (n, send) => (n === 1 ? lose(send, v, true) : send()));
    const sent = recordPosts(v);
    const store = new MemoryQueueStore();
    await unlocked(v, <NotesScreen />, { capture: testCapture({ openStore: async () => store }) });
    await screen.findByTestId('notes-none');
    await writeNote('Boiler', 'Ring Ann first.');
    const id = await queuedId();
    expect((await keptOf(store, id))?.sent?.body).toEqual(sent[0]?.body);

    await changeWords(
      id,
      'Ring Ann first, then Bob.',
      "This note was sent once and we haven't heard back yet. If you change it, we first make sure that one reached your vault, then ask about your changes.",
    );
    v.reachable.add(ORIGIN);
    await networkChanged();
    await waitFor(() => expect(stateOf(id)).toHaveTextContent('In your vault, with its earlier words'));
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
    expect(made(v, 'Boiler').map((d) => d.notes)).toEqual(['Ring Ann first.']);
    expect(screen.getByTestId(`queued-note-arrived-${id}`)).toHaveTextContent(
      'Your note reached the vault with its earlier words. Send your changes as a new note?',
    );
    // Its question is read with the row; its bin discards the change.
    expect(screen.getByTestId(`queued-note-open-${id}`).props.accessibilityLabel).toBe(
      'Boiler. In your vault, with its earlier words. Your note reached the vault with its earlier words. Send your changes as a new note?',
    );
    expect(screen.getByTestId(`queued-note-delete-${id}`).props.accessibilityLabel).toBe('Discard your changes to “Boiler”');
    expect(screen.getByTestId(`queued-note-send-changes-${id}`)).toBeTruthy();
    expect(audit()).toEqual([]);
    await networkChanged();
    expect(sent).toHaveLength(2);

    await fireEvent.press(screen.getByTestId(`queued-note-put-into-${id}`));
    await waitFor(() => expect(queuedIds()).toEqual([]));
    expect(made(v, 'Boiler').map((d) => d.notes)).toEqual(['Ring Ann first, then Bob.']);
    expect(sent).toHaveLength(2);
  });

  it('who can see it changed too: no putting it in that note — Send as a new note, on the person’s word', async () => {
    const v = vault();
    keysAsDev45(v);
    scripted(v, (n, send) => (n === 1 ? lose(send, v, true) : send()));
    const sent = recordPosts(v);
    await unlocked(v, <NotesScreen />);
    await screen.findByTestId('notes-none');
    await writeNote('Boiler', 'Ring Ann first.');
    const id = await queuedId();
    await fireEvent.press(screen.getByTestId(`queued-note-open-${id}`));
    await screen.findByTestId('new-note-queued');
    await fireEvent.press(screen.getByTestId('new-note-private'));
    await fireEvent.press(screen.getByTestId('new-note-save'));
    await waitFor(() => expect(routes()).toEqual([]));
    v.reachable.add(ORIGIN);
    await networkChanged();
    await waitFor(() => expect(stateOf(id)).toHaveTextContent('In your vault, with its earlier words'));
    expect(screen.queryByTestId(`queued-note-put-into-${id}`)).toBeNull();
    await fireEvent.press(screen.getByTestId(`queued-note-send-changes-${id}`));
    await waitFor(() => expect(made(v, 'Boiler')).toHaveLength(2));
    await waitFor(() => expect(queuedIds()).toEqual([]));
    expect(made(v, 'Boiler').map((d) => d.visibility)).toEqual(['household', 'private']);
    expect(sent[2]?.key).not.toBe(sent[0]?.key);
  });

  it('422 idempotency_key_reused: an earlier version is in the vault — said so; Discard changes, asked first, leaves it there', async () => {
    const v = vault();
    keysAsDev45(v);
    // Made — and the phone took the try for one that never left, so nothing was kept with its key.
    scripted(v, (n, send) => (n === 1 ? lose(send, v, true, 'connect ECONNREFUSED 10.0.0.2:443') : send()));
    const sent = recordPosts(v);
    const store = new MemoryQueueStore();
    await unlocked(v, <NotesScreen />, { capture: testCapture({ openStore: async () => store }) });
    await screen.findByTestId('notes-none');
    await writeNote('Fuse', 'Under the stairs.');
    const id = await queuedId();
    expect((await keptOf(store, id))?.sent).toBeUndefined();
    await changeWords(id, 'Under the stairs, left side.', /only on this phone/);

    v.reachable.add(ORIGIN);
    await networkChanged();
    await waitFor(() =>
      expect(screen.getByTestId(`queued-note-arrived-${id}`)).toHaveTextContent(
        'An earlier version of this note is already in your vault. Send your changes as a new note?',
      ),
    );
    expect(sent).toHaveLength(2);
    expect(sent[1]?.key).toBe(sent[0]?.key);
    expect(made(v, 'Fuse').map((d) => d.notes)).toEqual(['Under the stairs.']);
    expect(screen.queryByTestId(`queued-note-put-into-${id}`)).toBeNull();

    await fireEvent.press(screen.getByTestId(`queued-note-discard-${id}`));
    const question = within(await screen.findByTestId('queued-note-delete-question'));
    expect(question.getByText('Discard your changes?')).toBeTruthy();
    expect(
      question.getByText(
        "“Fuse” is in your vault with its earlier words, and stays there. Your changes are only on this phone: discarding them can't be undone.",
      ),
    ).toBeTruthy();
    await fireEvent.press(screen.getByTestId('queued-note-delete-cancel'));
    await waitFor(() => expect(screen.queryByTestId('queued-note-delete-question')).toBeNull());
    expect(await store.list()).toHaveLength(1);
    await fireEvent.press(screen.getByTestId(`queued-note-discard-${id}`));
    await fireEvent.press(await screen.findByTestId('queued-note-delete-yes'));
    await waitFor(() => expect(queuedIds()).toEqual([]));
    expect(sent).toHaveLength(2);
    expect(made(v, 'Fuse')).toHaveLength(1);
  });

  it('a 422 idempotency_key_reused for a note unchanged since, its words as they went: sent, those words are there (M1)', async () => {
    const v = vault();
    keysAsDev45(v);
    scripted(v, (n, send) =>
      n === 1
        ? lose(send, v)
        : Promise.resolve(vaultError(422, 'idempotency_key_reused', 'That Idempotency-Key was already used for a different request.')),
    );
    const store = new MemoryQueueStore();
    await unlocked(v, <NotesScreen />, { capture: testCapture({ openStore: async () => store }) });
    await screen.findByTestId('notes-none');
    await writeNote('Boiler', 'Ring Ann first.');
    await waitFor(async () => expect(await store.list()).toEqual([]));
    expect(screen.queryByTestId(/^queued-note-arrived-/)).toBeNull();
    expect(made(v, 'Boiler')).toHaveLength(1);
  });
});

describe('Might already be in your vault, and Send again (S2, S3, S5)', () => {
  /** The first try made and its answer lost; the next refused outright. */
  const refusesSecond = (v: TestVault, status: number, code: string) =>
    scripted(v, (n, send) =>
      n === 1 ? lose(send, v, true) : n === 2 ? Promise.resolve(vaultError(status, code, 'You may not do that now.')) : send(),
    );

  it.each([
    [403, 'forbidden'],
    [422, 'validation_failed'],
  ] as const)(
    'a %i %s on a try after a lost answer says nothing of the first: Might already be in your vault, its key and its day kept',
    async (status, code) => {
      const v = vault();
      keysAsDev45(v);
      refusesSecond(v, status, code);
      const sent = recordPosts(v);
      const store = new MemoryQueueStore();
      await unlocked(v, <NotesScreen />, { capture: testCapture({ openStore: async () => store }) });
      await screen.findByTestId('notes-none');
      await writeNote('Boiler', 'Ring Ann first.');
      const id = await queuedId();
      const before = (await keptOf(store, id))?.sent;
      expect(before).toBeTruthy();
      v.reachable.add(ORIGIN);
      await networkChanged();
      await waitFor(() => expect(stateOf(id)).toHaveTextContent('Might already be in your vault'));
      expect((await keptOf(store, id))?.sent).toEqual({ ...before, failed: 0, busy: 0 });
      expect(sent).toHaveLength(2);

      // Send again, within its day: the same key and words — the vault's replay settles it, one note.
      expect(screen.getByTestId(`queued-note-send-again-${id}`).props.accessibilityLabel).toBe(
        'Send “Boiler” again, to find out whether it reached your vault',
      );
      await fireEvent.press(screen.getByTestId(`queued-note-send-again-${id}`));
      await waitFor(() => expect(queuedIds()).toEqual([]));
      expect(sent).toHaveLength(3);
      expect(sent[2]).toEqual(sent[0]);
      expect(made(v, 'Boiler')).toHaveLength(1);
    },
  );

  it('more than 23 hours after its first try: not sent by itself; Send again is a new note, under a new key', async () => {
    const v = vault();
    const clock = fakeClock();
    keysAsDev45(v, clock.now);
    scripted(v, (n, send) => (n === 1 ? lose(send, v, true) : send()));
    const sent = recordPosts(v);
    await unlocked(v, <NotesScreen />, { capture: testCapture({ now: clock.now, schedule: clock.schedule }) });
    await screen.findByTestId('notes-none');
    await writeNote('Boiler', 'Ring Ann first.');
    const id = await queuedId();
    expect(stateOf(id)).toHaveTextContent('Waiting to send');

    clock.advance(KEY_SAFE_MS + 60_000);
    v.reachable.add(ORIGIN);
    await networkChanged();
    await waitFor(() => expect(stateOf(id)).toHaveTextContent('Might already be in your vault'));
    expect(sent).toHaveLength(1);
    await networkChanged();
    expect(sent).toHaveLength(1);
    expect(screen.getByTestId(`queued-note-send-again-${id}`).props.accessibilityLabel).toBe(
      'Send “Boiler” again, as a new note',
    );
    expect(screen.getByTestId(`queued-note-open-${id}`).props.accessibilityLabel).toBe(
      "Boiler. Might already be in your vault. We sent this but didn't hear back. Check Notes first. If it isn't there, send it again.",
    );
    await fireEvent.press(screen.getByTestId(`queued-note-send-again-${id}`));
    await waitFor(() => expect(made(v, 'Boiler')).toHaveLength(2));
    expect(sent[1]?.key).not.toBe(sent[0]?.key);
  });

  it('the phone’s clock put back before the first try: the 23 hours can’t be told — not sent by itself (S5)', async () => {
    const v = vault();
    const clock = fakeClock();
    keysAsDev45(v, clock.now);
    scripted(v, (n, send) => (n === 1 ? lose(send, v, true) : send()));
    const sent = recordPosts(v);
    await unlocked(v, <NotesScreen />, { capture: testCapture({ now: clock.now, schedule: clock.schedule }) });
    await screen.findByTestId('notes-none');
    await writeNote('Boiler', 'Ring Ann first.');
    const id = await queuedId();
    clock.advance(-60 * 60_000);
    v.reachable.add(ORIGIN);
    await networkChanged();
    await waitFor(() => expect(stateOf(id)).toHaveTextContent('Might already be in your vault'));
    expect(sent).toHaveLength(1);
  });
});

describe('refused outright on its first try (S4)', () => {
  it('a 413: the note can be put right — shortened, it goes under the same key, as it is now', async () => {
    const v = vault();
    keysAsDev45(v);
    const inner = v.fetch;
    v.fetch = async (url, init) => {
      if (v.reachable.has(ORIGIN) && init.method === 'POST' && url === DOCS) {
        const body = JSON.parse(String(init.body)) as { notes?: string };
        if ((body.notes ?? '').length > 20) return vaultError(413, 'payload_too_large', 'That note is too big for this vault.');
      }
      return inner(url, init);
    };
    const sent = recordPosts(v);
    const store = new MemoryQueueStore();
    await unlocked(v, <NotesScreen />, { capture: testCapture({ openStore: async () => store }) });
    await screen.findByTestId('notes-none');
    v.reachable.delete(ORIGIN);
    await writeNote('Fuse', 'Under the stairs, on the left, behind the coats.');
    const id = await queuedId();
    v.reachable.add(ORIGIN);
    await networkChanged();
    await waitFor(() => expect(stateOf(id)).toHaveTextContent("Couldn't send — That note is too big for this vault."));
    expect((await keptOf(store, id))?.sent).toBeUndefined();

    await changeWords(id, 'Under the stairs.');
    await waitFor(() => expect(made(v, 'Fuse')).toHaveLength(1));
    await waitFor(() => expect(queuedIds()).toEqual([]));
    expect(made(v, 'Fuse')[0]?.notes).toBe('Under the stairs.');
    expect(sent).toHaveLength(2);
    expect(sent[1]?.key).toBe(sent[0]?.key);
  });
});

describe('a vault without idempotent_create (as 0.13.0)', () => {
  it('no key, nothing kept with one, a lost answer waits for its person, changed or not', async () => {
    const v = vault(false);
    scripted(v, (n, send) => (n === 1 ? lose(send, v) : send()));
    const sent = recordPosts(v);
    const store = new MemoryQueueStore();
    await unlocked(v, <NotesScreen />, { capture: testCapture({ openStore: async () => store }) });
    await screen.findByTestId('notes-none');
    await writeNote('Boiler', 'Ring Ann first.');
    const id = await queuedId();
    expect(stateOf(id)).toHaveTextContent('Might already be in your vault');
    expect(sent).toEqual([{ key: undefined, body: expect.objectContaining({ notes: 'Ring Ann first.' }) }]);
    expect((await keptOf(store, id))?.sent).toBeUndefined();
    expect(screen.getByTestId(`queued-note-send-again-${id}`).props.accessibilityLabel).toBe(
      'Send “Boiler” again, as a new note',
    );

    await changeWords(id, 'Ring Ann first, then Bob.', /didn't hear back/);
    await networkChanged();
    expect(sent).toHaveLength(1);
    expect((await store.list())[0]?.state).toBe('unsure');
  });
});

