import type { FetchLike } from '@fdv/client';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Pressable, Text, View } from 'react-native';
import SignIn from '../app/sign-in';
import { DEVICE_PROOF_INDEX, deviceProofKey } from '../session/store';
import { useVault } from '../state/vault';
import { installed, knownVault, renderApp, respond, signedIn, testVault } from '../test-support/render';
import type { TestVault } from '../test-support/vault';
import { Blockers } from '../update/gate';

// Kept Essentials on the sign-in screen open with the router (4.10).
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/',
}));

const ORIGIN = 'https://vault.test';
const EMAIL = 'owner@example.test';
const PASSWORD = 'correct horse battery staple';
const USED = 'That code was used already. Wait for the next one from your authenticator app, and type that.';

function Phase() {
  const { phase, signOut } = useVault();
  return (
    <View>
      <Text testID="phase">{phase}</Text>
      <Pressable testID="out" accessibilityRole="button" onPress={() => void signOut()}>
        <Text>Out</Text>
      </Pressable>
    </View>
  );
}

const body = (init: { body?: unknown }) => JSON.parse(String(init.body)) as Record<string, unknown>;

/** The test vault, with these paths answered by `answer` instead (null: as the vault would). */
function answering(
  t: TestVault,
  answer: (path: string, init: Parameters<FetchLike>[1]) => Promise<Awaited<ReturnType<FetchLike>> | null>,
): FetchLike {
  return async (url, init) => {
    const own = await answer(new URL(url).pathname, init);
    return own ?? t.fetch(url, init);
  };
}

async function typeAndGo(password = PASSWORD) {
  await fireEvent.changeText(screen.getByTestId('sign-in-email'), EMAIL);
  await fireEvent.changeText(screen.getByTestId('sign-in-password'), password);
  await fireEvent.press(screen.getByTestId('sign-in-go'));
}

describe('signing in, with the vault of 0.9.0', () => {
  beforeEach(() => {
    installed();
    knownVault();
  });

  it('too many tries: how long, in plain words, and Sign in waits until then', async () => {
    const t = testVault();
    const fetch = answering(t, async (path) =>
      path === '/api/v1/auth/password'
        ? respond(
            429,
            {
              error: {
                code: 'sign_in_throttled',
                message: 'Too many tries to sign in. Wait 5 minutes and try again, or sign in with a passkey if you have one.',
                retriable: true,
                retry_after: 300,
              },
            },
            { 'retry-after': '300' },
          )
        : null,
    );
    await renderApp(
      <>
        <Phase />
        <SignIn />
      </>,
      { fetch },
    );
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('sign_in'));
    await typeAndGo();
    expect(await screen.findByTestId('sign-in-throttled')).toHaveTextContent(
      'Too many tries. Wait 5 minutes, then try again.',
    );
    expect(screen.getByTestId('sign-in-go')).toBeDisabled();
  });

  it('no Retry-After to read (the web build, another origin): the wait from the vault\'s own words', async () => {
    const t = testVault();
    const fetch = answering(t, async (path) =>
      path === '/api/v1/auth/password'
        ? respond(429, {
            error: { code: 'sign_in_throttled', message: 'Too many tries.', retriable: true, retry_after: 300 },
          })
        : null,
    );
    await renderApp(<SignIn />, { fetch });
    await screen.findByTestId('sign-in-email');
    await typeAndGo();
    expect(await screen.findByTestId('sign-in-throttled')).toHaveTextContent(
      'Too many tries. Wait 5 minutes, then try again.',
    );
  });

  it('a short wait is said in seconds', async () => {
    const t = testVault();
    const fetch = answering(t, async (path) =>
      path === '/api/v1/auth/password'
        ? respond(
            429,
            { error: { code: 'sign_in_throttled', message: 'Too many tries.', retriable: true, retry_after: 1 } },
            { 'retry-after': '1' },
          )
        : null,
    );
    await renderApp(<SignIn />, { fetch });
    await screen.findByTestId('sign-in-email');
    await typeAndGo();
    expect(await screen.findByTestId('sign-in-throttled')).toHaveTextContent(
      'Too many tries. Wait 1 second, then try again.',
    );
    expect(screen.getByTestId('sign-in-go')).toBeDisabled();
    // Once the wait is over, the button is back.
    await waitFor(() => expect(screen.getByTestId('sign-in-go')).not.toBeDisabled(), { timeout: 3000 });
    expect(screen.queryByTestId('sign-in-throttled')).toBeNull();
  });

  it('a second step that is a passkey alone: the browser, said plainly', async () => {
    const t = testVault();
    const fetch = answering(t, async (path) =>
      path === '/api/v1/auth/password'
        ? respond(200, { mfa_required: true, mfa_token: 'mfa-1', methods: ['passkey'] })
        : null,
    );
    await renderApp(
      <>
        <Phase />
        <SignIn />
      </>,
      { fetch },
    );
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('sign_in'));
    await typeAndGo();
    expect(await screen.findByTestId('sign-in-passkey-second')).toHaveTextContent(/can't use passkeys yet/);
    // No code box for a code nobody has.
    expect(screen.queryByTestId('sign-in-code')).toBeNull();
    expect(screen.getByTestId('sign-in-password')).toBeTruthy();
  });

  it('a passkey or a code: the code, from the authenticator app', async () => {
    const t = testVault();
    const fetch = answering(t, async (path) =>
      path === '/api/v1/auth/password'
        ? respond(200, { mfa_required: true, mfa_token: 'mfa-1', methods: ['totp', 'passkey'] })
        : null,
    );
    await renderApp(<SignIn />, { fetch });
    await screen.findByTestId('sign-in-email');
    await typeAndGo();
    expect(await screen.findByTestId('sign-in-code-app')).toBeTruthy();
    expect(screen.queryByTestId('sign-in-code-switch')).toBeNull();
  });

  it('a code given twice: "That code was used already. Wait for the next one."', async () => {
    const t = testVault();
    const fetch = answering(t, async (path) => {
      if (path === '/api/v1/auth/password') return respond(200, { mfa_required: true, mfa_token: 'mfa-1', methods: ['totp'] });
      if (path === '/api/v1/auth/mfa') {
        return respond(401, { error: { code: 'totp_invalid', message: USED, retriable: false } });
      }
      return null;
    });
    await renderApp(<SignIn />, { fetch });
    await screen.findByTestId('sign-in-email');
    await typeAndGo();
    await fireEvent.changeText(await screen.findByTestId('sign-in-code'), '123456');
    await fireEvent.press(screen.getByTestId('sign-in-go'));
    expect(await screen.findByTestId('sign-in-refused')).toHaveTextContent(
      'That code was used already. Wait for the next one.',
    );
    // Still the code step: the next code goes in the same box.
    expect(screen.getByTestId('sign-in-code')).toBeTruthy();
  });

  it("the vault's device proof is kept in the keystore, outlives signing out, and goes with the next password", async () => {
    const t = testVault();
    const sent: Record<string, unknown>[] = [];
    const fetch: FetchLike = async (url, init) => {
      if (new URL(url).pathname !== '/api/v1/auth/password') return t.fetch(url, init);
      sent.push(body(init));
      const { device_proof: _proof, ...rest } = body(init);
      void _proof;
      const res = await t.fetch(url, { ...init, body: JSON.stringify(rest) });
      return respond(res.status, { ...((await res.json()) as object), device_proof: 'proof-of-this-phone' });
    };
    await renderApp(
      <>
        <Phase />
        <SignIn />
      </>,
      { fetch },
    );
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('sign_in'));
    await typeAndGo();
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('ready'));
    expect(sent[0]).not.toHaveProperty('device_proof');
    const secure = (globalThis as unknown as { __secureStore: Map<string, string> }).__secureStore;
    // One keystore entry per vault, under its address hashed, listed for a fresh install to forget.
    expect(secure.get(deviceProofKey(ORIGIN))).toBe('proof-of-this-phone');
    expect(deviceProofKey(ORIGIN)).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(deviceProofKey('https://other.test')).not.toBe(deviceProofKey(ORIGIN));
    expect(JSON.parse(secure.get(DEVICE_PROOF_INDEX) ?? '[]')).toEqual([deviceProofKey(ORIGIN)]);

    await fireEvent.press(screen.getByTestId('out'));
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('sign_in'));
    expect(secure.get(deviceProofKey(ORIGIN))).toBe('proof-of-this-phone');
    await typeAndGo();
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('ready'));
    expect(sent[1]).toMatchObject({ email: EMAIL, device_proof: 'proof-of-this-phone' });
  });
});

/** The rest of the app, under the blocking screens. */
function Tabs() {
  const { withToken } = useVault();
  return (
    <View>
      <Text testID="tabs">The tabs</Text>
      <Pressable
        testID="ask"
        accessibilityRole="button"
        onPress={() => void withToken((api, token) => api.documents(token)).catch(() => undefined)}
      >
        <Text>Ask</Text>
      </Pressable>
    </View>
  );
}

describe('two-step sign-in to set up first (the vault of 0.9.0)', () => {
  beforeEach(() => {
    installed();
  });

  /** A vault that holds this session until two-step sign-in is set up, as `held` says. */
  function holding(t: TestVault, held: { value: boolean; reason?: 'enrol' | 'confirm' }): FetchLike {
    return answering(t, async (path, init) => {
      if (!held.value) return null;
      if (path === '/api/v1/me') {
        const res = await t.fetch(`${ORIGIN}${path}`, init);
        const me = (await res.json()) as object;
        return respond(200, { ...me, two_step_setup_required: true, two_step_reason: held.reason ?? 'enrol' });
      }
      if (path === '/api/v1/auth/password' || path === '/api/v1/auth/refresh') {
        const res = await t.fetch(`${ORIGIN}${path}`, init);
        return respond(res.status, { ...((await res.json()) as object), two_step_setup_required: true });
      }
      if (path.startsWith('/api/v1/auth/')) return null;
      return respond(403, {
        error: {
          code: 'two_step_setup_required',
          message: 'Owners must set up two-step sign-in before going on: a code from an authenticator app, or a passkey.',
          reason: held.reason ?? 'enrol',
          retriable: false,
        },
      });
    });
  }

  it('signed in, and held: its own screen, the authenticator app set up there, and then the app', async () => {
    knownVault();
    const t = testVault();
    const held = { value: true };
    await renderApp(
      <>
        <Phase />
        <Blockers>
          <Tabs />
        </Blockers>
        <SignIn />
      </>,
      { fetch: holding(t, held) },
    );
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('sign_in'));
    await typeAndGo();
    expect(await screen.findByTestId('two-step-needed')).toBeTruthy();
    expect(screen.queryByTestId('tabs')).toBeNull();
    expect(screen.getByTestId('two-step-needed-words')).toHaveTextContent(/turn on two-step sign-in before you carry on/);
    // The authenticator app's set-up, as Settings has it.
    expect(await screen.findByTestId('two-step-begin')).toBeTruthy();

    // Not yet: Carry on says so, and the screen stays.
    await fireEvent.press(screen.getByTestId('two-step-needed-carry-on'));
    expect(await screen.findByTestId('two-step-needed-said')).toHaveTextContent("Two-step sign-in isn't set up yet.");

    // Set up (in the browser, say): Carry on, and the app goes on.
    held.value = false;
    await fireEvent.press(screen.getByTestId('two-step-needed-carry-on'));
    expect(await screen.findByTestId('tabs')).toBeTruthy();
    expect(screen.getByTestId('phase')).toHaveTextContent('ready');
  });

  it('a 403 two_step_setup_required from any call shows it too; confirming with a code lets it go on', async () => {
    const t = testVault();
    // An authenticator app set up already; this session never gave its code.
    t.factors = { totp: true, passkey: false };
    await signedIn(t, ORIGIN);
    const held = { value: false, reason: 'confirm' as const };
    const steps: Record<string, unknown>[] = [];
    const vault = holding(t, held);
    const fetch: FetchLike = async (url, init) => {
      if (new URL(url).pathname === '/api/v1/auth/step-up' && init.method === 'POST') {
        steps.push(body(init));
        held.value = false;
        return respond(200, { verified_at: new Date().toISOString(), expires_in: 300 });
      }
      return vault(url, init);
    };
    await renderApp(
      <>
        <Phase />
        <Blockers>
          <Tabs />
        </Blockers>
      </>,
      { fetch },
    );
    expect(await screen.findByTestId('tabs')).toBeTruthy();
    held.value = true;
    await fireEvent.press(screen.getByTestId('ask'));
    expect(await screen.findByTestId('two-step-needed')).toBeTruthy();
    expect(await screen.findByTestId('two-step-needed-words')).toHaveTextContent(
      'This sign-in used your password only. Type a code from your authenticator app to carry on.',
    );
    await fireEvent.changeText(screen.getByTestId('two-step-needed-code'), '123 456');
    await fireEvent.press(screen.getByTestId('two-step-needed-confirm'));
    expect(await screen.findByTestId('tabs')).toBeTruthy();
    expect(steps).toEqual([{ code: '123456' }]);
    expect(screen.getByTestId('phase')).toHaveTextContent('ready');
  });

  it('held when the app last ran: its screen from the start, never the tabs first', async () => {
    const t = testVault();
    await signedIn(t, ORIGIN);
    const held = { value: true };
    const first = await renderApp(
      <>
        <Phase />
        <Blockers>
          <Tabs />
        </Blockers>
      </>,
      { fetch: holding(t, held) },
    );
    // Held: the first request the app makes finds it out.
    const ask = await screen.findByTestId('ask').catch(() => null);
    if (ask) await fireEvent.press(ask);
    expect(await screen.findByTestId('two-step-needed')).toBeTruthy();
    await first.unmount();

    // The app started again, the session kept: nothing asked yet, and no tabs shown.
    const tabsShown = jest.fn();
    function Watch() {
      const { phase, twoStep } = useVault();
      if (phase === 'ready' && twoStep === null) tabsShown();
      return null;
    }
    await renderApp(
      <>
        <Phase />
        <Watch />
        <Blockers>
          <Tabs />
        </Blockers>
      </>,
      { fetch: holding(t, held) },
    );
    expect(await screen.findByTestId('two-step-needed')).toBeTruthy();
    expect(screen.queryByTestId('tabs')).toBeNull();
    expect(tabsShown).not.toHaveBeenCalled();

    // Set up elsewhere: Carry on asks again, and the app goes on — and is not held next time.
    held.value = false;
    await fireEvent.press(screen.getByTestId('two-step-needed-carry-on'));
    expect(await screen.findByTestId('tabs')).toBeTruthy();
  });

  it("a passkey the only factor: what to do in the browser, and Carry on asks the vault again", async () => {
    const t = testVault();
    t.factors = { totp: false, passkey: true };
    await signedIn(t, ORIGIN);
    const held = { value: false, reason: 'confirm' as const };
    await renderApp(
      <>
        <Phase />
        <Blockers>
          <Tabs />
        </Blockers>
      </>,
      { fetch: holding(t, held) },
    );
    expect(await screen.findByTestId('tabs')).toBeTruthy();
    held.value = true;
    await fireEvent.press(screen.getByTestId('ask'));
    expect(await screen.findByTestId('two-step-needed-words')).toHaveTextContent(/can't use passkeys yet/);
    expect(screen.queryByTestId('two-step-needed-code')).toBeNull();
    held.value = false;
    await fireEvent.press(screen.getByTestId('two-step-needed-carry-on'));
    expect(await screen.findByTestId('tabs')).toBeTruthy();
  });

  it("the vault's own reason, once /me says it, over the one a refusal gave", async () => {
    const t = testVault();
    t.factors = { totp: true, passkey: false };
    await signedIn(t, ORIGIN);
    // The refusal says enrol; /me says confirm (an authenticator app set up meanwhile, elsewhere).
    const vault = holding(t, { value: true, reason: 'confirm' });
    const fetch: FetchLike = async (url, init) => {
      if (new URL(url).pathname === '/api/v1/documents') {
        return respond(403, {
          error: { code: 'two_step_setup_required', message: 'Set it up.', reason: 'enrol', retriable: false },
        });
      }
      return vault(url, init);
    };
    await renderApp(
      <>
        <Phase />
        <Blockers>
          <Tabs />
        </Blockers>
      </>,
      { fetch },
    );
    const ask = await screen.findByTestId('ask').catch(() => null);
    if (ask) await fireEvent.press(ask);
    expect(await screen.findByTestId('two-step-needed-code')).toBeTruthy();
  });
});
