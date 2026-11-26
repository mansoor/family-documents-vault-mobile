import type { FetchLike } from '@fdv/client';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Linking, Pressable, Share, Text, View } from 'react-native';
import SignIn from '../app/sign-in';
import AccountScreen from '../app/account';
import { useVault } from '../state/vault';
import { audit } from '../test-support/a11y';
import { unlocked } from '../test-support/lookup';
import { installed, knownVault, renderApp, respond } from '../test-support/render';
import { resetRoutes } from '../test-support/router';
import { capabilities, testVault, type TestVault } from '../test-support/vault';
import { FakePushNative } from '../test-support/push';
import { Blockers } from '../update/gate';

// What renews Essentials kept here as a sign-in completes, watched: only a password that was set.
const mockSignedInWith = jest.fn(async (_password: string) => undefined);
jest.mock('../state/essentials', () => {
  const actual = jest.requireActual<typeof import('../state/essentials')>('../state/essentials');
  return {
    ...actual,
    useEssentials: () => ({ ...actual.useEssentials(), signedInWith: (p: string) => mockSignedInWith(p) }),
  };
});

jest.mock(
  'expo-router',
  () => ({
    ...jest.requireActual<typeof import('../test-support/router')>('../test-support/router').routerMock,
    usePathname: () => '/',
  }),
);

/**
 * Getting back in without the second step (the vault's 0.9.0-dev.104), on
 * the phone: a recovery code or the security questions in its place at
 * sign-in, with a new password; a code by text that can't be sent refusing
 * the sign-in; the session after a recovery setting up two-step sign-in
 * again and keeping the recovery codes made for it; and Account's Recovery
 * codes and Security questions.
 */

const ORIGIN = 'https://vault.test';
const EMAIL = 'owner@example.test';
const PASSWORD = 'correct horse battery staple';
const ME = 'fake-member';
const CODE = 'abcde23456';
const UNAVAILABLE =
  'We couldn’t send your code by text. Use a recovery code or your security questions, or ask an owner to send you a password reset.';

/** A vault of 0.9.0-dev.104: recovery codes and security questions, and codes by text. */
function recoveryVault(): TestVault {
  const t = testVault([ORIGIN]);
  t.caps = capabilities({
    features: { ...capabilities().features, recovery_codes: true, security_questions: true, sms_codes: true },
  });
  return t;
}

/** The owner has recovery codes, and asked for a code by text at sign-in that can't be sent now. */
function lostTexts(t: TestVault, opts: { questions?: boolean } = {}) {
  const s = t.vault.state;
  (s.textCodes ??= new Map()).set(ME, { sign_in: true, reset: false });
  (s.recoveryCodes ??= new Map()).set(ME, {
    codes: [{ code: CODE, used: false }],
    made_at: '2026-11-01T10:00:00Z',
  });
  if (opts.questions) {
    (s.securityQuestions ??= new Map()).set(ME, {
      questions: [
        { key: 'first_pet', text: 'What was the name of your first pet?' },
        { key: 'first_school', text: 'What was the name of your first school?' },
        { key: 'own', text: 'Where did we go in 1999?' },
      ],
      answers: ['rex1', 'stmarys', 'cornwall'],
      set_at: '2026-11-01T10:00:00Z',
      tries: 0,
      refused_until: null,
    });
  }
}

function Phase() {
  const { phase, twoStep } = useVault();
  return (
    <View>
      <Text testID="phase">{phase}</Text>
      <Text testID="held">{twoStep ?? 'none'}</Text>
    </View>
  );
}

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

/** Every request's path and body, as the phone sent them. */
function recording(t: TestVault, sent: { path: string; body: Record<string, unknown> | null }[]): FetchLike {
  return async (url, init) => {
    const path = new URL(url).pathname;
    if (path.startsWith('/api/v1/auth/')) {
      sent.push({ path, body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null });
    }
    // The authenticator app the phone's test vault sets up counts as a second step, as the vault's would.
    const res = await t.fetch(url, init);
    if (path === '/api/v1/auth/totp/confirm' && res.ok) (t.vault.state.twoStepMembers ??= new Set()).add(ME);
    return res;
  };
}

async function typeAndGo(password = PASSWORD) {
  await fireEvent.changeText(screen.getByTestId('sign-in-email'), EMAIL);
  await fireEvent.changeText(screen.getByTestId('sign-in-password'), password);
  await fireEvent.press(screen.getByTestId('sign-in-go'));
}

beforeEach(() => {
  installed();
  resetRoutes();
  mockSignedInWith.mockClear();
});

/** Signed in with a recovery code, from the sign-in screen, over Blockers and the tabs. */
async function recovered(fetch: FetchLike, opts: { push?: FakePushNative } = {}) {
  await renderApp(
    <>
      <Phase />
      <Blockers>
        <Tabs />
      </Blockers>
      <SignIn />
    </>,
    { fetch, ...(opts.push ? { push: { native: opts.push }, deps: { push: opts.push } } : {}) },
  );
  await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('sign_in'));
  await typeAndGo();
  await fireEvent.press(await screen.findByTestId('sign-in-use-recovery-code'));
  await fireEvent.changeText(screen.getByTestId('sign-in-recovery-code'), CODE);
  await fireEvent.changeText(screen.getByTestId('sign-in-new-password'), 'a brand new password');
  await fireEvent.press(screen.getByTestId('sign-in-stand-in-go'));
  expect(await screen.findByTestId('two-step-needed')).toBeTruthy();
}

/** The authenticator app set up on the held screen, after confirming it's them with the new password. */
async function authenticatorSetUp() {
  await fireEvent.press(await screen.findByTestId('two-step-begin'));
  await fireEvent.changeText(await screen.findByTestId('step-up-password'), 'a brand new password');
  await fireEvent.press(screen.getByTestId('step-up-go'));
  await fireEvent.changeText(await screen.findByTestId('two-step-code'), '123456');
  await fireEvent.press(screen.getByTestId('two-step-confirm'));
}

describe('signing in without the second step', () => {
  beforeEach(() => knownVault());

  it('a code by text that can’t be sent: the vault’s words, a recovery code with a new password, and set up again', async () => {
    const t = recoveryVault();
    lostTexts(t);
    const sent: { path: string; body: Record<string, unknown> | null }[] = [];
    await renderApp(
      <>
        <Phase />
        <Blockers>
          <Tabs />
        </Blockers>
        <SignIn />
      </>,
      { fetch: recording(t, sent) },
    );
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('sign_in'));
    await typeAndGo();
    expect(await screen.findByTestId('sign-in-stand-in-words')).toHaveTextContent(UNAVAILABLE);
    // Only what the vault offers: codes, not questions; no passkey of theirs.
    expect(screen.getByTestId('sign-in-use-recovery-code')).toBeTruthy();
    expect(screen.queryByTestId('sign-in-use-questions')).toBeNull();
    expect(screen.queryByTestId('sign-in-passkey-browser')).toBeNull();
    expect(screen.queryByTestId('sign-in-go')).toBeNull();
    expect(screen.queryByTestId('sign-in-use-second-step')).toBeNull();

    await fireEvent.press(screen.getByTestId('sign-in-use-recovery-code'));
    expect(screen.getByTestId('sign-in-stand-in-title')).toHaveTextContent('Use a recovery code');
    expect(screen.getByTestId('sign-in-stand-in-warning')).toHaveTextContent(/every other device signed out/);
    const go = () => screen.getByTestId('sign-in-stand-in-go');
    expect(go().props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
    await fireEvent.changeText(screen.getByTestId('sign-in-recovery-code'), 'ABCDE-23456');
    expect(go().props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
    await fireEvent.changeText(screen.getByTestId('sign-in-new-password'), 'a brand new password');
    await fireEvent.press(go());

    // Signed in, and held: set up two-step sign-in again.
    expect(await screen.findByTestId('two-step-needed')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('ready'));
    expect(screen.getByTestId('held')).toHaveTextContent('recovered');
    expect(screen.getByText('Set up two-step sign-in again')).toBeTruthy();
    expect(screen.getByTestId('two-step-needed-words')).toHaveTextContent(/got back in without your second step/);
    expect(sent.find((s) => s.path === '/api/v1/auth/mfa/recovery-code')?.body).toEqual({
      mfa_token: expect.any(String),
      code: 'ABCDE-23456',
      new_password: 'a brand new password',
    });
    expect(t.vault.state.password).toBe('a brand new password');
  });

  it('the stand-ins under the code; the questions asked for as they are chosen; a wrong answer in the vault’s words', async () => {
    const t = recoveryVault();
    lostTexts(t, { questions: true });
    const fetch: FetchLike = async (url, init) => {
      // The code by text sent this time: the stand-ins are offered beside it.
      if (new URL(url).pathname === '/api/v1/auth/password') {
        const res = await t.fetch(url, init);
        if (res.status !== 409) return res;
        const err = ((await res.json()) as { error: { mfa_token: string; recovery: string[] } }).error;
        return respond(200, {
          mfa_required: true,
          mfa_token: err.mfa_token,
          methods: ['totp'],
          recovery: err.recovery,
        });
      }
      return t.fetch(url, init);
    };
    await renderApp(
      <>
        <Phase />
        <Blockers>
          <Tabs />
        </Blockers>
        <SignIn />
      </>,
      { fetch },
    );
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('sign_in'));
    await typeAndGo();
    expect(await screen.findByTestId('sign-in-code')).toBeTruthy();
    expect(screen.getByTestId('sign-in-use-recovery-code')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('sign-in-use-questions'));
    expect(await screen.findByTestId('sign-in-answer-2')).toBeTruthy();
    expect(screen.getByText('Where did we go in 1999?')).toBeTruthy();
    // Back to the code, and the questions again.
    await fireEvent.press(screen.getByTestId('sign-in-use-second-step'));
    expect(screen.getByTestId('sign-in-code')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('sign-in-use-questions'));

    await fireEvent.changeText(screen.getByTestId('sign-in-answer-0'), 'Rex 1');
    await fireEvent.changeText(screen.getByTestId('sign-in-answer-1'), 'St Mary’s');
    await fireEvent.changeText(screen.getByTestId('sign-in-answer-2'), 'Devon');
    await fireEvent.changeText(screen.getByTestId('sign-in-new-password'), 'a brand new password');
    await fireEvent.press(screen.getByTestId('sign-in-stand-in-go'));
    expect(await screen.findByTestId('sign-in-refused')).toHaveTextContent(/answers aren’t all right/);
    expect(screen.getByTestId('phase')).toHaveTextContent('sign_in');

    await fireEvent.changeText(screen.getByTestId('sign-in-answer-2'), 'cornwall');
    await fireEvent.press(screen.getByTestId('sign-in-stand-in-go'));
    expect(await screen.findByTestId('two-step-needed')).toBeTruthy();
    expect(screen.getByTestId('held')).toHaveTextContent('recovered');
  });

  it('a new password the household’s rules refuse: said by it, and nothing used up', async () => {
    const t = recoveryVault();
    lostTexts(t);
    await renderApp(
      <>
        <Phase />
        <SignIn />
      </>,
      { fetch: t.fetch },
    );
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('sign_in'));
    await typeAndGo();
    await fireEvent.press(await screen.findByTestId('sign-in-use-recovery-code'));
    await fireEvent.changeText(screen.getByTestId('sign-in-recovery-code'), CODE);
    await fireEvent.changeText(screen.getByTestId('sign-in-new-password'), 'short');
    await fireEvent.press(screen.getByTestId('sign-in-stand-in-go'));
    expect(await screen.findByText(/at least 10 characters/i)).toBeTruthy();
    expect(screen.queryByTestId('sign-in-refused')).toBeNull();
    expect(screen.getByTestId('phase')).toHaveTextContent('sign_in');
    expect(t.vault.state.recoveryCodes?.get(ME)?.codes[0]?.used).toBe(false);
    // Start again: back to the email and password.
    await fireEvent.press(screen.getByTestId('sign-in-start-again'));
    expect(screen.getByTestId('sign-in-password')).toBeTruthy();
  });

  it('nothing to stand in: the vault’s words, a passkey of theirs pointed to the browser, and Start again', async () => {
    const t = recoveryVault();
    (t.vault.state.textCodes ??= new Map()).set(ME, { sign_in: true, reset: false });
    const fetch: FetchLike = async (url, init) => {
      const res = await t.fetch(url, init);
      if (new URL(url).pathname !== '/api/v1/auth/password' || res.status !== 409) return res;
      const body = (await res.json()) as { error: Record<string, unknown> };
      return respond(409, { error: { ...body.error, methods: ['passkey'] } });
    };
    await renderApp(<SignIn />, { fetch });
    await screen.findByTestId('sign-in-email');
    await typeAndGo();
    expect(await screen.findByTestId('sign-in-stand-in-words')).toHaveTextContent(UNAVAILABLE);
    expect(screen.getByTestId('sign-in-passkey-browser')).toHaveTextContent(/passkey in the browser/);
    expect(screen.queryByTestId('sign-in-use-recovery-code')).toBeNull();
    expect(screen.queryByTestId('sign-in-use-questions')).toBeNull();
    expect(screen.queryByTestId('sign-in-stand-in-go')).toBeNull();
    await fireEvent.press(screen.getByTestId('sign-in-start-again'));
    expect(screen.getByTestId('sign-in-password')).toBeTruthy();
  });

  it('a passkey the only second step, with codes to stand in for it: offered, as the web offers them', async () => {
    const t = recoveryVault();
    lostTexts(t);
    const fetch: FetchLike = async (url, init) =>
      new URL(url).pathname === '/api/v1/auth/password'
        ? respond(200, { mfa_required: true, mfa_token: 'mfa-1', methods: ['passkey'], recovery: ['recovery_code'] })
        : t.fetch(url, init);
    await renderApp(<SignIn />, { fetch });
    await screen.findByTestId('sign-in-email');
    await typeAndGo();
    expect(await screen.findByTestId('sign-in-stand-in-words')).toHaveTextContent(/can't use passkeys yet/);
    expect(screen.getByTestId('sign-in-use-recovery-code')).toBeTruthy();
    expect(screen.queryByTestId('sign-in-passkey-second')).toBeNull();
    await fireEvent.press(screen.getByTestId('sign-in-use-recovery-code'));
    expect(await screen.findByTestId('sign-in-new-password')).toBeTruthy();
    expect(audit()).toEqual([]);
  });

  it('recovered on another device and not finished: the vault’s words at the password', async () => {
    const t = recoveryVault();
    t.vault.state.recovered = new Set([ME]);
    t.vault.state.recoveredSession = new Map([[ME, 'elsewhere']]);
    await renderApp(<SignIn />, { fetch: t.fetch });
    await screen.findByTestId('sign-in-email');
    await typeAndGo();
    expect(await screen.findByTestId('sign-in-refused')).toHaveTextContent(
      'Finish setting up on the device where you recovered, or use Forgot password.',
    );
  });

  it('an older vault says nothing of them: no stand-ins under the code', async () => {
    const t = testVault([ORIGIN]);
    const fetch: FetchLike = async (url, init) =>
      new URL(url).pathname === '/api/v1/auth/password'
        ? respond(200, { mfa_required: true, mfa_token: 'mfa-1', methods: ['totp'] })
        : t.fetch(url, init);
    await renderApp(<SignIn />, { fetch });
    await screen.findByTestId('sign-in-email');
    await typeAndGo();
    expect(await screen.findByTestId('sign-in-code')).toBeTruthy();
    expect(screen.queryByTestId('sign-in-use-recovery-code')).toBeNull();
    expect(screen.queryByTestId('sign-in-use-questions')).toBeNull();
  });
});

describe('after a recovery: two-step sign-in set up again, and the recovery codes kept', () => {
  beforeEach(() => knownVault());

  it('the authenticator app set up, ten codes made and shown once, and the app goes on once they are kept', async () => {
    const t = recoveryVault();
    lostTexts(t);
    const sent: { path: string; body: Record<string, unknown> | null }[] = [];
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await renderApp(
      <>
        <Phase />
        <Blockers>
          <Tabs />
        </Blockers>
        <SignIn />
      </>,
      { fetch: recording(t, sent) },
    );
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('sign_in'));
    await typeAndGo();
    await fireEvent.press(await screen.findByTestId('sign-in-use-recovery-code'));
    await fireEvent.changeText(screen.getByTestId('sign-in-recovery-code'), CODE);
    await fireEvent.changeText(screen.getByTestId('sign-in-new-password'), 'a brand new password');
    await fireEvent.press(screen.getByTestId('sign-in-stand-in-go'));
    expect(await screen.findByTestId('two-step-needed')).toBeTruthy();
    // The passkey is the browser's, and the browser can't sign in until this is done: not offered.
    expect(screen.queryByText(/set up a passkey in the browser/)).toBeNull();

    await fireEvent.press(await screen.findByTestId('two-step-begin'));
    await fireEvent.changeText(await screen.findByTestId('step-up-password'), 'a brand new password');
    await fireEvent.press(screen.getByTestId('step-up-go'));
    await fireEvent.changeText(await screen.findByTestId('two-step-code'), '123456');
    await fireEvent.press(screen.getByTestId('two-step-confirm'));

    expect(await screen.findByTestId('recovery-codes')).toBeTruthy();
    for (let i = 0; i < 10; i++) {
      expect(screen.getByTestId(`recovery-code-${i}`)).toHaveTextContent(new RegExp(`^${i + 1}\\. [a-z2-9]{5}-[a-z2-9]{5}$`));
    }
    expect(screen.queryByTestId('tabs')).toBeNull();
    await fireEvent.press(screen.getByTestId('recovery-codes-share'));
    expect(share).toHaveBeenCalledWith({ message: expect.stringContaining('The Test family: recovery codes') });
    const shared = (share.mock.calls[0]?.[0] as { message: string }).message;
    expect(shared.split('\n').filter((l) => /^[a-z2-9]{5}-[a-z2-9]{5}$/.test(l))).toHaveLength(10);
    // No clipboard module in the tests (an iPhone, the web build): no Copy.
    expect(screen.queryByTestId('recovery-codes-copy')).toBeNull();

    await fireEvent.press(screen.getByTestId('recovery-codes-kept'));
    expect(await screen.findByTestId('tabs')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('held')).toHaveTextContent('none'));
    expect(sent.filter((s) => s.path === '/api/v1/auth/recovery-codes')).toHaveLength(1);
    share.mockRestore();
    open.mockRestore();
  });

  it('the codes not made ("Confirm it\'s you" cancelled): Make my recovery codes, and then they are', async () => {
    const t = recoveryVault();
    lostTexts(t);
    let refuse = true;
    const fetch: FetchLike = async (url, init) => {
      const path = new URL(url).pathname;
      if (path === '/api/v1/auth/recovery-codes' && init.method === 'POST' && refuse) {
        refuse = false;
        return respond(503, { error: { code: 'unavailable', message: 'Busy.', retriable: true } });
      }
      return recording(t, [])(url, init);
    };
    jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await renderApp(
      <>
        <Phase />
        <Blockers>
          <Tabs />
        </Blockers>
        <SignIn />
      </>,
      { fetch },
    );
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('sign_in'));
    await typeAndGo();
    await fireEvent.press(await screen.findByTestId('sign-in-use-recovery-code'));
    await fireEvent.changeText(screen.getByTestId('sign-in-recovery-code'), CODE);
    await fireEvent.changeText(screen.getByTestId('sign-in-new-password'), 'a brand new password');
    await fireEvent.press(screen.getByTestId('sign-in-stand-in-go'));
    await fireEvent.press(await screen.findByTestId('two-step-begin'));
    await fireEvent.changeText(await screen.findByTestId('step-up-password'), 'a brand new password');
    await fireEvent.press(screen.getByTestId('step-up-go'));
    await fireEvent.changeText(await screen.findByTestId('two-step-code'), '123456');
    await fireEvent.press(screen.getByTestId('two-step-confirm'));
    expect(await screen.findByTestId('two-step-needed-codes-problem')).toBeTruthy();
    expect(screen.queryByTestId('tabs')).toBeNull();
    await fireEvent.press(screen.getByTestId('two-step-needed-make-codes'));
    expect(await screen.findByTestId('recovery-codes')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('recovery-codes-kept'));
    expect(await screen.findByTestId('tabs')).toBeTruthy();
  });
});

describe('after the review of 0.27.0', () => {
  beforeEach(() => knownVault());

  it('a stand-in that fails never leaves its new password behind: the second step then renews Essentials with the real one', async () => {
    const t = recoveryVault();
    const fetch: FetchLike = async (url, init) => {
      const path = new URL(url).pathname;
      if (path === '/api/v1/auth/password') {
        return respond(200, { mfa_required: true, mfa_token: 'mfa-1', methods: ['totp'], recovery: ['recovery_code'] });
      }
      if (path === '/api/v1/auth/mfa/recovery-code') {
        return respond(401, {
          error: { code: 'recovery_code_wrong', message: 'That recovery code isn’t right, or it was used already.' },
        });
      }
      if (path === '/api/v1/auth/mfa') {
        return t.fetch(url.replace('/auth/mfa', '/auth/password'), {
          ...init,
          body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
        });
      }
      return t.fetch(url, init);
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
    await fireEvent.press(await screen.findByTestId('sign-in-use-recovery-code'));
    await fireEvent.changeText(screen.getByTestId('sign-in-recovery-code'), 'wrong-code');
    await fireEvent.changeText(screen.getByTestId('sign-in-new-password'), 'never set at all');
    await fireEvent.press(screen.getByTestId('sign-in-stand-in-go'));
    expect(await screen.findByTestId('sign-in-refused')).toHaveTextContent(/recovery code isn’t right/);
    await fireEvent.press(screen.getByTestId('sign-in-use-second-step'));
    await fireEvent.changeText(screen.getByTestId('sign-in-code'), '123456');
    await fireEvent.press(screen.getByTestId('sign-in-go'));
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('ready'));
    expect(mockSignedInWith).toHaveBeenCalledTimes(1);
    expect(mockSignedInWith).toHaveBeenCalledWith(PASSWORD);
  });

  it('a stand-in that works renews Essentials with the new password', async () => {
    const t = recoveryVault();
    lostTexts(t);
    await recovered(t.fetch);
    expect(mockSignedInWith).toHaveBeenCalledWith('a brand new password');
  });

  it('the questions that didn’t come: Try again asks for them again', async () => {
    const t = recoveryVault();
    lostTexts(t, { questions: true });
    let fail = true;
    const fetch: FetchLike = async (url, init) => {
      if (new URL(url).pathname === '/api/v1/auth/mfa/questions' && fail) {
        fail = false;
        return respond(503, { error: { code: 'unavailable', message: 'Busy.', retriable: true } });
      }
      return t.fetch(url, init);
    };
    await renderApp(<SignIn />, { fetch });
    await screen.findByTestId('sign-in-email');
    await typeAndGo();
    await fireEvent.press(await screen.findByTestId('sign-in-use-questions'));
    expect(await screen.findByTestId('sign-in-stand-in-problem')).toBeTruthy();
    expect(screen.queryByTestId('sign-in-answer-0')).toBeNull();
    await fireEvent.press(screen.getByTestId('sign-in-questions-again'));
    expect(await screen.findByTestId('sign-in-answer-2')).toBeTruthy();
    expect(screen.queryByTestId('sign-in-questions-again')).toBeNull();
    expect(screen.queryByTestId('sign-in-stand-in-problem')).toBeNull();
  });

  it('I’ve kept them with no answer from the vault: the codes stay, Try again, and never Make my recovery codes', async () => {
    const t = recoveryVault();
    lostTexts(t);
    let failMe = false;
    const sent: { path: string; body: Record<string, unknown> | null }[] = [];
    const base = recording(t, sent);
    const fetch: FetchLike = async (url, init) =>
      failMe && new URL(url).pathname === '/api/v1/me'
        ? respond(503, { error: { code: 'unavailable', message: 'Busy.', retriable: true } })
        : base(url, init);
    jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await recovered(fetch);
    await authenticatorSetUp();
    expect(await screen.findByTestId('recovery-codes')).toBeTruthy();
    failMe = true;
    await fireEvent.press(screen.getByTestId('recovery-codes-kept'));
    expect(await screen.findByTestId('two-step-codes-problem')).toBeTruthy();
    expect(screen.getByTestId('recovery-code-0')).toBeTruthy();
    expect(screen.queryByTestId('two-step-needed-make-codes')).toBeNull();
    failMe = false;
    await fireEvent.press(screen.getByTestId('two-step-codes-again'));
    expect(await screen.findByTestId('tabs')).toBeTruthy();
    expect(sent.filter((s) => s.path === '/api/v1/auth/recovery-codes')).toHaveLength(1);
  });

  it('a session_ended push meant for this phone’s older sessions leaves the recovered one signed in', async () => {
    const t = recoveryVault();
    lostTexts(t);
    const fake = new FakePushNative();
    await recovered(t.fetch, { push: fake });
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('ready'));
    // The recovery ended every earlier session of the account, and the vault pushed to their rows.
    fake.ended = true;
    await act(async () => fake.emit({ kind: 'message', type: 'session_ended' }));
    // Done with the push (its flag cleared), one way or the other.
    await waitFor(() => expect(fake.ended).toBe(false));
    expect(screen.getByTestId('phase')).toHaveTextContent('ready');
    expect(screen.getByTestId('held')).toHaveTextContent('recovered');
    expect(screen.getByTestId('two-step-needed')).toBeTruthy();
  });

  it('a session_ended push the vault can’t be asked about, moments after the recovery: kept signed in', async () => {
    const t = recoveryVault();
    lostTexts(t);
    const fake = new FakePushNative();
    let silent = false;
    const fetch: FetchLike = async (url, init) => {
      if (silent && new URL(url).pathname === '/api/v1/me') throw new TypeError('Network request failed');
      return t.fetch(url, init);
    };
    await recovered(fetch, { push: fake });
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('ready'));
    silent = true;
    fake.ended = true;
    await act(async () => fake.emit({ kind: 'message', type: 'session_ended' }));
    // Done with the push (its flag cleared), one way or the other.
    await waitFor(() => expect(fake.ended).toBe(false));
    expect(screen.getByTestId('phase')).toHaveTextContent('ready');
  });
});

describe('Account: recovery codes and security questions', () => {
  it('how many are left; new ones asked first, made after confirming it’s you, and shown once', async () => {
    const t = recoveryVault();
    (t.vault.state.twoStepMembers ??= new Set()).add(ME);
    (t.vault.state.recoveryCodes ??= new Map()).set(ME, {
      codes: [
        { code: CODE, used: false },
        { code: 'zzzzz22222', used: false },
        { code: 'yyyyy33333', used: true },
      ],
      made_at: '2026-11-01T10:00:00Z',
    });
    await unlocked(t, <AccountScreen />);
    expect(await screen.findByTestId('recovery-codes-left')).toHaveTextContent(/2 of 10 left, made .*Make new ones soon\./);
    await fireEvent.press(screen.getByTestId('recovery-codes-make'));
    expect(await screen.findByTestId('recovery-codes-make-yes')).toBeTruthy();
    expect(screen.getByText('Your old codes stop working as soon as the new ones are made.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('recovery-codes-make-yes'));
    expect(await screen.findByTestId('recovery-codes')).toBeTruthy();
    expect(screen.getByTestId('recovery-code-9')).toBeTruthy();
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByTestId('recovery-codes-kept'));
    expect(await screen.findByTestId('recovery-codes-left')).toHaveTextContent(/^10 of 10 left/);
  });

  it('two-step sign-in turned on here: the codes made for it shown over the page, in a sheet, until kept', async () => {
    const t = recoveryVault();
    const base = t.fetch;
    t.fetch = async (url, init) => {
      const res = await base(url, init);
      if (new URL(url).pathname === '/api/v1/auth/totp/confirm' && res.ok) {
        (t.vault.state.twoStepMembers ??= new Set()).add(ME);
      }
      return res;
    };
    jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await unlocked(t, <AccountScreen />);
    await fireEvent.press(await screen.findByTestId('two-step-begin'));
    await fireEvent.changeText(await screen.findByTestId('step-up-password'), PASSWORD);
    await fireEvent.press(screen.getByTestId('step-up-go'));
    await fireEvent.changeText(await screen.findByTestId('two-step-code'), '123456');
    await fireEvent.press(screen.getByTestId('two-step-confirm'));
    expect(await screen.findByTestId('recovery-codes-sheet')).toBeTruthy();
    expect(screen.getByTestId('recovery-code-9')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('recovery-codes-kept'));
    await waitFor(() => expect(screen.queryByTestId('recovery-codes-sheet')).toBeNull());
    expect(await screen.findByTestId('recovery-codes-left')).toHaveTextContent(/^10 of 10 left/);
  });

  it('no second step yet: set one up first, and no codes offered', async () => {
    const t = recoveryVault();
    await unlocked(t, <AccountScreen />);
    expect(await screen.findByTestId('recovery-codes-first')).toHaveTextContent(
      'Set up two-step sign-in first, and then make codes for it.',
    );
    expect(screen.queryByTestId('recovery-codes-make')).toBeNull();
  });

  it('security questions set, never their answers shown; removed, asked first', async () => {
    const t = recoveryVault();
    await unlocked(t, <AccountScreen />);
    expect(await screen.findByTestId('questions-warning')).toHaveTextContent(/relatives may know the answers/);
    await fireEvent.press(screen.getByTestId('questions-edit'));
    // The same question twice: said, and nothing sent.
    await fireEvent.press(screen.getByTestId('questions-pick-1'));
    await fireEvent.press(await screen.findByTestId('questions-picker-option-first_school'));
    for (const i of [0, 1, 2]) await fireEvent.changeText(screen.getByTestId(`questions-answer-${i}`), `answer ${i}`);
    await fireEvent.press(screen.getByTestId('questions-save'));
    expect(await screen.findByTestId('questions-problem')).toHaveTextContent('Choose a different question each time.');
    // A question in my own words.
    await fireEvent.press(screen.getByTestId('questions-pick-1'));
    await fireEvent.press(await screen.findByTestId('questions-picker-option-own'));
    await fireEvent.changeText(screen.getByTestId('questions-own-1'), 'Where did we go in 1999?');
    await fireEvent.changeText(screen.getByTestId('questions-answer-2'), 'no');
    await fireEvent.press(screen.getByTestId('questions-save'));
    expect(await screen.findByTestId('questions-problem')).toHaveTextContent('Each answer needs at least 4 letters or numbers.');
    await fireEvent.changeText(screen.getByTestId('questions-answer-2'), 'Cornwall');
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByTestId('questions-save'));
    expect(await screen.findByTestId('questions-set')).toBeTruthy();
    expect(screen.getByTestId('questions-set-1')).toHaveTextContent('2. Where did we go in 1999?');
    expect(screen.getByTestId('questions-set-at')).toHaveTextContent(/Your answers are never shown\./);
    expect(screen.queryByText('Cornwall')).toBeNull();
    expect(t.vault.state.securityQuestions?.get(ME)?.questions.map((q) => q.key)).toEqual([
      'first_school',
      'own',
      'childhood_street',
    ]);

    await fireEvent.press(screen.getByTestId('questions-remove'));
    expect(await screen.findByText('Remove your security questions?')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('questions-remove-yes'));
    await waitFor(() => expect(screen.queryByTestId('questions-set')).toBeNull());
    expect(t.vault.state.securityQuestions?.has(ME)).toBe(false);
    expect(screen.getByTestId('questions-edit')).toHaveTextContent('Set security questions');
  });

  it('a vault without them: neither card', async () => {
    const t = testVault([ORIGIN]);
    await unlocked(t, <AccountScreen />);
    expect(await screen.findByTestId('two-step-state')).toBeTruthy();
    expect(screen.queryByText('Recovery codes')).toBeNull();
    expect(screen.queryByText('Security questions')).toBeNull();
  });
});
