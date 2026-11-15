import { NetworkError, type FetchLike } from '@fdv/client';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { AppState, Text, View } from 'react-native';
import PeopleScreen from '../app/(tabs)/people';
import { wordsFor } from '../errors/words';
import i18n from '../i18n';
import { setPhoneOffline } from '../net/reach';
import { useVault, RETRY_WAITS_MS } from '../state/vault';
import { audit } from '../test-support/a11y';
import { unlocked } from '../test-support/lookup';
import { installed, respond } from '../test-support/render';
import { resetRoutes } from '../test-support/router';
import { caps0519, capabilities, testVault, type TestVault } from '../test-support/vault';
import { BANNER_DELAY_MS, ReachBanner } from '../ui/reach-banner';

jest.mock(
  'expo-router',
  () => jest.requireActual<typeof import('../test-support/router')>('../test-support/router').routerMock,
);

const ORIGIN = 'https://vault.test';
const t = i18n.t.bind(i18n);
/** Long enough for the banner's wait, and a little more. */
const SHOWN = { timeout: BANNER_DELAY_MS + 3_000 };

beforeEach(() => {
  installed();
  resetRoutes();
  setPhoneOffline(false);
  // In front, as the phone is when its network changes under the person.
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
});

function vault(): TestVault {
  const v = testVault([ORIGIN]);
  v.caps = capabilities({ features: { ...caps0519().features, notes: true } });
  return v;
}

const networkChanged = () =>
  act(() => {
    for (const l of (globalThis as unknown as { __networkListeners: Set<() => void> }).__networkListeners) l();
  });

const capabilityLooks = (v: TestVault) => v.calls.filter((c) => c.endsWith('/api/v1/capabilities')).length;

/** The vault's address answers nothing, until let go: a request waits until it is given up on. */
function hanging(v: TestVault, only?: (url: string) => boolean) {
  const state = { hang: true };
  const inner = v.fetch;
  const fetch: FetchLike = (url, init) => {
    if (!state.hang || url.endsWith('/api/v1/auth/password') || (only && !only(url))) return inner(url, init);
    v.calls.push(`${init.method} ${url}`);
    return new Promise((_resolve, reject) => {
      const signal = init.signal as AbortSignal | undefined;
      signal?.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })));
    });
  };
  return { state, fetch };
}

/** Something on the screen that asks the vault again, as any screen's next request would. */
function AskAgain() {
  const { recheck } = useVault();
  return (
    <Text testID="ask-again" accessibilityRole="button" onPress={() => void recheck()}>
      Ask again
    </Text>
  );
}

const People = () => (
  <View>
    <PeopleScreen />
    <ReachBanner />
    <AskAgain />
  </View>
);

describe('the vault can’t be reached: a clear word, never a spinner for ever (0.13.0)', () => {
  it('no answer in time: given up on, "can’t reach your vault", Try again; back when it answers', async () => {
    const v = vault();
    const { state, fetch } = hanging(v);
    await unlocked(v, <People />, { deps: { fetch, requestTimeoutMs: 50 } });
    expect(await screen.findByTestId('people-offline')).toBeTruthy();
    // Not at once: only once the vault has stayed out of reach a moment.
    expect(screen.queryByTestId('reach-banner')).toBeNull();
    expect(await screen.findByTestId('reach-unreachable', {}, SHOWN)).toHaveTextContent(
      "Can't reach your vault right now. Check you're on a network that can reach it.",
    );
    expect(screen.queryByTestId('loading')).toBeNull();
    expect(audit()).toEqual([]);
    expect(wordsFor(new NetworkError('offline'), t)).toBe(t('errors.offline'));

    await fireEvent.press(screen.getByTestId('reach-try-again'));
    await waitFor(() => expect(screen.getByTestId('reach-try-again').props.accessibilityState.busy).toBe(false));
    expect(screen.getByTestId('reach-banner')).toBeTruthy();

    state.hang = false;
    await fireEvent.press(screen.getByTestId('reach-try-again'));
    await waitFor(() => expect(screen.queryByTestId('reach-banner')).toBeNull());
    expect(await screen.findByTestId('person-fake-member')).toBeTruthy();
  });

  it('a network change brings it back by itself, without Try again', async () => {
    const v = vault();
    const { state, fetch } = hanging(v);
    await unlocked(v, <People />, { deps: { fetch, requestTimeoutMs: 50 } });
    await screen.findByTestId('reach-unreachable', {}, SHOWN);
    state.hang = false;
    await networkChanged();
    await waitFor(() => expect(screen.queryByTestId('reach-banner')).toBeNull());
  });

  it('one slow answer is not "can’t reach": the vault is looked at again, and as it answers, no banner — the list says it was slow, with Try again', async () => {
    const v = vault();
    const { state, fetch } = hanging(v, (url) => url.endsWith('/api/v1/members'));
    await unlocked(v, <People />, { deps: { fetch, requestTimeoutMs: 50 } });
    expect(await screen.findByTestId('load-failed')).toHaveTextContent(/^Your vault took too long to answer\./);
    // Looked at again, and it answered.
    await waitFor(() => expect(capabilityLooks(v)).toBeGreaterThanOrEqual(1));
    await act(async () => new Promise((r) => setTimeout(r, BANNER_DELAY_MS + 500)));
    expect(screen.queryByTestId('reach-banner')).toBeNull();
    expect(screen.queryByTestId('people-offline')).toBeNull();
    state.hang = false;
    await fireEvent.press(screen.getByTestId('load-failed-retry'));
    expect(await screen.findByTestId('person-fake-member')).toBeTruthy();
  });

  it('looks that overlap are one look', async () => {
    const v = vault();
    const { state, fetch } = hanging(v, (url) => url.endsWith('/api/v1/capabilities'));
    state.hang = false;
    await unlocked(v, <People />, { deps: { fetch, requestTimeoutMs: 300 } });
    await screen.findByTestId('person-fake-member');
    state.hang = true;
    const before = capabilityLooks(v);
    await fireEvent.press(screen.getByTestId('ask-again'));
    await fireEvent.press(screen.getByTestId('ask-again'));
    await fireEvent.press(screen.getByTestId('ask-again'));
    expect(capabilityLooks(v)).toBe(before + 1);
    state.hang = false;
  });

  it('a gateway’s 503 in the vault’s place is "can’t reach your vault"', async () => {
    const v = vault();
    const inner = v.fetch;
    let down = false;
    const fetch: FetchLike = (url, init) => (down && !url.endsWith('/auth/password') ? Promise.resolve(respond(503, {})) : inner(url, init));
    await unlocked(v, <People />, { deps: { fetch } });
    await screen.findByTestId('person-fake-member');
    down = true;
    await fireEvent.press(screen.getByTestId('ask-again'));
    expect(await screen.findByTestId('reach-unreachable', {}, SHOWN)).toBeTruthy();
    expect(screen.getByTestId('people-showing-saved')).toBeTruthy();
  });

  it('looks again by itself, each wait longer than the last, up to a minute — and not while the phone has no network', async () => {
    const v = vault();
    const { fetch } = hanging(v);
    const waits: number[] = [];
    const due: (() => void)[] = [];
    let none = false;
    const schedule = (ms: number, fn: () => void) => {
      waits.push(ms);
      due.push(fn);
      return () => undefined;
    };
    await unlocked(v, <People />, {
      deps: { fetch, requestTimeoutMs: 30, schedule, network: async () => (none ? 'none' : 'wifi') },
    });
    await waitFor(() => expect(waits).toEqual([RETRY_WAITS_MS[0]]));
    for (let i = 1; i <= 4; i += 1) {
      await act(async () => due[i - 1]?.());
      await waitFor(() => expect(waits).toHaveLength(i + 1));
    }
    expect(waits).toEqual([10_000, 20_000, 40_000, 60_000, 60_000]);

    // No network at all: no more looks, until the network changes.
    none = true;
    await networkChanged();
    expect(await screen.findByTestId('reach-no_network', {}, SHOWN)).toBeTruthy();
    const had = waits.length;
    await act(async () => due.at(-1)?.());
    await act(async () => new Promise((r) => setTimeout(r, 200)));
    expect(waits.length).toBeLessThanOrEqual(had);
  });

  it('no network at all: the phone is offline, said as that, not as the vault', async () => {
    const v = vault();
    let none = false;
    await unlocked(v, <People />, { deps: { network: async () => (none ? 'none' : 'wifi') } });
    await screen.findByTestId('person-fake-member');
    none = true;
    v.reachable.delete(ORIGIN);
    await networkChanged();
    await fireEvent.press(screen.getByTestId('ask-again'));
    expect(await screen.findByTestId('reach-no_network', {}, SHOWN)).toHaveTextContent(
      "This phone is offline. Showing what's saved on it.",
    );
    expect(screen.getByTestId('person-fake-member')).toBeTruthy();
    expect(screen.getByTestId('people-showing-saved')).toHaveTextContent("Offline: showing what's saved on this phone.");
    expect(wordsFor(new NetworkError('offline'), t)).toBe(t('errors.noNetwork'));
  });
});
