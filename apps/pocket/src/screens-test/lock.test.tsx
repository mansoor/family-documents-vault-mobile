import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useEffect } from 'react';
import { AppState, BackHandler, type AppStateStatus } from 'react-native';
import Home from '../app/index';
import Settings from '../app/settings';
import SignIn from '../app/sign-in';
import { KeyRing } from '../lock/keys';
import { LockGate } from '../lock/gate';
import type { AuthOutcome, LockLevel } from '../lock/types';
import { writePrefs } from '../platform/prefs';
import { useLock, useScreenGuard, type LockDeps } from '../state/lock';
import { useVault } from '../state/vault';
import { installed, knownVault, renderApp, signedIn } from '../test-support/render';
import { testVault } from '../test-support/vault';

jest.mock('expo-router', () => ({
  Link: (p: { children: unknown }) => p.children,
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
  useNavigation: () => ({ addListener: () => () => undefined, dispatch: jest.fn() }),
}));

/** What the app shows, as its root layout decides it: through the lock's gate. */
function App(props: { page?: 'home' | 'settings' }) {
  const { phase } = useVault();
  const { status } = useLock();
  const screen =
    phase === 'sign_in' ? (
      <SignIn />
    ) : phase !== 'ready' || status === 'checking' ? null : props.page === 'settings' ? (
      <Settings />
    ) : (
      <Home />
    );
  return <LockGate>{screen}</LockGate>;
}

let clock = 1_000_000;
let appState: ((s: AppStateStatus) => void)[] = [];
let backs: (() => boolean)[] = [];

/** The phone moving the app to the back or the front. */
const emit = (state: AppStateStatus) => {
  Object.defineProperty(AppState, 'currentState', { value: state, configurable: true });
  for (const l of [...appState]) l(state);
};
const goTo = (state: AppStateStatus) => act(async () => emit(state));
const pressBack = () =>
  act(async () => {
    for (const h of [...backs].reverse()) if (h()) break;
  });

function phone(over: { level?: LockLevel; outcome?: AuthOutcome; autoPrompt?: boolean } = {}) {
  const calls = { prompts: 0, exited: 0, shielded: new Set<string>() };
  let outcome: AuthOutcome = over.outcome ?? 'ok';
  const keys = new KeyRing();
  const deps: Partial<LockDeps> = {
    auth: {
      level: async () => over.level ?? 'strong',
      authenticate: async () => {
        calls.prompts += 1;
        return outcome;
      },
    },
    keys,
    screen: {
      prevent: async (name) => void calls.shielded.add(name),
      allow: async (name) => void calls.shielded.delete(name),
    },
    now: () => clock,
    exitApp: () => void (calls.exited += 1),
    autoPrompt: over.autoPrompt ?? false,
  };
  return { deps, calls, keys, answer: (o: AuthOutcome) => void (outcome = o) };
}

beforeEach(() => {
  installed();
  clock = 1_000_000;
  appState = [];
  backs = [];
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, fn) => {
    const listener = fn as (s: AppStateStatus) => void;
    appState.push(listener);
    return { remove: () => void (appState = appState.filter((l) => l !== listener)) };
  });
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_type, fn) => {
    const handler = fn as () => boolean;
    backs.push(handler);
    return { remove: () => void (backs = backs.filter((b) => b !== handler)) };
  });
});
afterEach(() => jest.restoreAllMocks());

async function signedInApp(p: ReturnType<typeof phone>, page?: 'home' | 'settings') {
  const t = testVault();
  await signedIn(t);
  await renderApp(<App {...(page ? { page } : {})} />, { fetch: t.fetch, lock: p.deps });
  return t;
}

describe('the lock', () => {
  it('cold start is locked, and nothing of the app is behind it', async () => {
    const p = phone();
    await signedInApp(p);
    expect(await screen.findByTestId('lock-screen')).toBeTruthy();
    expect(screen.getByText('Unlock to open your vault.')).toBeTruthy();
    expect(screen.queryByTestId('home-calm')).toBeNull();
    expect(p.keys.everydayKey).toBeNull();
  });

  it('the PIN opens the app and the everyday copies’ key', async () => {
    const p = phone();
    await signedInApp(p);
    await fireEvent.press(await screen.findByTestId('lock-unlock'));
    expect(await screen.findByTestId('home-calm')).toBeTruthy();
    expect(p.calls.prompts).toBe(1);
    expect(p.keys.everydayKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it('back within the timeout stays unlocked, after it locks', async () => {
    const p = phone();
    await signedInApp(p);
    await fireEvent.press(await screen.findByTestId('lock-unlock'));
    await screen.findByTestId('home-calm');

    await goTo('background');
    clock += 30_000;
    await goTo('active');
    expect(screen.queryByTestId('lock-screen')).toBeNull();
    expect(screen.getByTestId('home-calm')).toBeTruthy();

    await goTo('background');
    clock += 70_000;
    await goTo('active');
    expect(await screen.findByTestId('lock-screen')).toBeTruthy();
    expect(screen.queryByTestId('home-calm')).toBeNull();
    // Locked, the key is out of memory.
    expect(p.keys.everydayKey).toBeNull();
  });

  it('"Immediately" locks as the app leaves, so nothing shows when it comes back', async () => {
    writePrefs('lock', { timeout: 'immediately', screenshots: false });
    const p = phone();
    await signedInApp(p);
    await fireEvent.press(await screen.findByTestId('lock-unlock'));
    await screen.findByTestId('home-calm');
    await goTo('background');
    expect(await screen.findByTestId('lock-screen')).toBeTruthy();
  });

  it('Back on the lock screen leaves the app, and never reveals content', async () => {
    const p = phone({ outcome: 'cancelled' });
    await signedInApp(p);
    await screen.findByTestId('lock-screen');
    await pressBack();
    expect(p.calls.exited).toBe(1);
    expect(screen.getByTestId('lock-screen')).toBeTruthy();
    expect(screen.queryByTestId('home-calm')).toBeNull();
    // Declining the prompt leaves it locked too.
    await fireEvent.press(screen.getByTestId('lock-unlock'));
    expect(screen.getByTestId('lock-screen')).toBeTruthy();
  });

  it('too many tries says to use the phone’s PIN or pattern', async () => {
    const p = phone({ outcome: 'lockout' });
    await signedInApp(p);
    await fireEvent.press(await screen.findByTestId('lock-unlock'));
    expect(await screen.findByText("Too many tries. Unlock with your phone's PIN or pattern instead.")).toBeTruthy();
    p.answer('ok');
    await fireEvent.press(screen.getByTestId('lock-unlock'));
    expect(await screen.findByTestId('home-calm')).toBeTruthy();
  });

  it('no screen lock turns offline off with the explanation, and everything else works', async () => {
    const p = phone({ level: 'none' });
    await signedInApp(p, 'settings');
    expect(
      await screen.findByText(
        "To lock the app and keep documents on this phone, set a screen lock in your phone's settings first. Everything else works as it is.",
      ),
    ).toBeTruthy();
    expect(screen.queryByTestId('lock-screen')).toBeNull();
    expect(p.keys.everydayKey).toBeNull();
    expect(p.calls.prompts).toBe(0);
  });

  it('a phone without strong biometrics says Only me documents cannot be kept', async () => {
    const p = phone({ level: 'weak' });
    await signedInApp(p, 'settings');
    await fireEvent.press(await screen.findByTestId('lock-unlock'));
    expect(await screen.findByTestId('settings-weak-biometrics')).toHaveTextContent(
      "This phone's face or fingerprint unlock isn't strong enough to protect your Only me documents, so they can't be kept here.",
    );
  });

  it('signing in with a password does not ask to unlock again', async () => {
    knownVault();
    const t = testVault();
    const p = phone();
    await renderApp(<App />, { fetch: t.fetch, lock: p.deps });
    await fireEvent.changeText(await screen.findByTestId('sign-in-email'), 'owner@example.test');
    await fireEvent.changeText(screen.getByTestId('sign-in-password'), 'correct horse battery staple');
    await fireEvent.press(screen.getByTestId('sign-in-go'));
    expect(await screen.findByTestId('home-calm')).toBeTruthy();
    expect(screen.queryByTestId('lock-screen')).toBeNull();
    expect(p.calls.prompts).toBe(0);
    expect(p.keys.everydayKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it('the app’s own screens — the scanner, a picker, the prompt — are not leaving it, for a while', async () => {
    writePrefs('lock', { timeout: 'immediately', screenshots: false });
    const p = phone();
    const grabbed: { lock: ReturnType<typeof useLock> | null } = { lock: null };
    function Grab() {
      const lock = useLock();
      useEffect(() => {
        grabbed.lock = lock;
      });
      return null;
    }
    const t = testVault();
    await signedIn(t);
    await renderApp(
      <>
        <Grab />
        <App />
      </>,
      { fetch: t.fetch, lock: p.deps },
    );
    await fireEvent.press(await screen.findByTestId('lock-unlock'));
    await screen.findByTestId('home-calm');
    const scan = (minutes: number) =>
      act(async () => {
        await (grabbed.lock as ReturnType<typeof useLock>).away(async () => {
          emit('background');
          clock += minutes * 60_000;
          emit('active');
        });
      });
    // A four-minute scan, with "Immediately": still open.
    await scan(4);
    expect(screen.queryByTestId('lock-screen')).toBeNull();
    // Home pressed inside the scanner, and the phone left for ten minutes: locked.
    await scan(10);
    expect(await screen.findByTestId('lock-screen')).toBeTruthy();
    expect(p.keys.everydayKey).toBeNull();
  });

  it('a password sign-in never brings up the phone’s own prompt', async () => {
    knownVault();
    const t = testVault();
    const p = phone({ autoPrompt: true });
    await renderApp(<App />, { fetch: t.fetch, lock: p.deps });
    await fireEvent.changeText(await screen.findByTestId('sign-in-email'), 'owner@example.test');
    await fireEvent.changeText(screen.getByTestId('sign-in-password'), 'correct horse battery staple');
    await fireEvent.press(screen.getByTestId('sign-in-go'));
    expect(await screen.findByTestId('home-calm')).toBeTruthy();
    expect(p.calls.prompts).toBe(0);
  });

  it('away, the app is covered until it is known whether it locks', async () => {
    const p = phone();
    await signedInApp(p);
    await fireEvent.press(await screen.findByTestId('lock-unlock'));
    await screen.findByTestId('home-calm');
    await goTo('background');
    expect(screen.getByTestId('lock-cover')).toBeTruthy();
    clock += 20_000;
    await goTo('active');
    expect(screen.queryByTestId('lock-cover')).toBeNull();
    expect(screen.queryByTestId('lock-screen')).toBeNull();
  });

  it('the prompt waits until the app is in front', async () => {
    writePrefs('lock', { timeout: 'immediately', screenshots: false });
    const p = phone({ autoPrompt: true, outcome: 'cancelled' });
    await signedInApp(p);
    // Asked at the cold start, in front.
    await screen.findByTestId('lock-screen');
    await waitFor(() => expect(p.calls.prompts).toBe(1));
    p.answer('ok');
    await fireEvent.press(screen.getByTestId('lock-unlock'));
    await screen.findByTestId('home-calm');
    // "Immediately": locked as it leaves — and not asked until it is back.
    await goTo('background');
    await screen.findByTestId('lock-screen');
    expect(p.calls.prompts).toBe(2);
    await goTo('active');
    await waitFor(() => expect(p.calls.prompts).toBe(3));
  });

  it('kept out of screenshots while open, unless allowed — and the card never', async () => {
    const p = phone();
    function Card() {
      useScreenGuard('card');
      return null;
    }
    const t = testVault();
    await signedIn(t);
    await renderApp(
      <>
        <Card />
        <App page="settings" />
      </>,
      { fetch: t.fetch, lock: p.deps },
    );
    await screen.findByTestId('lock-screen');
    expect([...p.calls.shielded]).toEqual(['card']);
    await fireEvent.press(screen.getByTestId('lock-unlock'));
    await screen.findByTestId('settings-screenshots');
    expect(p.calls.shielded).toEqual(new Set(['card', 'app']));
    await fireEvent(screen.getByTestId('settings-screenshots'), 'valueChange', true);
    // Allowed: the app's screens may be captured; the card still may not.
    expect([...p.calls.shielded]).toEqual(['card']);
  });
});
