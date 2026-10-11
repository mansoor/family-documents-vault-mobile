import { type as typeScale, type Capabilities } from '@fdv/shared';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Linking from 'expo-linking';
import { AccessibilityInfo, AppState, StyleSheet, type AppStateStatus } from 'react-native';
import CaptureScreen from '../app/capture';
import Settings from '../app/settings';
import SignIn from '../app/sign-in';
import { fixtureScanner, type ScanOutcome } from '../capture/scanner';
import { dayBatchKey } from '../queue/inbox';
import { MemoryQueueStore } from '../queue/store';
import { useCapture } from '../state/capture';
import { useVault } from '../state/vault';
import { audit } from '../test-support/a11y';
import { jpeg, reply } from '../test-support/capture';
import { addGuest, GUEST, signedInAs } from '../test-support/guest';
import Home, { add } from '../test-support/home';
import { ownerApi } from '../test-support/kinds';
import { installed, knownVault, renderApp, signedIn, testCapture } from '../test-support/render';
import { capabilities, testVault, type TestVault } from '../test-support/vault';
import { LARGE } from '../ui/text-scale';

/** Home's listeners for being in view again, as the tab navigator calls them. */
const mockListeners = new Map<string, Set<() => void>>();
jest.mock('expo-router', () => ({
  Link: (p: { children: unknown }) => p.children,
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
  useNavigation: () => ({
    addListener: (name: string, fn: () => void) => {
      const set = mockListeners.get(name) ?? new Set<() => void>();
      set.add(fn);
      mockListeners.set(name, set);
      return () => set.delete(fn);
    },
    dispatch: jest.fn(),
  }),
}));
jest.mock('expo-linking', () => ({ openURL: jest.fn(async () => true) }));

const ORIGIN = 'https://vault.test';
const TWO_PAGES: ScanOutcome = { kind: 'pages', pages: [{ uri: 'cache:/scan/1.jpg' }, { uri: 'cache:/scan/2.jpg' }] };
/** 10 Oct 2026, 09:30 on this phone's clock (the tests' clock is UTC). */
const TEN_OCT = new Date(2026, 9, 10, 9, 30).getTime();

/** A vault with batches (I1, v0.7.0-dev.12): Send to my Inbox, and the Inbox count. */
function withBatches(): Capabilities {
  return capabilities({
    server_version: '0.7.0-dev.12',
    features: { ...capabilities().features, custom_types: true, batches: true, batch_proposals: true },
  });
}

/** What the app shows: Home, or the card while a capture is on it, or sign-in once signed out. */
function App() {
  const { pending } = useCapture();
  const { phase } = useVault();
  if (phase === 'sign_in') return <SignIn />;
  return pending ? <CaptureScreen /> : <Home />;
}

const networkChanged = () =>
  act(() => {
    for (const l of (globalThis as unknown as { __networkListeners: Set<() => void> }).__networkListeners) l();
  });

/** The app's AppState listeners, to bring it to the front by hand (as offline.test.tsx does). */
function frontListeners() {
  let listeners: ((s: AppStateStatus) => void)[] = [];
  // The test setup's AppState is itself a mock: spying on it returns that
  // mock, and restoring would leave it with no implementation at all.
  const original = AppState.addEventListener;
  const before = jest.isMockFunction(original) ? original.getMockImplementation() : undefined;
  const mocked = jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, fn) => {
    const l = fn as (s: AppStateStatus) => void;
    listeners.push(l);
    return { remove: () => void (listeners = listeners.filter((x) => x !== l)) };
  });
  const spy = { mockRestore: () => (before ? mocked.mockImplementation(before) : mocked.mockRestore()) };
  const toFront = () =>
    act(async () => {
      for (const l of [...listeners]) l('active');
    });
  return { spy, toFront };
}

const focused = () =>
  act(() => {
    for (const l of mockListeners.get('focus') ?? []) l();
  });

/** A phone with a scan of two pages for each capture, a clock, and its queue. */
function phone(scans: number, now: () => number = () => TEN_OCT) {
  const store = new MemoryQueueStore();
  const outcomes: ScanOutcome[] = [];
  for (let i = 1; i <= scans; i += 1) {
    outcomes.push({ kind: 'pages', pages: [{ uri: `cache:/scan/${i}a.jpg` }, { uri: `cache:/scan/${i}b.jpg` }] });
  }
  const p = testCapture({ scanner: fixtureScanner(outcomes), openStore: async () => store, now });
  for (let i = 1; i <= scans; i += 1) {
    p.files.set(`cache:/scan/${i}a.jpg`, jpeg('letter-with-exif.jpg'));
    p.files.set(`cache:/scan/${i}b.jpg`, jpeg('card.jpg'));
  }
  return { p, store };
}

/** Each POST of a file into a batch: which batch, and the key it carried. */
interface Sent {
  batch: string;
  key: string | undefined;
}

/**
 * The test vault, with every file sent into a batch recorded, and the
 * answers the test scripts for them first (by batch, in order): a refusal,
 * or a lost answer — the vault keeps the file, the phone never hears.
 */
function recording(t: TestVault) {
  const sent: Sent[] = [];
  const scripted: { batch?: string; turn: 'lost' | { status: number; code: string } }[] = [];
  const fetch: TestVault['fetch'] = async (url, init) => {
    const m = /\/api\/v1\/batches\/([^/]+)\/items$/.exec(url);
    if (m?.[1] && init.method === 'POST') {
      const headers = (init.headers ?? {}) as Record<string, string>;
      sent.push({ batch: m[1], key: headers['idempotency-key'] });
      const i = scripted.findIndex((s) => s.batch === undefined || s.batch === m[1]);
      const s = i >= 0 ? scripted.splice(i, 1)[0] : undefined;
      if (s?.turn === 'lost') {
        await t.fetch(url, init);
        throw new TypeError('Network request failed');
      }
      if (s) return reply(s.turn.status, { error: { code: s.turn.code, message: 'Refused.', retriable: false } });
    }
    return t.fetch(url, init);
  };
  return { fetch, sent, scripted };
}

/** The batches the vault keeps for its one person, with what is waiting in each. */
const batches = (t: TestVault) =>
  t.vault.state.batches.map((b) => ({ name: b.name, waiting: b.items.filter((x) => x.state === 'waiting').length }));

/** A scan through the card, sent to the Inbox. */
async function sendOne() {
  await add();
  await fireEvent.press(await screen.findByTestId('capture-inbox'));
  await screen.findByTestId('home-saved');
}

beforeEach(() => {
  installed();
  mockListeners.clear();
});

describe('Send to my Inbox (I5)', () => {
  it("is the card's other button, says what it does, and the scan goes into the day's batch: made once, then used", async () => {
    const t = testVault([ORIGIN]);
    t.caps = withBatches();
    await signedIn(t);
    const rec = recording(t);
    const { p, store } = phone(2);
    const heard = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    await renderApp(<App />, { fetch: rec.fetch, capture: p });
    await screen.findByTestId('home-calm');

    await add();
    const button = await screen.findByTestId('capture-inbox');
    expect(button).toHaveTextContent('Send to my Inbox');
    expect(button.props.accessibilityLabel).toBe('Send to my Inbox');
    expect(button.props.accessibilityHint).toBe(
      'The vault reads it and suggests its details. You finish it in the browser.',
    );
    expect(screen.queryByTestId('capture-skip')).toBeNull();
    expect(audit()).toEqual([]);
    await fireEvent.press(button);

    // Sent, said, and said aloud; nothing of it is kept on the phone.
    const words = 'Sent to your Inbox. Finish it on the web: it will suggest the details.';
    await waitFor(() => expect(screen.getByTestId('home-saved')).toHaveTextContent(new RegExp(`^${words.replace(/\./g, '\\.')}`)));
    expect(heard).toHaveBeenCalledWith(words);
    expect(await store.list()).toEqual([]);
    expect(batches(t)).toEqual([{ name: 'From my phone, 10 Oct', waiting: 1 }]);
    // Not a document: nothing is filed, nothing needs a name.
    expect(t.vault.state.documents).toHaveLength(0);
    expect(t.calls.filter((c) => c.endsWith('/api/v1/capture'))).toEqual([]);
    // Home counts it, after the send.
    expect(await screen.findByTestId('home-inbox')).toHaveTextContent(/^1 waiting in your Inbox: review it in the browser/);

    // The second scan that day goes into the same batch, under a key of its own.
    await sendOne();
    await waitFor(() => expect(batches(t)).toEqual([{ name: 'From my phone, 10 Oct', waiting: 2 }]));
    expect(rec.sent).toHaveLength(2);
    expect(rec.sent[0]?.batch).toBe(rec.sent[1]?.batch);
    expect(rec.sent[0]?.key).toMatch(/^[0-9a-f-]{36}$/);
    expect(rec.sent[1]?.key).toMatch(/^[0-9a-f-]{36}$/);
    expect(rec.sent[0]?.key).not.toBe(rec.sent[1]?.key);
    expect(t.calls.filter((c) => c === `POST ${ORIGIN}/api/v1/batches`)).toHaveLength(1);
    expect(await screen.findByTestId('home-inbox')).toHaveTextContent(/^2 waiting in your Inbox: review them in the browser/);
    heard.mockRestore();
  });

  it('the next day, a new batch', async () => {
    const t = testVault([ORIGIN]);
    t.caps = withBatches();
    await signedIn(t);
    let now = TEN_OCT;
    const { p } = phone(2, () => now);
    await renderApp(<App />, { fetch: t.fetch, capture: p });
    await screen.findByTestId('home-calm');
    await sendOne();
    await waitFor(() => expect(batches(t)).toHaveLength(1));
    now = TEN_OCT + 24 * 3600_000;
    await sendOne();
    await waitFor(() =>
      expect(batches(t)).toEqual([
        { name: 'From my phone, 10 Oct', waiting: 1 },
        { name: 'From my phone, 11 Oct', waiting: 1 },
      ]),
    );
  });

  it('an answer lost on the way: sent again to the same batch under the same key, and in the Inbox once', async () => {
    const t = testVault([ORIGIN]);
    t.caps = withBatches();
    await signedIn(t);
    const rec = recording(t);
    rec.scripted.push({ turn: 'lost' });
    const { p, store } = phone(1);
    await renderApp(<App />, { fetch: rec.fetch, capture: p });
    await screen.findByTestId('home-calm');
    await sendOne();
    await waitFor(() => expect(rec.sent).toHaveLength(1));
    // The vault has it; the phone does not know yet, and keeps it.
    await waitFor(async () => expect(await store.list()).toHaveLength(1));
    expect(batches(t)).toEqual([{ name: 'From my phone, 10 Oct', waiting: 1 }]);

    await networkChanged();
    await waitFor(async () => expect(await store.list()).toEqual([]));
    expect(rec.sent).toHaveLength(2);
    expect(rec.sent[1]).toEqual(rec.sent[0]);
    expect(batches(t)).toEqual([{ name: 'From my phone, 10 Oct', waiting: 1 }]);
  });

  it('lost at 23:59 and sent again after midnight: still the batch it first went to, not the new day’s', async () => {
    const t = testVault([ORIGIN]);
    t.caps = withBatches();
    await signedIn(t);
    const rec = recording(t);
    rec.scripted.push({ turn: 'lost' });
    let now = new Date(2026, 9, 10, 23, 59).getTime();
    const { p, store } = phone(1, () => now);
    await renderApp(<App />, { fetch: rec.fetch, capture: p });
    await screen.findByTestId('home-calm');
    await sendOne();
    await waitFor(() => expect(rec.sent).toHaveLength(1));
    await waitFor(async () => expect((await store.list())[0]?.target).toBe(rec.sent[0]?.batch));

    now = new Date(2026, 9, 11, 0, 1).getTime();
    await networkChanged();
    await waitFor(async () => expect(await store.list()).toEqual([]));
    expect(rec.sent[1]).toEqual(rec.sent[0]);
    expect(batches(t)).toEqual([{ name: 'From my phone, 10 Oct', waiting: 1 }]);
  });

  it('lost, then removed on the web before it was sent again: done with, never Needs you', async () => {
    const t = testVault([ORIGIN]);
    t.caps = withBatches();
    await signedIn(t);
    const rec = recording(t);
    rec.scripted.push({ turn: 'lost' });
    const { p, store } = phone(1);
    await renderApp(<App />, { fetch: rec.fetch, capture: p });
    await screen.findByTestId('home-calm');
    await sendOne();
    await waitFor(() => expect(batches(t)).toEqual([{ name: 'From my phone, 10 Oct', waiting: 1 }]));
    // "Not a document, remove it", at a computer.
    for (const it of t.vault.state.batches[0]?.items ?? []) it.state = 'removed';

    await networkChanged();
    await waitFor(async () => expect(await store.list()).toEqual([]));
    expect(rec.sent).toHaveLength(2);
    expect(screen.queryByText('Needs you')).toBeNull();
  });

  it('saved for the Inbox, but the vault has no batches when it goes (rolled back): filed as Skip would', async () => {
    const t = testVault([ORIGIN]);
    await signedIn(t);
    const store = new MemoryQueueStore();
    await store.add(
      {
        id: 'q1',
        kind: 'inbox',
        target: null,
        key: '5b1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
        origin: ORIGIN,
        account: 'fake-member',
        createdAt: 1,
        state: 'waiting',
        metadata: null,
        filename: 'Scan.pdf',
        mime: 'application/pdf',
        size: 4,
        attempts: 0,
        nextAt: 0,
        askFirst: false,
        problem: null,
        lastCode: null,
      },
      new TextEncoder().encode('%PDF-1.4\n%%EOF\n'),
    );
    await renderApp(<App />, { fetch: t.fetch, capture: testCapture({ openStore: async () => store }) });
    await waitFor(() => expect(t.vault.state.documents).toHaveLength(1));
    expect(t.vault.state.documents[0]).toMatchObject({ type_key: null });
    expect(t.calls.filter((c) => c.includes('/api/v1/batches'))).toEqual([]);
    await waitFor(async () => expect(await store.list()).toEqual([]));
  });

  it.each([
    ['has ended', { status: 409, code: 'batch_ended' }],
    ['is full', { status: 422, code: 'batch_full' }],
  ])('a batch that %s: a new one, for this scan and the next', async (_what, turn) => {
    const t = testVault([ORIGIN]);
    t.caps = withBatches();
    await signedIn(t);
    const rec = recording(t);
    const { p, store } = phone(2);
    await renderApp(<App />, { fetch: rec.fetch, capture: p });
    await screen.findByTestId('home-calm');
    await sendOne();
    await waitFor(() => expect(batches(t)).toEqual([{ name: 'From my phone, 10 Oct', waiting: 1 }]));
    const first = rec.sent[0]?.batch;
    rec.scripted.push({ batch: first as string, turn });

    await sendOne();
    await waitFor(async () => expect(await store.list()).toEqual([]));
    expect(batches(t)).toEqual([
      { name: 'From my phone, 10 Oct', waiting: 1 },
      { name: 'From my phone, 10 Oct', waiting: 1 },
    ]);
    // The refused try and the one after it carried the same key, to a new batch.
    expect(rec.sent.slice(1).map((s) => s.batch === first)).toEqual([true, false]);
    expect(rec.sent[2]?.key).toBe(rec.sent[1]?.key);
    expect(await store.cached(dayBatchKey({ origin: ORIGIN, account: 'fake-member' }))).toEqual({
      id: rec.sent[2]?.batch,
      day: '2026-10-10',
    });
    expect(screen.queryByText('Needs you')).toBeNull();
  });

  it('a batch removed on the web (404): a new one', async () => {
    const t = testVault([ORIGIN]);
    t.caps = withBatches();
    await signedIn(t);
    const rec = recording(t);
    const { p, store } = phone(2);
    await renderApp(<App />, { fetch: rec.fetch, capture: p });
    await screen.findByTestId('home-calm');
    await sendOne();
    await waitFor(() => expect(batches(t)).toHaveLength(1));
    // At a computer, the whole batch is removed.
    t.vault.state.batches = [];

    await sendOne();
    await waitFor(async () => expect(await store.list()).toEqual([]));
    expect(batches(t)).toEqual([{ name: 'From my phone, 10 Oct', waiting: 1 }]);
    expect(rec.sent.map((s) => s.batch === rec.sent[0]?.batch)).toEqual([true, true, false]);
  });

  it('with no connection: kept in the queue, said so, and sent — its batch made then — once there is one', async () => {
    const t = testVault([ORIGIN]);
    t.caps = withBatches();
    await signedIn(t);
    const { p, store } = phone(1);
    await renderApp(<App />, { fetch: t.fetch, capture: p });
    await screen.findByTestId('home-calm');
    // The card's choices kept; then airplane mode.
    await waitFor(() => expect(t.calls.some((c) => c.includes('/api/v1/members'))).toBe(true));
    t.reachable.delete(ORIGIN);

    await sendOne();
    await waitFor(() =>
      expect(screen.getByTestId('home-saved')).toHaveTextContent(
        /^Saved on this phone\. It'll go to your Inbox as soon as there's a connection\./,
      ),
    );
    expect(await screen.findByText('A scan for your Inbox')).toBeTruthy();
    const [waiting] = await store.list();
    expect(waiting).toMatchObject({ kind: 'inbox', target: null, metadata: null });
    expect(batches(t)).toEqual([]);

    t.reachable.add(ORIGIN);
    await networkChanged();
    await waitFor(async () => expect(await store.list()).toEqual([]));
    expect(batches(t)).toEqual([{ name: 'From my phone, 10 Oct', waiting: 1 }]);
    await waitFor(() =>
      expect(screen.getByTestId('home-saved')).toHaveTextContent(/^Sent to your Inbox\. Finish it on the web/),
    );
  });

  it('a card opened with no connection since the start offers it as the vault last said', async () => {
    const t = testVault([ORIGIN]);
    t.caps = withBatches();
    await signedIn(t);
    const { p, store } = phone(1);
    const first = await renderApp(<App />, { fetch: t.fetch, capture: p });
    await screen.findByTestId('home-calm');
    await waitFor(async () =>
      expect(await store.cached(`card|${ORIGIN}|fake-member|kinds`)).toEqual({ customTypes: true, batches: true }),
    );
    await first.unmount();

    // The next start, in airplane mode: the vault says nothing.
    t.reachable.delete(ORIGIN);
    await renderApp(<App />, { fetch: t.fetch, capture: { ...p, openStore: async () => store } });
    await add();
    await fireEvent.press(await screen.findByTestId('capture-inbox'));
    await waitFor(async () => expect((await store.list()).map((i) => i.kind)).toEqual(['inbox']));
  });

  it('an older vault keeps Skip: a document with no name, as before', async () => {
    const t = testVault([ORIGIN]);
    await signedIn(t);
    const { p } = phone(1);
    await renderApp(<App />, { fetch: t.fetch, capture: p });
    await screen.findByTestId('home-calm');
    await add();
    const skip = await screen.findByTestId('capture-skip');
    expect(skip).toHaveTextContent('Skip');
    expect(screen.queryByTestId('capture-inbox')).toBeNull();
    await fireEvent.press(skip);
    await waitFor(() => expect(t.vault.state.documents).toHaveLength(1));
    expect(screen.getByTestId('home-saved')).toHaveTextContent(/^Saved\. It's under Needs a name/);
    expect(t.calls.filter((c) => c.includes('/api/v1/batches'))).toEqual([]);
    expect(screen.queryByTestId('home-inbox')).toBeNull();
  });

  it('signing out and removing what is waiting takes the Inbox scans with it', async () => {
    const t = testVault([ORIGIN]);
    t.caps = withBatches();
    await signedIn(t);
    // The vault is busy for files: the scan waits.
    const busy: TestVault['fetch'] = async (url, init) =>
      /\/items$/.test(url)
        ? reply(503, { error: { code: 'unavailable', message: 'Busy.', retriable: true } })
        : t.fetch(url, init);
    const { p, store } = phone(1);
    function Both() {
      const { phase } = useVault();
      const { pending, queue } = useCapture();
      if (phase === 'sign_in') return <SignIn />;
      if (pending) return <CaptureScreen />;
      return queue.length > 0 ? <Settings /> : <Home />;
    }
    await renderApp(<Both />, { fetch: busy, capture: p });
    await screen.findByTestId('home-calm');
    await add();
    await fireEvent.press(await screen.findByTestId('capture-inbox'));
    await waitFor(async () => expect(await store.list()).toHaveLength(1));
    await fireEvent.press(await screen.findByTestId('settings-sign-out'));
    expect(await screen.findByTestId('sign-out-question')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('sign-out-remove'));
    await screen.findByTestId('sign-in-go');
    expect(await store.list()).toEqual([]);
    expect(batches(t).every((b) => b.waiting === 0)).toBe(true);
  });
});

describe("the Inbox count on Home (I5)", () => {
  /** Files already waiting in the person's Inbox, sent from a computer. */
  async function waitingFromComputer(t: TestVault, n: number) {
    const { api, token } = await ownerApi(t.vault);
    const b = await api.createBatch(token, { name: 'Scanner folder' });
    for (let i = 0; i < n; i += 1) {
      await api.addBatchItem(token, b.id, {
        kind: 'bytes',
        filename: `scan-${i}.pdf`,
        contentType: 'application/pdf',
        bytes: new TextEncoder().encode(`%PDF-1.4\n${i}\n%%EOF\n`),
      });
    }
    return { api, token, batch: b.id };
  }

  it('says how many wait, and where: the vault’s /inbox in the browser', async () => {
    const t = testVault([ORIGIN]);
    t.caps = withBatches();
    await signedIn(t);
    await waitingFromComputer(t, 3);
    await renderApp(<Home />, { fetch: t.fetch });
    const line = await screen.findByTestId('home-inbox');
    expect(line).toHaveTextContent('3 waiting in your Inbox: review them in the browserAt vault.test/inbox');
    expect(audit()).toEqual([]);
    const open = screen.getByTestId('home-inbox-open');
    expect(open.props.accessibilityLabel).toBe('Open your Inbox in the browser');
    expect(open.props.accessibilityHint).toBe('Opens vault.test/inbox');
    await fireEvent.press(open);
    expect(Linking.openURL).toHaveBeenCalledWith('https://vault.test/inbox');
    // The light list: no levels asked for.
    expect(t.calls).toContain(`GET ${ORIGIN}/api/v1/batches`);
    expect(t.calls.some((c) => c.includes('with=levels'))).toBe(false);
  });

  it('is hidden when nothing waits', async () => {
    const t = testVault([ORIGIN]);
    t.caps = withBatches();
    await signedIn(t);
    await waitingFromComputer(t, 0);
    await renderApp(<Home />, { fetch: t.fetch });
    await screen.findByTestId('home-calm');
    await waitFor(() => expect(t.calls).toContain(`GET ${ORIGIN}/api/v1/batches`));
    expect(screen.queryByTestId('home-inbox')).toBeNull();
  });

  it('is asked again each time Home is in view', async () => {
    const t = testVault([ORIGIN]);
    t.caps = withBatches();
    await signedIn(t);
    const { api, token, batch } = await waitingFromComputer(t, 1);
    await renderApp(<Home />, { fetch: t.fetch });
    expect(await screen.findByTestId('home-inbox')).toHaveTextContent(/^1 waiting/);

    // Meanwhile, at a computer, another file goes in.
    await api.addBatchItem(token, batch, {
      kind: 'bytes',
      filename: 'late.pdf',
      contentType: 'application/pdf',
      bytes: new TextEncoder().encode('%PDF-1.4\nlate\n%%EOF\n'),
    });
    await focused();
    await waitFor(() => expect(screen.getByTestId('home-inbox')).toHaveTextContent(/^2 waiting/));

    // …and both are dealt with: gone from Home once it looks again.
    t.vault.state.batches = [];
    await focused();
    await waitFor(() => expect(screen.queryByTestId('home-inbox')).toBeNull());
  });

  it('is asked again when the app comes back to the front', async () => {
    const t = testVault([ORIGIN]);
    t.caps = withBatches();
    await signedIn(t);
    const { api, token, batch } = await waitingFromComputer(t, 1);
    const front = frontListeners();
    try {
      await renderApp(<Home />, { fetch: t.fetch });
      expect(await screen.findByTestId('home-inbox')).toHaveTextContent(/^1 waiting/);
      await api.addBatchItem(token, batch, {
        kind: 'bytes',
        filename: 'late.pdf',
        contentType: 'application/pdf',
        bytes: new TextEncoder().encode('%PDF-1.4\nlate\n%%EOF\n'),
      });
      await front.toFront();
      await waitFor(() => expect(screen.getByTestId('home-inbox')).toHaveTextContent(/^2 waiting/));
    } finally {
      front.spy.mockRestore();
    }
  });

  it('a guest — a viewer — is never asked, and sees nothing', async () => {
    const t = testVault([ORIGIN]);
    t.caps = withBatches();
    await waitingFromComputer(t, 2);
    addGuest(t, new Date(Date.now() + 30 * 864e5).toISOString());
    knownVault(ORIGIN, { email: GUEST.email });
    await signedInAs(t, GUEST.email, GUEST.password);
    await renderApp(<Home />, { fetch: t.fetch });
    await screen.findByTestId('home-list');
    await waitFor(() => expect(t.calls.some((c) => c.includes('/api/v1/reminders'))).toBe(true));
    await focused();
    expect(screen.queryByTestId('home-inbox')).toBeNull();
    expect(t.calls.filter((c) => c.includes('/api/v1/batches'))).toEqual([]);
  });

  it('an older vault: no count, and nothing asked', async () => {
    const t = testVault([ORIGIN]);
    await signedIn(t);
    await renderApp(<Home />, { fetch: t.fetch });
    await screen.findByTestId('home-calm');
    await focused();
    expect(screen.queryByTestId('home-inbox')).toBeNull();
    expect(t.calls.filter((c) => c.includes('/api/v1/batches'))).toEqual([]);
  });

  it('at the large text setting, its words are 1.3 times the size', async () => {
    const t = testVault([ORIGIN]);
    t.caps = withBatches();
    await signedIn(t);
    await waitingFromComputer(t, 1);
    const size = () =>
      Number(StyleSheet.flatten(screen.getByText(/waiting in your Inbox/).props.style)?.fontSize ?? 0);
    const normal = await renderApp(<Home />, { fetch: t.fetch, large: false });
    await screen.findByTestId('home-inbox');
    expect(size()).toBe(typeScale.body);
    await normal.unmount();
    await renderApp(<Home />, { fetch: t.fetch, large: true });
    await screen.findByTestId('home-inbox');
    expect(size()).toBeCloseTo(typeScale.body * LARGE, 5);
  });
});
