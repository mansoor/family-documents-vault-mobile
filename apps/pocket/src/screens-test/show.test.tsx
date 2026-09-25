import type { DocumentView } from '@fdv/shared';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useEffect, useState } from 'react';
import { AppState, BackHandler, StyleSheet, type AppStateStatus } from 'react-native';
import Home from '../app/index';
import type { Tier } from '../essentials/open';
import { MemoryEssentialsStore } from '../essentials/store';
import { CHECKED_KEY } from '../essentials/sync';
import { OWNER_KEY } from '../essentials/wipe';
import { LockGate } from '../lock/gate';
import { KeyRing } from '../lock/keys';
import { readPrefs, writePrefs } from '../platform/prefs';
import { recoverBrightness } from '../show/brightness';
import type { ShowPlatform } from '../show/platform';
import { CONTROLS_FOR_MS, SHOW_FOR_MS, ShowMode } from '../show/show';
import type { EssentialsDeps } from '../state/essentials';
import { useLock, type LockDeps } from '../state/lock';
import { useVault } from '../state/vault';
import { audit } from '../test-support/a11y';
import { installed, renderApp, signedIn } from '../test-support/render';
import { testVault } from '../test-support/vault';

/** Where Home's Show button goes: the test's own screen shows it. */
const mockNav: { go: (p: { params: { id: string } }) => void } = { go: () => undefined };
jest.mock('expo-router', () => ({
  Link: (p: { children: unknown }) => p.children,
  useRouter: () => ({
    push: (p: unknown) => mockNav.go(p as { params: { id: string } }),
    back: jest.fn(),
    replace: jest.fn(),
    canGoBack: () => true,
  }),
  useNavigation: () => ({ addListener: () => () => undefined, dispatch: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));

const ORIGIN = 'https://vault.test';

/** The phone's side of Show mode, recorded. */
function fakePlatform(over: Partial<ShowPlatform> = {}) {
  const calls: string[] = [];
  let readerListener: ((on: boolean) => void) | null = null;
  const platform: ShowPlatform = {
    brightness: async () => 0.4,
    setBrightness: async (v) => void calls.push(`brightness ${v}`),
    restoreBrightness: async (saved) => void calls.push(`restore ${saved}`),
    keepAwake: async (on) => void calls.push(`awake ${on}`),
    orientation: async (to) => void calls.push(`turn ${to}`),
    immersive: async (on) => void calls.push(`immersive ${on}`),
    screenReader: async () => false,
    onScreenReader: (l) => {
      readerListener = l;
      return () => {
        readerListener = null;
      };
    },
    ...over,
  };
  return { platform, calls, reader: (on: boolean) => act(async () => readerListener?.(on)) };
}

let showing: { platform: ShowPlatform; showForMs?: number; controlsForMs?: number } = {
  platform: fakePlatform().platform,
};

/** The app's gates, with Home's Show button opening Show mode here. */
function App() {
  const { phase } = useVault();
  const { status } = useLock();
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    mockNav.go = (p) => setShown(p.params.id);
  }, []);
  const content =
    phase !== 'ready' || status === 'checking' ? null : shown ? (
      <ShowMode id={shown} onLeave={() => setShown(null)} {...showing} />
    ) : (
      <Home />
    );
  return <LockGate>{content}</LockGate>;
}

let appState: ((s: AppStateStatus) => void)[] = [];
let backs: (() => boolean)[] = [];
const toBack = () =>
  act(async () => {
    for (const l of [...appState]) l('background');
  });
const pressBack = () =>
  act(async () => {
    for (const h of [...backs].reverse()) if (h()) break;
  });

/** A phone that keeps a two-page passport, unlocked, on Home. */
async function phone() {
  const t = testVault([ORIGIN]);
  const stores = new Map<Tier, MemoryEssentialsStore>();
  const kept = new MemoryEssentialsStore();
  stores.set('everyday', kept);
  const view = { id: 'passport', title: 'Passport', owner_member_id: 'fake-member' } as DocumentView;
  await kept.putDocument({
    id: 'passport',
    version_id: 'passport-v1',
    view: JSON.stringify(view),
    pages: 2,
    kept_at: 1,
  });
  for (const n of [1, 2]) await kept.putPage('passport-v1', n, new Uint8Array([0xff, 0xd8, 0xff, n, 0xff, 0xd9]));
  await kept.setState(OWNER_KEY, 'https://vault.test|fake-member');
  await kept.setState(
    CHECKED_KEY,
    JSON.stringify({ server_time: '2026-09-20T00:00:00Z', at: Date.now(), max_offline_days: 90 }),
  );
  writePrefs('essentials', { enrolled: true, offered: true, kept: true, owner: 'https://vault.test|fake-member' });
  const lock: Partial<LockDeps> = {
    auth: { level: async () => 'strong', authenticate: async () => 'ok' },
    keys: new KeyRing(),
    screen: { prevent: async () => undefined, allow: async () => undefined },
    exitApp: () => undefined,
    autoPrompt: false,
  };
  const essentials: Partial<EssentialsDeps> = {
    io: {
      open: async (tier: Tier) => stores.get(tier) ?? new MemoryEssentialsStore(),
      remove: async (tier: Tier) => void stores.delete(tier),
    },
  };
  await signedIn(t);
  t.reachable.delete(ORIGIN);
  const app = await renderApp(<App />, { fetch: t.fetch, lock, essentials });
  await fireEvent.press(await screen.findByTestId('lock-unlock'));
  await screen.findByTestId('essential-passport');
  return { t, kept, app };
}

async function enterShow() {
  await fireEvent.press(screen.getByTestId('essential-show-passport'));
  return screen.findByTestId('show-image');
}

beforeEach(() => {
  installed();
  writePrefs('show-brightness', null);
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

describe('Show mode', () => {
  it('entering saves brightness and sets full', async () => {
    const fake = fakePlatform();
    showing = { platform: fake.platform };
    await phone();
    await enterShow();
    await waitFor(() => expect(fake.calls).toContain('brightness 1'));
    expect(readPrefs('show-brightness', null)).toEqual({ value: 0.4 });
    expect(fake.calls).toEqual(expect.arrayContaining(['awake true', 'turn free', 'immersive true']));
  });

  it('exit, background and unmount restore it', async () => {
    // Done.
    let fake = fakePlatform();
    showing = { platform: fake.platform };
    const first = await phone();
    await enterShow();
    await fireEvent.press(screen.getByTestId('show-done'));
    await waitFor(() => expect(fake.calls).toContain('restore 0.4'));
    expect(readPrefs('show-brightness', null)).toBeNull();
    await first.app.unmount();

    // Going to the back: out of Show mode, brightness back first.
    fake = fakePlatform();
    showing = { platform: fake.platform };
    const second = await phone();
    await enterShow();
    await waitFor(() => expect(fake.calls).toContain('brightness 1'));
    await toBack();
    await waitFor(() => expect(fake.calls).toContain('restore 0.4'));
    expect(fake.calls.indexOf('restore 0.4')).toBeLessThan(fake.calls.lastIndexOf('awake false'));
    await second.app.unmount();

    // Unmounted while showing.
    fake = fakePlatform();
    showing = { platform: fake.platform };
    const third = await phone();
    await enterShow();
    await waitFor(() => expect(fake.calls).toContain('brightness 1'));
    await third.app.unmount();
    await waitFor(() => expect(fake.calls).toContain('restore 0.4'));
    expect(fake.calls).toEqual(expect.arrayContaining(['awake false', 'turn portrait', 'immersive false']));
  });

  it('a brightness left by a crash is restored at the next launch', async () => {
    writePrefs('show-brightness', { value: 0.3 });
    const fake = fakePlatform();
    await recoverBrightness(fake.platform);
    expect(fake.calls).toEqual(['restore 0.3']);
    expect(readPrefs('show-brightness', null)).toBeNull();
    // Nothing left behind: nothing to do.
    await recoverBrightness(fake.platform);
    expect(fake.calls).toEqual(['restore 0.3']);
  });

  it('keep-awake is on only while showing and ends after ten minutes', async () => {
    expect(SHOW_FOR_MS).toBe(10 * 60_000);
    const fake = fakePlatform();
    showing = { platform: fake.platform, showForMs: 300 };
    await phone();
    expect(fake.calls).not.toContain('awake true');
    await enterShow();
    await waitFor(() => expect(fake.calls).toContain('awake true'));
    // The time is up: out, and locked.
    expect(await screen.findByTestId('lock-screen', {}, { timeout: 3000 })).toBeTruthy();
    expect(fake.calls).toContain('awake false');
  });

  it('Back leaves Show mode for the lock screen', async () => {
    showing = { platform: fakePlatform().platform };
    await phone();
    await enterShow();
    await pressBack();
    expect(await screen.findByTestId('lock-screen')).toBeTruthy();
    expect(screen.getByTestId('lock-after-show')).toHaveTextContent('Unlock to carry on.');
    expect(screen.queryByTestId('show-screen')).toBeNull();
    // Unlocked again: Home, not Show mode.
    await fireEvent.press(screen.getByTestId('lock-unlock'));
    expect(await screen.findByTestId('essential-passport')).toBeTruthy();
  });

  it('Done is always reachable with TalkBack on', async () => {
    expect(CONTROLS_FOR_MS).toBe(3_000);
    // Without a screen reader the controls fade, and a tap brings them back.
    let fake = fakePlatform();
    showing = { platform: fake.platform, controlsForMs: 150 };
    const first = await phone();
    await enterShow();
    await waitFor(() => expect(screen.queryByTestId('show-done')).toBeNull());
    await act(async () => screen.getByTestId('show-screen').props.onTouchStart?.());
    expect(await screen.findByTestId('show-done')).toBeTruthy();
    await first.app.unmount();

    // With one, Done stays.
    fake = fakePlatform({ screenReader: async () => true });
    showing = { platform: fake.platform, controlsForMs: 150 };
    await phone();
    await enterShow();
    await act(async () => new Promise((r) => setTimeout(r, 400)));
    expect(screen.getByTestId('show-done')).toBeTruthy();
    expect(audit()).toEqual([]);
  });

  it('buttons page, zoom and turn without gestures', async () => {
    const fake = fakePlatform();
    showing = { platform: fake.platform };
    await phone();
    await enterShow();
    expect(screen.getByTestId('show-page')).toHaveTextContent('Page 1 of 2');
    await fireEvent.press(screen.getByTestId('show-next'));
    await waitFor(() => expect(screen.getByTestId('show-page')).toHaveTextContent('Page 2 of 2'));
    await fireEvent.press(screen.getByTestId('show-previous'));
    await waitFor(() => expect(screen.getByTestId('show-page')).toHaveTextContent('Page 1 of 2'));
    const width = () => Number(StyleSheet.flatten(screen.getByTestId('show-image').props.style).width);
    const at = width();
    await fireEvent.press(screen.getByTestId('show-larger'));
    await waitFor(() => expect(width()).toBeGreaterThan(at));
    await fireEvent.press(screen.getByTestId('show-smaller'));
    await waitFor(() => expect(width()).toBe(at));
    await fireEvent.press(screen.getByTestId('show-rotate'));
    expect(fake.calls).toContain('turn landscape');
    await fireEvent.press(screen.getByTestId('show-rotate'));
    expect(fake.calls.filter((c) => c === 'turn portrait')).toHaveLength(1);
  });

  it('showing from the cache records an open', async () => {
    showing = { platform: fakePlatform().platform };
    const { kept } = await phone();
    await enterShow();
    const opens = await kept.opens();
    expect(opens).toHaveLength(1);
    expect(opens[0]).toMatchObject({ document_id: 'passport', mode: 'show', online: false });
  });
});
