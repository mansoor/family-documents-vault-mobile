import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { AppState, Pressable, Text, View, type AppStateStatus } from 'react-native';
import { useVault } from '../state/vault';
import { installed, renderApp, signedIn } from '../test-support/render';
import { testVault, type TestVault } from '../test-support/vault';

const ORIGIN = 'https://vault.test';
const CAPS = `GET ${ORIGIN}/api/v1/capabilities`;
const ME = `GET ${ORIGIN}/api/v1/me`;
const MINUTE = 60_000;

/** What the app knows of the vault, and a way to ask it something ordinary. */
function Probe() {
  const { caps, offline, withToken } = useVault();
  return (
    <View>
      <Text testID="version">{caps?.server_version ?? 'none'}</Text>
      <Text testID="offline">{offline ? 'offline' : 'online'}</Text>
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

/** Answers that say which version gave them, as a vault of 0.5.0 and later does. */
function sayingVersion(t: TestVault): TestVault['fetch'] {
  return async (url, init) => {
    const res = await t.fetch(url, init);
    const get = (name: string) =>
      name.toLowerCase() === 'x-fdv-server-version' ? t.caps.server_version : res.headers.get(name);
    return { ...res, headers: { get } } as typeof res;
  };
}

describe('when the app asks the vault again (0.2.0)', () => {
  let app: { unmount(): unknown } | null = null;
  let front: ReturnType<typeof frontListeners>;
  beforeEach(() => {
    // Not a first launch: that would forget the session signed in here.
    installed();
    front = frontListeners();
  });
  afterEach(async () => {
    // Unmounted while the spy still answers, so its listeners go through it.
    await app?.unmount();
    app = null;
    front.spy.mockRestore();
  });

  it('over https, coming back soon asks the vault nothing; after five minutes it reads it again', async () => {
    const t = testVault([ORIGIN]);
    await signedIn(t);
    let clock = 1_000_000;
    app = await renderApp(<Probe />, { fetch: t.fetch, deps: { now: () => clock } });
    expect(await screen.findByText('0.4.10')).toBeTruthy();
    const reads = () => t.calls.filter((c) => c === CAPS).length;
    const launch = reads();
    expect(launch).toBe(1);

    clock += MINUTE;
    await front.toFront();
    expect(reads()).toBe(launch);

    clock += 5 * MINUTE;
    await front.toFront();
    await waitFor(() => expect(reads()).toBe(launch + 1));
  });

  it('after the app found no connection, coming back reads the vault at once, however soon', async () => {
    const t = testVault([ORIGIN]);
    await signedIn(t);
    let clock = 1_000_000;
    app = await renderApp(<Probe />, { fetch: t.fetch, deps: { now: () => clock } });
    expect(await screen.findByText('0.4.10')).toBeTruthy();

    t.reachable.delete(ORIGIN);
    await fireEvent.press(screen.getByTestId('ask'));
    expect(await screen.findByText('offline')).toBeTruthy();

    t.reachable.add(ORIGIN);
    const reads = () => t.calls.filter((c) => c === CAPS).length;
    const before = reads();
    clock += MINUTE;
    await front.toFront();
    await waitFor(() => expect(reads()).toBe(before + 1));
    expect(await screen.findByText('online')).toBeTruthy();
  });

  it('an answer from another version reads the vault again, once; the same version asks nothing more', async () => {
    const t = testVault([ORIGIN]);
    await signedIn(t);
    app = await renderApp(<Probe />, { fetch: sayingVersion(t) });
    expect(await screen.findByText('0.4.10')).toBeTruthy();
    const reads = () => t.calls.filter((c) => c === CAPS).length;
    const asks = () => t.calls.filter((c) => c === ME).length;
    const launch = reads();

    await fireEvent.press(screen.getByTestId('ask'));
    await waitFor(() => expect(asks()).toBe(1));
    expect(reads()).toBe(launch);

    // The vault is upgraded: the next ordinary answer says so.
    t.caps = { ...t.caps, server_version: '0.5.1' };
    await fireEvent.press(screen.getByTestId('ask'));
    expect(await screen.findByText('0.5.1')).toBeTruthy();
    expect(reads()).toBe(launch + 1);

    await fireEvent.press(screen.getByTestId('ask'));
    await waitFor(() => expect(asks()).toBe(3));
    expect(reads()).toBe(launch + 1);
  });

  it('every request the app makes asks for no kept answer and keeps none', async () => {
    const t = testVault([ORIGIN]);
    await signedIn(t);
    const seen: Record<string, string>[] = [];
    const recording: TestVault['fetch'] = async (url, init) => {
      seen.push({ ...init.headers });
      return t.fetch(url, init);
    };
    app = await renderApp(<Probe />, { fetch: recording });
    expect(await screen.findByText('0.4.10')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('ask'));
    await waitFor(() => expect(seen.length).toBeGreaterThanOrEqual(2));
    // The phone's HTTP stack keeps a disk cache that obeys this header only.
    for (const headers of seen) expect(headers['cache-control']).toBe('no-cache, no-store');
  });
});
