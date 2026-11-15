import { fireEvent, screen, waitFor, within, act } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';
import NotesScreen from '../app/(tabs)/notes';
import Settings from '../app/settings';
import type { FetchLike } from '@fdv/client';
import { setPhoneOffline } from '../net/reach';
import type { QueueItem } from '../queue/item';
import { NOTE_MIME } from '../queue/note';
import { MemoryQueueStore } from '../queue/store';
import { SecureTokenStore } from '../session/store';
import { VaultCard } from '../settings/vault-card';
import { audit } from '../test-support/a11y';
import { libraryDoc, unlocked } from '../test-support/lookup';
import { installed, respond, testCapture } from '../test-support/render';
import { push, resetRoutes, routes } from '../test-support/router';
import { caps0519, capabilities, testVault, type TestVault } from '../test-support/vault';

jest.mock(
  'expo-router',
  () => jest.requireActual<typeof import('../test-support/router')>('../test-support/router').routerMock,
);

const ORIGIN = 'https://vault.test';
const DOCS = `${ORIGIN}/api/v1/documents`;

beforeEach(() => {
  installed();
  resetRoutes();
  setPhoneOffline(false);
});

/** A vault of 0.9.0: notes kept on their own, and collections with checklists and managers. */
function vault(features: Record<string, boolean> = {}): TestVault {
  const v = testVault([ORIGIN]);
  v.caps = capabilities({
    features: {
      ...caps0519().features,
      notes: true,
      collections: true,
      collection_checklist: true,
      collection_managers: true,
      ...features,
    },
  });
  return v;
}

/** The phone keeps this role for whoever signed in (the fake signs everybody in as its owner). */
const withRole = (role: string) => async () => {
  const store = new SecureTokenStore();
  const kept = await store.load();
  await store.save({ ...(kept as NonNullable<typeof kept>), role: role as never });
};

const networkChanged = () =>
  act(() => {
    for (const l of (globalThis as unknown as { __networkListeners: Set<() => void> }).__networkListeners) l();
  });

/** Every POST /documents the phone made, reached or not. */
const posts = (v: TestVault) => v.calls.filter((c) => c === `POST ${DOCS}`).length;
/** The vault's notes with this title. */
const made = (v: TestVault, title: string) => v.vault.state.documents.filter((d) => d.title === title);

/** New note, from Notes' +: a title, words, who can see it, then Save. */
async function writeNote(title: string, words: string, visibility?: 'household' | 'adults' | 'private') {
  await fireEvent.press(await screen.findByTestId('notes-new'));
  await fireEvent.changeText(await screen.findByTestId('new-note-title'), title);
  await fireEvent.changeText(screen.getByTestId('new-note-words'), words);
  if (visibility) await fireEvent.press(screen.getByTestId(`new-note-${visibility}`));
  await fireEvent.press(screen.getByTestId('new-note-save'));
  await waitFor(() => expect(routes()).toEqual([]));
}

/** The ids of the notes waiting on the phone, as Notes shows them. */
function queuedIds(): string[] {
  return screen.queryAllByTestId(/^queued-note-state-/).map((r) => String(r.props.testID).replace('queued-note-state-', ''));
}
async function queuedId(): Promise<string> {
  await waitFor(() => expect(queuedIds()).toHaveLength(1));
  return queuedIds()[0] as string;
}

/** A note already in the phone's queue, as the queue keeps one. */
async function queued(
  store: MemoryQueueStore,
  over: Partial<QueueItem> & { id: string },
  payload: Record<string, unknown> | string,
) {
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
  await store.add(item, new TextEncoder().encode(typeof payload === 'string' ? payload : JSON.stringify(payload)));
}

/** The vault answers the POST of a note, then the answer is lost on the way back (once). */
function losesAnswer(v: TestVault) {
  const inner = v.fetch;
  const state = { lose: true };
  v.fetch = async (url, init) => {
    const res = await inner(url, init);
    if (state.lose && init.method === 'POST' && url === DOCS) {
      state.lose = false;
      throw new TypeError('Network request failed');
    }
    return res;
  };
  return state;
}

describe('a new note written while the vault can’t be reached (0.13.0)', () => {
  it('is kept on the phone, Waiting to send, and sent once when the vault is back', async () => {
    const v = vault();
    const store = new MemoryQueueStore();
    await unlocked(v, <NotesScreen />, { capture: testCapture({ openStore: async () => store }) });
    await screen.findByTestId('notes-none');

    v.reachable.delete(ORIGIN);
    await writeNote('Gate code', 'The blue door, then left.', 'private');
    const id = await queuedId();
    expect(screen.getByTestId(`queued-note-state-${id}`)).toHaveTextContent('Waiting to send');
    expect(screen.getByTestId('notes-outbox-why')).toHaveTextContent(/Each goes by itself/);
    expect(audit()).toEqual([]);
    // Kept as a scan is, in the encrypted queue: what it says is its bytes, with its client id.
    const [kept] = await store.list();
    expect(kept).toEqual(expect.objectContaining({ kind: 'note', metadata: null, account: 'fake-member', state: 'waiting' }));
    expect(JSON.parse(new TextDecoder().decode((await store.bytes(id)) ?? new Uint8Array()))).toEqual({
      title: 'Gate code',
      notes: 'The blue door, then left.',
      visibility: 'private',
      clientId: kept?.key,
    });
    // Nothing went: the vault didn't answer just before.
    expect(posts(v)).toBe(0);

    v.reachable.add(ORIGIN);
    await networkChanged();
    await waitFor(() => expect(made(v, 'Gate code')).toHaveLength(1));
    expect(made(v, 'Gate code')[0]).toEqual(
      expect.objectContaining({ type_key: 'note', visibility: 'private', notes: 'The blue door, then left.' }),
    );
    // Gone from the phone once the vault has it, and an ordinary note in the list.
    await waitFor(() => expect(queuedIds()).toEqual([]));
    expect(await store.list()).toEqual([]);
    expect(await screen.findByTestId(`note-${made(v, 'Gate code')[0]?.id}`)).toBeTruthy();
    await networkChanged();
    expect(posts(v)).toBe(1);
  });

  it('two alike, written offline: both sent, as two notes', async () => {
    const v = vault();
    await unlocked(v, <NotesScreen />);
    await screen.findByTestId('notes-none');
    v.reachable.delete(ORIGIN);
    await writeNote('Milk', 'Buy milk.');
    await writeNote('Milk', 'Buy milk.');
    await waitFor(() => expect(queuedIds()).toHaveLength(2));
    v.reachable.add(ORIGIN);
    await networkChanged();
    await waitFor(() => expect(made(v, 'Milk')).toHaveLength(2));
    await waitFor(() => expect(queuedIds()).toEqual([]));
    expect(posts(v)).toBe(2);
  });

  it('a try whose answer was lost: "Might already be in your vault", never sent again by itself; Send again sends it as a new note', async () => {
    const v = vault();
    losesAnswer(v);
    const store = new MemoryQueueStore();
    await unlocked(v, <NotesScreen />, { capture: testCapture({ openStore: async () => store }) });
    await screen.findByTestId('notes-none');
    await writeNote('Boiler', 'Ring Ann first.');
    const id = await queuedId();
    // It did arrive — but the phone never heard, and never guesses.
    expect(made(v, 'Boiler')).toHaveLength(1);
    expect(screen.getByTestId(`queued-note-state-${id}`)).toHaveTextContent('Might already be in your vault');
    expect(screen.getByTestId(`queued-note-unsure-${id}`)).toHaveTextContent(
      "We sent this but didn't hear back. Check Notes first. If it isn't there, send it again.",
    );
    expect((await store.list())[0]?.state).toBe('unsure');
    expect(screen.getByTestId(`queued-note-send-again-${id}`).props.accessibilityLabel).toBe(
      'Send “Boiler” again, as a new note',
    );
    expect(audit()).toEqual([]);
    // Never again by itself: a network change, the app back in front.
    await networkChanged();
    expect(posts(v)).toBe(1);

    // Open Notes: every note asked for again — it's there.
    await fireEvent.press(screen.getByTestId(`queued-note-look-${id}`));
    expect(await screen.findByTestId(`note-${made(v, 'Boiler')[0]?.id}`)).toBeTruthy();

    // The person's choice: Send again — a new note, under a new client id.
    const before = (await store.list())[0]?.key;
    await fireEvent.press(screen.getByTestId(`queued-note-send-again-${id}`));
    await waitFor(() => expect(made(v, 'Boiler')).toHaveLength(2));
    await waitFor(() => expect(queuedIds()).toEqual([]));
    expect(posts(v)).toBe(2);
    expect(before).toBeTruthy();
  });

  it('one that might already be there, deleted from the phone, asked first — the one in Notes stays', async () => {
    const v = vault();
    losesAnswer(v);
    const store = new MemoryQueueStore();
    await unlocked(v, <NotesScreen />, { capture: testCapture({ openStore: async () => store }) });
    await screen.findByTestId('notes-none');
    await writeNote('Boiler', 'Ring Ann first.');
    const id = await queuedId();
    await fireEvent.press(screen.getByTestId(`queued-note-delete-${id}`));
    const question = within(await screen.findByTestId('queued-note-delete-question'));
    expect(question.getByText(/“Boiler” might already be in your vault\. Deleting it here only removes it from this phone/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('queued-note-delete-yes'));
    await waitFor(() => expect(queuedIds()).toEqual([]));
    expect(await store.list()).toEqual([]);
    expect(made(v, 'Boiler')).toHaveLength(1);
  });

  it('a 503 from the POST: might have arrived, said so — not sent again', async () => {
    const v = vault();
    const inner = v.fetch;
    let tried = 0;
    v.fetch = async (url, init) => {
      if (init.method !== 'POST' || url !== DOCS) return inner(url, init);
      tried += 1;
      return respond(503, {});
    };
    await unlocked(v, <NotesScreen />);
    await screen.findByTestId('notes-none');
    await writeNote('Fuse', 'Under the stairs.');
    const id = await queuedId();
    expect(screen.getByTestId(`queued-note-state-${id}`)).toHaveTextContent('Might already be in your vault');
    await networkChanged();
    expect(tried).toBe(1);
  });

  it('refused for good: kept, "Couldn\'t send" with the vault’s reason, Try again sends it', async () => {
    const v = vault();
    const inner = v.fetch;
    let refuse = false;
    v.fetch = async (url, init) => {
      if (refuse && init.method === 'POST' && url === DOCS) {
        return respond(422, { error: { code: 'validation_failed', message: 'That note is not one the vault takes.' } });
      }
      return inner(url, init);
    };
    await unlocked(v, <NotesScreen />);
    await screen.findByTestId('notes-none');
    v.reachable.delete(ORIGIN);
    await writeNote('Fuse box', 'Under the stairs.');
    const id = await queuedId();

    refuse = true;
    v.reachable.add(ORIGIN);
    await networkChanged();
    await waitFor(() =>
      expect(screen.getByTestId(`queued-note-state-${id}`)).toHaveTextContent(
        "Couldn't send — That note is not one the vault takes.",
      ),
    );
    expect(screen.getByTestId(`queued-note-retry-${id}`).props.accessibilityLabel).toBe('Try sending “Fuse box” again');
    const tried = posts(v);
    await networkChanged();
    expect(posts(v)).toBe(tried);

    refuse = false;
    await fireEvent.press(screen.getByTestId(`queued-note-retry-${id}`));
    await waitFor(() => expect(made(v, 'Fuse box')).toHaveLength(1));
    await waitFor(() => expect(queuedIds()).toEqual([]));
  });

  /** The vault refuses Adults only (403), as it does somebody who can no longer choose it. */
  function refusesAdults(v: TestVault) {
    const inner = v.fetch;
    v.fetch = async (url, init) => {
      if (v.reachable.has(ORIGIN) && init.method === 'POST' && url === DOCS) {
        const body = JSON.parse(String(init.body)) as { visibility?: string };
        if (body.visibility === 'adults') {
          return respond(403, { error: { code: 'forbidden', message: 'Only an adult can make a document adults-only.' } });
        }
      }
      return inner(url, init);
    };
  }

  it('Adults only, refused, from somebody who can no longer choose it (a teen now): sent as Only me, and said so', async () => {
    const v = vault();
    refusesAdults(v);
    const store = new MemoryQueueStore();
    await queued(store, { id: 'will' }, { title: 'Will', notes: 'In the safe.', visibility: 'adults' });
    await unlocked(v, <NotesScreen />, { capture: testCapture({ openStore: async () => store }), before: withRole('teen') });
    await waitFor(() => expect(made(v, 'Will')).toHaveLength(1));
    expect(made(v, 'Will')[0]?.visibility).toBe('private');
    expect(await screen.findByTestId('notes-narrowed')).toHaveTextContent(
      /^“Will” was sent as Only me: you can no longer make notes Adults only\./,
    );
  });

  it('Adults only refused for anybody who can still choose it: "Couldn\'t send", their choice untouched', async () => {
    const v = vault();
    refusesAdults(v);
    const store = new MemoryQueueStore();
    await queued(store, { id: 'will' }, { title: 'Will', notes: 'In the safe.', visibility: 'adults' });
    await unlocked(v, <NotesScreen />, { capture: testCapture({ openStore: async () => store }) });
    await waitFor(() =>
      expect(screen.getByTestId('queued-note-state-will')).toHaveTextContent(
        "Couldn't send — Only an adult can make a document adults-only.",
      ),
    );
    expect(made(v, 'Will')).toEqual([]);
    expect(JSON.parse(new TextDecoder().decode((await store.bytes('will')) ?? new Uint8Array())).visibility).toBe('adults');
    expect(screen.queryByTestId('notes-narrowed')).toBeNull();
  });

  it('opened and changed before it goes: nothing is sent while it is open, even with the vault back; Save sends it as changed', async () => {
    const v = vault();
    await unlocked(v, <NotesScreen />);
    await screen.findByTestId('notes-none');
    v.reachable.delete(ORIGIN);
    await writeNote('Wifi', 'Ask Sam.');
    const id = await queuedId();
    await fireEvent.press(screen.getByTestId(`queued-note-open-${id}`));
    expect(routes().at(-1)).toEqual({ pathname: '/new-note', params: { queued: id } });
    expect(await screen.findByTestId('new-note-queued')).toHaveTextContent(/only on this phone/);
    expect(screen.getByTestId('new-note-title').props.value).toBe('Wifi');

    // The vault is back while it is open: nothing goes.
    v.reachable.add(ORIGIN);
    await networkChanged();
    await fireEvent.changeText(screen.getByTestId('new-note-words'), 'Ask Sam, or look on the router.');
    expect(posts(v)).toBe(0);

    await fireEvent.press(screen.getByTestId('new-note-save'));
    await waitFor(() => expect(made(v, 'Wifi')).toHaveLength(1));
    expect(made(v, 'Wifi')[0]?.notes).toBe('Ask Sam, or look on the router.');
    expect(posts(v)).toBe(1);
  });

  it('while it is on its way: nothing to change or delete; a change typed meanwhile is kept as a new note', async () => {
    const v = vault();
    const inner = v.fetch;
    let letGo: () => void = () => undefined;
    let hold = false;
    v.fetch = async (url, init) => {
      if (hold && init.method === 'POST' && url === DOCS) {
        hold = false;
        await new Promise<void>((resolve) => {
          letGo = resolve;
        });
      }
      return inner(url, init);
    };
    const store = new MemoryQueueStore();
    await unlocked(v, <NotesScreen />, { capture: testCapture({ openStore: async () => store }) });
    await screen.findByTestId('notes-none');
    v.reachable.delete(ORIGIN);
    await writeNote('Keys', 'Under the mat.');
    const id = await queuedId();

    hold = true;
    v.reachable.add(ORIGIN);
    await networkChanged();
    await waitFor(() => expect(screen.getByTestId(`queued-note-state-${id}`)).toHaveTextContent('Sending…'));
    // Nothing to change or delete on its row, and the store refuses both.
    expect(screen.queryByTestId(`queued-note-delete-${id}`)).toBeNull();
    expect(screen.getByTestId(`queued-note-open-${id}`).props.accessibilityState.disabled).toBe(true);
    expect(await store.removeIdle(id)).toBe('sending');
    expect(await store.replaceBytes(id, new Uint8Array([1]), {})).toBe('sending');

    // Opened anyway (a link): it says so, and Save waits.
    await act(async () => push({ pathname: '/new-note', params: { queued: id } }));
    expect(await screen.findByTestId('new-note-queued')).toHaveTextContent(/on its way to your vault now/);
    expect(screen.getByTestId('new-note-save').props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
    await fireEvent.changeText(screen.getByTestId('new-note-words'), 'Under the mat, or with Sam.');

    // It arrives as it was; what was typed is kept as a new note, by the person's choice.
    await act(async () => letGo());
    await waitFor(() => expect(made(v, 'Keys')).toHaveLength(1));
    expect(made(v, 'Keys')[0]?.notes).toBe('Under the mat.');
    await waitFor(() => expect(screen.getByTestId('new-note-save')).toHaveTextContent('Save as a new note'));
    await fireEvent.press(screen.getByTestId('new-note-save'));
    await waitFor(() => expect(made(v, 'Keys')).toHaveLength(2));
    expect(made(v, 'Keys')[1]?.notes).toBe('Under the mat, or with Sam.');
  });

  it('deleted from the phone only when the person says so, asked first', async () => {
    const v = vault();
    const store = new MemoryQueueStore();
    await unlocked(v, <NotesScreen />, { capture: testCapture({ openStore: async () => store }) });
    await screen.findByTestId('notes-none');
    v.reachable.delete(ORIGIN);
    await writeNote('Old note', 'Not needed.');
    const id = await queuedId();

    await fireEvent.press(screen.getByTestId(`queued-note-delete-${id}`));
    const question = within(await screen.findByTestId('queued-note-delete-question'));
    expect(question.getByText('Delete this note?')).toBeTruthy();
    expect(question.getByText(/“Old note” hasn't reached your vault, so it's only on this phone/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('queued-note-delete-cancel'));
    await waitFor(() => expect(screen.queryByTestId('queued-note-delete-question')).toBeNull());
    expect(await store.list()).toHaveLength(1);

    await fireEvent.press(screen.getByTestId(`queued-note-delete-${id}`));
    await fireEvent.press(await screen.findByTestId('queued-note-delete-yes'));
    await waitFor(() => expect(queuedIds()).toEqual([]));
    expect(await store.list()).toEqual([]);
    v.reachable.add(ORIGIN);
    await networkChanged();
    expect(posts(v)).toBe(0);
    expect(made(v, 'Old note')).toEqual([]);
  });

  it('left "sending" by an app that closed: might already be there, never stuck', async () => {
    const v = vault();
    const store = new MemoryQueueStore();
    await queued(store, { id: 'cut', state: 'sending' }, { title: 'Cut off', notes: 'x', visibility: 'private' });
    await unlocked(v, <NotesScreen />, { capture: testCapture({ openStore: async () => store }) });
    await waitFor(() =>
      expect(screen.getByTestId('queued-note-state-cut')).toHaveTextContent('Might already be in your vault'),
    );
    expect((await store.list())[0]?.state).toBe('unsure');
    expect(screen.getByTestId('queued-note-delete-cut')).toBeTruthy();
    expect(posts(v)).toBe(0);
  });

  it('a note whose words can’t be read is shown so, and deleted asked first — never dropped unseen', async () => {
    const v = vault();
    const store = new MemoryQueueStore();
    await queued(store, { id: 'bad' }, 'not a note');
    await unlocked(v, <NotesScreen />, { capture: testCapture({ openStore: async () => store }) });
    await waitFor(() => expect(screen.getByTestId('queued-note-state-bad')).toHaveTextContent("Couldn't read this note"));
    expect(screen.getByTestId('queued-note-open-bad').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByTestId('queued-note-delete-bad'));
    await fireEvent.press(await screen.findByTestId('queued-note-delete-yes'));
    await waitFor(() => expect(queuedIds()).toEqual([]));
    expect(await store.list()).toEqual([]);
  });

  it('is never shown to, changed or deleted by somebody else signed in on this phone', async () => {
    const v = vault();
    const store = new MemoryQueueStore();
    await queued(store, { id: 'theirs', account: 'somebody-else' }, { title: 'Their secret', notes: 'x', visibility: 'private' });
    await unlocked(v, <NotesScreen />, { capture: testCapture({ openStore: async () => store }) });
    await screen.findByTestId('notes-none');
    expect(screen.queryByTestId('notes-outbox')).toBeNull();
    expect(screen.queryByText('Their secret')).toBeNull();
    expect(made(v, 'Their secret')).toEqual([]);
    expect(await store.list()).toHaveLength(1);
  });

  it('a vault that takes an Idempotency-Key (features.idempotent_create): a lost answer is sent again by itself, under the same key — one note', async () => {
    const v = vault({ idempotent_create: true });
    const inner = v.fetch;
    const answers = new Map<string, Awaited<ReturnType<FetchLike>>>();
    const keys: (string | undefined)[] = [];
    let lose = true;
    // As such a vault would: the same key answers what the first POST made.
    v.fetch = async (url, init) => {
      if (init.method !== 'POST' || url !== DOCS) return inner(url, init);
      const key = init.headers['idempotency-key'];
      keys.push(key);
      const kept = key ? answers.get(key) : undefined;
      if (kept) return kept;
      const res = await inner(url, init);
      const body = await res.json();
      if (key) answers.set(key, respond(201, body));
      if (lose) {
        lose = false;
        throw new TypeError('Network request failed');
      }
      return respond(201, body);
    };
    await unlocked(v, <NotesScreen />);
    await screen.findByTestId('notes-none');
    await writeNote('Boiler', 'Ring Ann first.');
    await waitFor(() => expect(keys).toHaveLength(2));
    await waitFor(() => expect(queuedIds()).toEqual([]));
    expect(made(v, 'Boiler')).toHaveLength(1);
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(keys[1]).toBe(keys[0]);
  });

  it('a note already in the vault says plainly that changing it needs a connection', async () => {
    const v = vault();
    libraryDoc(v, { id: 'n1', title: 'Boiler', type_key: 'note', category: null, notes: 'Ring Ann.' });
    push({ pathname: '/edit/[id]', params: { id: 'n1' } });
    await unlocked(v, <Text>Notes</Text>);
    await screen.findByTestId('edit-note-words');
    expect(screen.queryByTestId('edit-note-offline')).toBeNull();
    v.reachable.delete(ORIGIN);
    await fireEvent.changeText(screen.getByTestId('edit-note-words'), 'Ring Ann first.');
    await fireEvent.press(screen.getByTestId('edit-save'));
    expect(await screen.findByTestId('edit-note-offline')).toHaveTextContent(
      /^Changing a note needs a connection to your vault\. New notes can be written now/,
    );
    expect(screen.queryAllByTestId(/^queued-note-/)).toHaveLength(0);
  });
});

describe('notes on the phone when leaving (0.13.0)', () => {
  it('Change vault counts every note written here for it — anybody’s, on its way or not — and removes them, asked first', async () => {
    const v = vault();
    const store = new MemoryQueueStore();
    const words = { title: 'Secret', notes: 'x', visibility: 'private' };
    await queued(store, { id: 'a', state: 'needs_you' }, words);
    await queued(store, { id: 'b', state: 'unsure' }, words);
    await queued(store, { id: 'c', account: 'somebody-else', state: 'sending' }, words);
    await unlocked(v, <VaultCard />, { capture: testCapture({ openStore: async () => store }) });
    await fireEvent.press(await screen.findByTestId('account-change-vault'));
    const question = await screen.findByTestId('change-vault-question');
    await waitFor(() =>
      expect(within(question).getByTestId('change-vault-notes')).toHaveTextContent(
        "3 notes written on this phone haven't reached this vault, or may be on their way. They will be removed from this phone, and can't be got back.",
      ),
    );
    // A count only: nothing of what they say.
    expect(within(question).queryByText(/Secret/)).toBeNull();
    expect(await store.list()).toHaveLength(3);
    await fireEvent.press(screen.getByTestId('change-vault-yes'));
    await waitFor(async () => expect(await store.list()).toEqual([]));
  });

  it('Sign out with notes not sent: said, and Remove them takes them off the phone', async () => {
    const v = vault();
    const store = new MemoryQueueStore();
    await queued(store, { id: 'a', state: 'unsure' }, { title: 'One', notes: 'x', visibility: 'private' });
    await queued(store, { id: 'b', state: 'needs_you' }, { title: 'Two', notes: 'x', visibility: 'private' });
    await unlocked(v, <Settings />, { capture: testCapture({ openStore: async () => store }) });
    await fireEvent.press(await screen.findByTestId('settings-sign-out'));
    expect(await screen.findByTestId('sign-out-notes')).toHaveTextContent("2 notes you wrote haven't reached the vault yet.");
    await fireEvent.press(screen.getByTestId('sign-out-remove'));
    await waitFor(async () => expect(await store.list()).toEqual([]));
  });
});

describe("a collection's page (0.13.0)", () => {
  /** "Trip", for everyone, made by the person signed in. */
  function trip(v: TestVault) {
    v.vault.state.collections.push({
      id: 'trip',
      name: 'Trip',
      description: null,
      audience: 'everyone',
      owner_member_id: 'fake-member',
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-01T00:00:00Z',
      revision: 1,
      deleted: false,
      items: [],
      managers: [],
    } as never);
  }

  it('Add documents and Fill from a checklist share one row, each label whole on one line', async () => {
    const v = vault();
    trip(v);
    push({ pathname: '/collection/[id]', params: { id: 'trip' } });
    await unlocked(v, <Text>Collections</Text>);
    const row = await screen.findByTestId('collection-actions');
    // Side by side, and a second that does not fit goes under the first — never cut.
    expect(StyleSheet.flatten(row.props.style)).toEqual(
      expect.objectContaining({ flexDirection: 'row', flexWrap: 'wrap' }),
    );
    for (const [id, words] of [
      ['collection-add', 'Add documents'],
      ['collection-checklist-fill', 'Fill from a checklist'],
    ] as const) {
      const button = within(row).getByTestId(id);
      const label = within(button).getByText(words);
      // Never cut to a number of lines, nor made smaller.
      expect(label.props.numberOfLines).toBeUndefined();
      expect(StyleSheet.flatten(label.props.style).fontSize).toBe(14);
      const look = StyleSheet.flatten(
        typeof button.props.style === 'function' ? button.props.style({ pressed: false }) : button.props.style,
      );
      // Less room at its sides than a button's 12, as tall as any (44).
      expect(look).toEqual(expect.objectContaining({ paddingHorizontal: 8, minHeight: 44 }));
    }
  });

  it('Managers is in the ⋯, not on the page', async () => {
    const v = vault();
    trip(v);
    push({ pathname: '/collection/[id]', params: { id: 'trip' } });
    await unlocked(v, <Text>Collections</Text>);
    await screen.findByTestId('collection-line');
    expect(screen.queryByTestId('collection-managers')).toBeNull();
    await fireEvent.press(screen.getByTestId('collection-more'));
    const managers = await screen.findByTestId('collection-managers');
    expect(managers.props.accessibilityLabel).toBe('Managers. Nobody else manages it yet.');
    await fireEvent.press(managers);
    await waitFor(() =>
      expect(routes().at(-1)).toEqual({ pathname: '/managers/[id]', params: { id: 'trip', name: 'Trip' } }),
    );
  });
});
