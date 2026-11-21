import type { FetchLike } from '@fdv/client';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useState } from 'react';
import { AppState, Linking, Pressable, Text, TextInput, View, type AppStateStatus } from 'react-native';
import { APP_RELEASES_URL, APP_VERSION } from '../config';
import { SESSION_KEY } from '../session/store';
import { on } from '../state/events';
import { useVault } from '../state/vault';
import { installed, renderApp, respond, signedIn } from '../test-support/render';
import { testVault, type TestVault } from '../test-support/vault';
import { Blockers } from '../update/gate';

// The router, as far as the blocking screens use it: where the app is, and a kept Essential opened.
const nav = { pathname: '/', pushed: [] as unknown[] };
jest.mock('expo-router', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: (to: unknown) => nav.pushed.push(to), back: jest.fn(), replace: jest.fn() }),
}));

// What is kept on this phone, as Essentials would say it: a passport, here.
const kept = { items: [] as unknown[] };
jest.mock('../state/essentials', () => {
  const actual = jest.requireActual<typeof import('../state/essentials')>('../state/essentials');
  return {
    ...actual,
    useEssentials: () => ({ ...actual.useEssentials(), items: kept.items, age: null }),
  };
});

const ORIGIN = 'https://vault.test';
const MINUTE = 60_000;
const NEEDED = '9.1.0';

/** The rest of the app, under the blocking screens: a request to make, and where things stand. */
function Probe() {
  const { phase, withToken } = useVault();
  // A draft being written, as a scan's card or a note is: local state, lost if this is unmounted.
  const [draft, setDraft] = useState('');
  return (
    <View>
      <Text testID="phase">{phase}</Text>
      <Text testID="tabs">The tabs</Text>
      <TextInput testID="draft" accessibilityLabel="Draft" value={draft} onChangeText={setDraft} />
      <Pressable
        testID="ask"
        accessibilityRole="button"
        onPress={() => void withToken((api, token) => api.me(token)).catch(() => undefined)}
      >
        <Text>Ask</Text>
      </Pressable>
    </View>
  );
}

/** Where things stand, above the blocking screens: what a test reads after they cover the rest. */
function Phase() {
  const { phase } = useVault();
  return <Text testID="phase-above">{phase}</Text>;
}

const app = () => (
  <>
    <Phase />
    <Blockers>
      <Probe />
    </Blockers>
  </>
);

/** The vault's answer to an app older than it works with (0.9.0-dev.79). */
const tooOld = () =>
  respond(426, {
    error: {
      code: 'app_update_required',
      message: 'The app on this phone is too old for this vault. Update the app to keep using it.',
      min_client_version: NEEDED,
      retriable: false,
    },
  });

/** The test vault, answering 426 to whatever `refuse` picks while `on.value` says so. */
function refusing(t: TestVault, refuse: (url: string) => boolean, on: { value: boolean }): FetchLike {
  return async (url, init) => {
    if (on.value && refuse(url)) {
      t.calls.push(`${init.method ?? 'GET'} ${url}`);
      return tooOld();
    }
    return t.fetch(url, init);
  };
}

/** The app's AppState listeners, to bring it to the front by hand (as recheck.test.tsx does). */
function frontListeners() {
  let listeners: ((s: AppStateStatus) => void)[] = [];
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

const secure = () => (globalThis as unknown as { __secureStore: Map<string, string> }).__secureStore;

describe('an app too old for the vault, or a vault too old for the app (0.20.0)', () => {
  let rendered: { unmount(): unknown } | null = null;
  let front: ReturnType<typeof frontListeners>;
  let ended: string[];
  let offEnded: () => void;
  beforeEach(() => {
    installed();
    front = frontListeners();
    ended = [];
    offEnded = on('sessionEnded', (reason) => ended.push(reason));
  });
  afterEach(async () => {
    await rendered?.unmount();
    rendered = null;
    front.spy.mockRestore();
    offEnded();
  });

  it('the capability document read on coming back to the front says too old: the update screen, over everything', async () => {
    const t = testVault([ORIGIN]);
    await signedIn(t);
    let clock = 1_000_000;
    rendered = await renderApp(app(), { fetch: t.fetch, deps: { now: () => clock } });
    expect(await screen.findByTestId('tabs')).toBeTruthy();

    // The vault was updated meanwhile, and works with newer apps only.
    t.caps = { ...t.caps, min_client_version: NEEDED };
    clock += 6 * MINUTE;
    await front.toFront();

    expect(await screen.findByTestId('update-screen')).toBeTruthy();
    expect(screen.queryByTestId('tabs')).toBeNull();
    expect(screen.getByText('This app is too old for your vault. Update it to keep using it.')).toBeTruthy();
    expect(screen.getByTestId('update-needed')).toHaveTextContent(
      `Your vault needs version ${NEEDED} or newer. This is ${APP_VERSION}.`,
    );
    // The way to the update: this repository's releases page.
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await fireEvent.press(screen.getByTestId('update-open'));
    expect(open).toHaveBeenCalledWith(APP_RELEASES_URL);
    open.mockRestore();
    // Still signed in, nothing ended.
    expect(screen.getByTestId('phase-above')).toHaveTextContent('ready');
    expect(secure().get(SESSION_KEY)).toBeTruthy();
    expect(ended).toEqual([]);
  });

  it('a 426 from any call shows it, and Try again clears it once the vault answers that all is well', async () => {
    const t = testVault([ORIGIN]);
    await signedIn(t);
    const refuse = { value: true };
    rendered = await renderApp(app(), { fetch: refusing(t, (url) => url.endsWith('/api/v1/me'), refuse) });
    expect(await screen.findByTestId('tabs')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('ask'));
    expect(await screen.findByTestId('update-screen')).toBeTruthy();
    expect(screen.getByTestId('update-needed')).toHaveTextContent(new RegExp(`^Your vault needs version ${NEEDED} or newer`));
    expect(screen.getByTestId('phase-above')).toHaveTextContent('ready');
    expect(secure().get(SESSION_KEY)).toBeTruthy();
    expect(ended).toEqual([]);

    // The app was updated (here: the vault answers as it would then). Try again looks, and the app carries on,
    // the screens kept underneath told to look again at what they could not load.
    const carried = jest.fn();
    const off = on('carryOn', carried);
    refuse.value = false;
    await fireEvent.press(screen.getByTestId('update-try-again'));
    expect(await screen.findByTestId('tabs')).toBeTruthy();
    expect(screen.queryByTestId('update-screen')).toBeNull();
    expect(carried).toHaveBeenCalledTimes(1);
    off();
  });

  it('Try again while the vault still says too old keeps the screen, and says nothing has changed', async () => {
    const t = testVault([ORIGIN]);
    t.caps = { ...t.caps, min_client_version: NEEDED };
    await signedIn(t);
    // Too old from the start: the launch's own look says so.
    rendered = await renderApp(app(), { fetch: t.fetch });
    expect(await screen.findByTestId('update-screen')).toBeTruthy();
    expect(screen.queryByTestId('tabs')).toBeNull();

    await fireEvent.press(screen.getByTestId('update-try-again'));
    expect(await screen.findByTestId('update-said')).toHaveTextContent(
      'Nothing has changed yet. Try again once it is updated.',
    );
    expect(screen.getByTestId('update-screen')).toBeTruthy();
    expect(screen.getByTestId('phase-above')).toHaveTextContent('ready');
  });

  it('a renewal refused with 426 shows it, and the session and the phone’s copies stay', async () => {
    const t = testVault([ORIGIN]);
    await signedIn(t);
    const refuse = { value: true };
    rendered = await renderApp(app(), {
      fetch: refusing(t, (url) => url.endsWith('/api/v1/auth/refresh'), refuse),
    });
    const kept = secure().get(SESSION_KEY);

    // The first request after the launch needs an access token: the renewal is answered 426.
    expect(await screen.findByTestId('update-screen')).toBeTruthy();
    expect(screen.queryByTestId('tabs')).toBeNull();
    expect(t.calls.filter((c) => c.endsWith('/api/v1/auth/refresh')).length).toBeGreaterThan(0);
    // Never offline, never signed out: the session is exactly as it was, and nothing was told to go.
    expect(screen.getByTestId('phase-above')).toHaveTextContent('ready');
    expect(secure().get(SESSION_KEY)).toBe(kept);
    expect(ended).toEqual([]);
    expect(t.calls.filter((c) => c.endsWith('/api/v1/auth/logout'))).toHaveLength(0);

    refuse.value = false;
    await fireEvent.press(screen.getByTestId('update-try-again'));
    expect(await screen.findByTestId('tabs')).toBeTruthy();
    // And the session works again, as it was.
    const asked = t.calls.filter((c) => c.endsWith('/api/v1/me')).length;
    await fireEvent.press(screen.getByTestId('ask'));
    await waitFor(() => expect(t.calls.filter((c) => c.endsWith('/api/v1/me')).length).toBeGreaterThan(asked));
    expect(screen.getByTestId('phase-above')).toHaveTextContent('ready');
  });

  it('Sign out still works from the update screen, after asking', async () => {
    const t = testVault([ORIGIN]);
    await signedIn(t);
    rendered = await renderApp(app(), { fetch: refusing(t, (url) => url.endsWith('/api/v1/me'), { value: true }) });
    expect(await screen.findByTestId('tabs')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('ask'));
    expect(await screen.findByTestId('update-screen')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('update-sign-out'));
    await fireEvent.press(await screen.findByTestId('update-sign-out-yes'));
    await waitFor(() => expect(screen.getByTestId('phase-above')).toHaveTextContent('sign_in'));
    expect(t.calls.filter((c) => c.endsWith('/api/v1/auth/logout'))).toHaveLength(1);
    expect(secure().get(SESSION_KEY)).toBeUndefined();
    // Signed out, the app is still too old: the screen stays, with nothing to sign out of, and
    // no word that nothing was removed (signing out takes the kept Essentials); another vault instead.
    expect(screen.getByTestId('update-screen')).toBeTruthy();
    expect(screen.queryByTestId('update-sign-out')).toBeNull();
    expect(screen.queryByTestId('update-kept-words')).toBeNull();
    expect(screen.queryByText(/nothing on this phone has been removed/i)).toBeNull();
    await fireEvent.press(screen.getByTestId('update-other-vault'));
    await waitFor(() => expect(screen.getByTestId('phase-above')).toHaveTextContent('connect'));
    expect(screen.queryByTestId('update-screen')).toBeNull();
  });

  it('asking to sign out says the kept Essentials go with it', async () => {
    const t = testVault([ORIGIN]);
    await signedIn(t);
    rendered = await renderApp(app(), { fetch: refusing(t, (url) => url.endsWith('/api/v1/me'), { value: true }) });
    await fireEvent.press(await screen.findByTestId('ask'));
    await fireEvent.press(await screen.findByTestId('update-sign-out'));
    expect(await screen.findByText(/the Essentials kept on it are removed/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('update-sign-out-no'));
    expect(screen.getByTestId('phase-above')).toHaveTextContent('ready');
  });

  it('what was being written stays under the screen, and is there when it goes', async () => {
    const t = testVault([ORIGIN]);
    await signedIn(t);
    const refuse = { value: false };
    rendered = await renderApp(app(), { fetch: refusing(t, (url) => url.endsWith('/api/v1/me'), refuse) });
    await fireEvent.changeText(await screen.findByTestId('draft'), 'Half a note');
    refuse.value = true;
    await fireEvent.press(screen.getByTestId('ask'));
    expect(await screen.findByTestId('update-screen')).toBeTruthy();
    // Hidden underneath: not reachable, not read out.
    expect(screen.queryByTestId('draft')).toBeNull();
    expect(screen.getByTestId('draft', { includeHiddenElements: true })).toHaveDisplayValue('Half a note');

    refuse.value = false;
    await fireEvent.press(screen.getByTestId('update-try-again'));
    expect(await screen.findByTestId('draft')).toHaveDisplayValue('Half a note');
  });

  it('what is kept on the phone opens from the update screen: it needs no vault', async () => {
    const t = testVault([ORIGIN]);
    await signedIn(t);
    kept.items = [{ id: 'kept-1', document: { title: 'Passport' } }];
    nav.pushed = [];
    try {
      rendered = await renderApp(app(), { fetch: refusing(t, (url) => url.endsWith('/api/v1/me'), { value: true }) });
      await fireEvent.press(await screen.findByTestId('ask'));
      await fireEvent.press(await screen.findByTestId('update-show-kept'));
      expect(await screen.findByTestId('update-kept')).toHaveTextContent(/Passport/);
      await fireEvent.press(screen.getByLabelText('Open: Passport'));
      expect(nav.pushed).toEqual([{ pathname: '/essential/[id]', params: { id: 'kept-1' } }]);
    } finally {
      kept.items = [];
    }
  });

  it('a kept Essential open: shown above the update screen, which is back after it', async () => {
    const t = testVault([ORIGIN]);
    await signedIn(t);
    rendered = await renderApp(app(), { fetch: refusing(t, (url) => url.endsWith('/api/v1/me'), { value: true }) });
    await fireEvent.press(await screen.findByTestId('ask'));
    expect(await screen.findByTestId('update-screen')).toBeTruthy();
    nav.pathname = '/essential/kept-1';
    try {
      await fireEvent.press(screen.getByTestId('update-try-again'));
      await waitFor(() => expect(screen.queryByTestId('update-screen')).toBeNull());
    } finally {
      nav.pathname = '/';
    }
  });

  it('an answer to an older look never clears a newer 426', async () => {
    const t = testVault([ORIGIN]);
    await signedIn(t);
    let clock = 1_000_000;
    let release: () => void = () => undefined;
    const slow = { value: false };
    const refuse = { value: false };
    const inner = refusing(t, (url) => url.endsWith('/api/v1/me'), refuse);
    const fetch: FetchLike = async (url, init) => {
      if (slow.value && url.endsWith('/api/v1/capabilities')) {
        await new Promise<void>((done) => {
          release = done;
        });
      }
      return inner(url, init);
    };
    rendered = await renderApp(app(), { fetch, deps: { now: () => clock } });
    expect(await screen.findByTestId('tabs')).toBeTruthy();
    // A look begins (back in front after a while), and its answer is slow...
    slow.value = true;
    clock += 6 * MINUTE;
    await front.toFront();
    // ...meanwhile the vault answers a request 426.
    refuse.value = true;
    await fireEvent.press(screen.getByTestId('ask'));
    expect(await screen.findByTestId('update-screen')).toBeTruthy();
    // The older look's "all is well" arrives: the screen stays.
    slow.value = false;
    await act(async () => release());
    await act(async () => undefined);
    expect(screen.getByTestId('update-screen')).toBeTruthy();
  });

  it('a vault older than the app says so in its own words, with how to update it', async () => {
    const t = testVault([ORIGIN]);
    await signedIn(t);
    let clock = 1_000_000;
    rendered = await renderApp(app(), { fetch: t.fetch, deps: { now: () => clock } });
    expect(await screen.findByTestId('tabs')).toBeTruthy();

    // Restored from an old backup, say: older than the app works with.
    t.caps = { ...t.caps, server_version: '0.4.2' };
    clock += 6 * MINUTE;
    await front.toFront();

    expect(await screen.findByTestId('update-screen')).toBeTruthy();
    expect(screen.getByTestId('update-words')).toHaveTextContent(
      'Your vault is on version 0.4.2, and this app needs 0.4.10 or newer. Ask whoever runs your vault to update it.',
    );
    expect(screen.getByTestId('update-show-how')).toBeTruthy();
    expect(screen.queryByTestId('update-open')).toBeNull();
    expect(ended).toEqual([]);
  });
});
