import type { FakePhone } from '@fdv/client/testing';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import SignIn from '../app/sign-in';
import { DocumentDetail } from '../documents/detail';
import { TextNotificationsCard } from '../push/texts-card';
import { MobileNumber } from '../settings/mobile-number';
import { TextCodes } from '../settings/text-codes';
import { TwoStep } from '../settings/two-step';
import { useVault } from '../state/vault';
import { audit } from '../test-support/a11y';
import { libraryDoc, unlocked } from '../test-support/lookup';
import { installed, knownVault, renderApp } from '../test-support/render';
import { resetRoutes, routes } from '../test-support/router';
import { caps0519, capabilities, testVault, type TestVault } from '../test-support/vault';

jest.mock(
  'expo-router',
  () => jest.requireActual<typeof import('../test-support/router')>('../test-support/router').routerMock,
);

/**
 * Texts on the phone (SMS4), against the vault's SMS1–SMS3 (0.9.0-dev.33):
 * the person's mobile number, confirmed by a texted code; codes by text at
 * sign-in and to confirm it's them; texts for reminders, alerts and links
 * opened, with quiet hours; and a link's code texted to whoever it is for.
 */

const ORIGIN = 'https://vault.test';
const ME = 'fake-member';

beforeEach(() => {
  installed();
  resetRoutes();
});

/** A vault of 0.9.0-dev.33, its texts set up. */
function vault(): TestVault {
  const t = testVault([ORIGIN]);
  t.caps = capabilities({
    features: {
      ...caps0519().features,
      share_options: true,
      share_second_factor: true,
      sms_texts: true,
      sms_notifications: true,
      sms_codes: true,
    },
  });
  t.vault.state.smsReady = true;
  return t;
}

/** The person's own number, confirmed. */
function confirmedPhone(t: TestVault) {
  const now = new Date().toISOString();
  const phone: FakePhone = {
    number: '+447700900456',
    confirmed_at: now,
    code: null,
    code_expires_at: null,
    attempts: 0,
    updated_at: now,
  };
  (t.vault.state.phones ??= new Map()).set(ME, phone);
}

function Phase() {
  const { phase } = useVault();
  return <Text testID="phase">{phase}</Text>;
}

describe('Account → Mobile number', () => {
  it('added, confirmed with the texted code, then removed after asking', async () => {
    const t = vault();
    await unlocked(t, <MobileNumber />);
    await fireEvent.changeText(await screen.findByTestId('mobile-number'), '07700 900456');
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByTestId('mobile-send'));
    expect(await screen.findByTestId('mobile-waiting')).toHaveTextContent(/We’ve texted a code to .*456/);
    // Android offers a texted code from the message itself.
    expect(screen.getByTestId('mobile-code').props.autoComplete).toBe('sms-otp');
    const code = t.vault.state.phones?.get(ME)?.code as string;
    await fireEvent.changeText(screen.getByTestId('mobile-code'), code);
    await fireEvent.press(screen.getByTestId('mobile-confirm'));
    expect(await screen.findByTestId('mobile-said')).toHaveTextContent('Your mobile number is confirmed.');
    expect(screen.getByTestId('mobile-shown')).toHaveTextContent(/456$/);
    expect(t.vault.state.phones?.get(ME)?.confirmed_at).toBeTruthy();

    await fireEvent.press(screen.getByTestId('mobile-remove'));
    expect(await screen.findByText('Remove your mobile number?')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('mobile-remove-yes'));
    expect(await screen.findByTestId('mobile-said')).toHaveTextContent('Your mobile number is removed.');
    expect(t.vault.state.phones?.get(ME)).toBeUndefined();
  });

  it('a wrong code: the vault’s words, and the number still waiting', async () => {
    const t = vault();
    await unlocked(t, <MobileNumber />);
    await fireEvent.changeText(await screen.findByTestId('mobile-number'), '07700 900456');
    await fireEvent.press(screen.getByTestId('mobile-send'));
    await fireEvent.changeText(await screen.findByTestId('mobile-code'), '000000');
    await fireEvent.press(screen.getByTestId('mobile-confirm'));
    expect(await screen.findByTestId('mobile-problem')).toBeTruthy();
    expect(screen.getByTestId('mobile-waiting')).toBeTruthy();
  });

  it('texts not set up and no number: nothing offered', async () => {
    const t = vault();
    t.vault.state.smsReady = false;
    await unlocked(t, <MobileNumber />);
    await waitFor(() => expect(screen.queryByTestId('mobile-number')).toBeNull());
  });
});

describe('Account → Codes by text', () => {
  it('a code when setting a new password, turned on; the warning said; an owner without another factor is told why not', async () => {
    const t = vault();
    confirmedPhone(t);
    await unlocked(t, <TextCodes />);
    expect(await screen.findByTestId('text-codes-warning')).toHaveTextContent(/weakest way to prove it’s you/);
    expect(screen.getByTestId('text-codes-to')).toHaveTextContent(/456/);
    expect(screen.getByTestId('text-codes-reset').props.accessibilityLabel).toBe('When I set a new password');
    await fireEvent(screen.getByTestId('text-codes-reset'), 'valueChange', true);
    await waitFor(() => expect(t.vault.state.textCodes?.get(ME)).toEqual({ sign_in: false, reset: true }));
    // An owner needs a passkey or an authenticator app first: the vault says so.
    await fireEvent(screen.getByTestId('text-codes-sign-in'), 'valueChange', true);
    expect(await screen.findByTestId('text-codes-problem')).toHaveTextContent(/An owner needs a passkey/);
    expect(t.vault.state.textCodes?.get(ME)?.sign_in).toBe(false);
  });
});

describe('Settings → Texts', () => {
  it('the day’s reminders by text, and quiet hours saved', async () => {
    const t = vault();
    confirmedPhone(t);
    await unlocked(t, <TextNotificationsCard />);
    await fireEvent(await screen.findByTestId('texts-daily'), 'valueChange', true);
    await waitFor(() => expect(t.push.prefs).toEqual(expect.objectContaining({ daily_text: true })));
    expect(screen.getByTestId('texts-quiet-from').props.value).toBe('21:00');
    await fireEvent.changeText(screen.getByTestId('texts-quiet-from'), '22:30');
    await fireEvent.changeText(screen.getByTestId('texts-quiet-to'), '7:00');
    expect(screen.getByTestId('texts-quiet-save').props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );
    await fireEvent.changeText(screen.getByTestId('texts-quiet-to'), '07:00');
    await fireEvent.press(screen.getByTestId('texts-quiet-save'));
    expect(await screen.findByTestId('texts-said')).toHaveTextContent('Quiet hours saved.');
    expect(t.push.prefs).toEqual(expect.objectContaining({ quiet_from: '22:30', quiet_to: '07:00' }));
  });

  it('no confirmed number yet: says where to add one', async () => {
    const t = vault();
    await unlocked(t, <TextNotificationsCard />);
    expect(await screen.findByTestId('texts-no-number')).toHaveTextContent(/in Account/);
    await fireEvent.press(screen.getByTestId('texts-add-number'));
    expect(routes()).toEqual([{ pathname: '/account', params: {} }]);
  });
});

describe('Sign in with a code by text', () => {
  it('the code texted as the password is accepted, typed back, and in', async () => {
    knownVault();
    const t = vault();
    confirmedPhone(t);
    t.vault.state.textCodes = new Map([[ME, { sign_in: true, reset: false }]]);
    await renderApp(
      <>
        <Phase />
        <SignIn />
      </>,
      { fetch: t.fetch },
    );
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('sign_in'));
    await fireEvent.changeText(screen.getByTestId('sign-in-email'), 'owner@example.test');
    await fireEvent.changeText(screen.getByTestId('sign-in-password'), 'correct horse battery staple');
    await fireEvent.press(screen.getByTestId('sign-in-go'));
    expect(await screen.findByTestId('sign-in-code-texted')).toHaveTextContent(/We’ve texted a code to .*456/);
    expect(screen.getByTestId('sign-in-code').props.autoComplete).toBe('sms-otp');
    // A text the only way: no authenticator app offered.
    expect(screen.queryByTestId('sign-in-code-switch')).toBeNull();
    // Another, asked for: the newest is the one that works.
    await fireEvent.press(screen.getByTestId('sign-in-text-again'));
    await waitFor(() => expect(t.vault.state.texts?.length).toBe(2));
    const code = t.vault.state.textCodesOut?.get(`${ME}:sign_in`)?.code as string;
    await fireEvent.changeText(screen.getByTestId('sign-in-code'), code);
    await fireEvent.press(screen.getByTestId('sign-in-go'));
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('ready'));
  });
});

describe('Confirm it’s you with a code by text', () => {
  it('an adult who turned on the sign-in code: Text a code, typed back, and on', async () => {
    const t = vault();
    t.vault.state.role = 'adult';
    confirmedPhone(t);
    // Turned on once signed in: the test signs in with the password alone.
    await unlocked(t, <TwoStep />, {
      before: () => {
        t.vault.state.textCodes = new Map([[ME, { sign_in: true, reset: false }]]);
      },
    });
    // What GET /auth/step-up says for such a person.
    t.library.account.stepUpTextTo = '•••• •••456';
    await fireEvent.press(await screen.findByTestId('two-step-begin'));
    await fireEvent.press(await screen.findByTestId('step-up-text'));
    expect(await screen.findByTestId('step-up-texted')).toHaveTextContent(/456/);
    expect(screen.getByTestId('step-up-code').props.autoComplete).toBe('sms-otp');
    const code = t.vault.state.textCodesOut?.get(`${ME}:step_up`)?.code as string;
    await fireEvent.changeText(screen.getByTestId('step-up-code'), code);
    await fireEvent.press(screen.getByTestId('step-up-go'));
    expect(await screen.findByTestId('two-step-secret')).toBeTruthy();
    expect(t.library.stepUps).toEqual([`text:${code}`]);
  });
});

describe('Share: a code by text', () => {
  it('their mobile number, and the link made with its code to go by text', async () => {
    const t = vault();
    libraryDoc(t, { id: 'passport', title: 'Passport' });
    await unlocked(t, <DocumentDetail id="passport" />);
    await fireEvent.press(await screen.findByTestId('document-more'));
    await fireEvent.press(await screen.findByTestId('document-share'));
    await fireEvent.changeText(await screen.findByTestId('share-label'), 'Dr Patel');
    await fireEvent.press(await screen.findByTestId('share-protect-text'));
    await fireEvent.changeText(screen.getByTestId('share-phone'), '12');
    expect(await screen.findByText('That doesn’t look like a mobile number.')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('share-phone'), '07700 900123');
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByTestId('share-make'));
    expect(await screen.findByTestId('share-send')).toBeTruthy();
    expect(t.library.shareBodies).toEqual([
      {
        to: 'passport',
        body: expect.objectContaining({
          recipient_label: 'Dr Patel',
          with_pin: false,
          second_factor: 'sms',
          recipient_phone: '07700 900123',
        }),
      },
    ]);
  });

  it('texts not set up: no code by text offered', async () => {
    const t = vault();
    t.vault.state.smsReady = false;
    libraryDoc(t, { id: 'passport', title: 'Passport' });
    await unlocked(t, <DocumentDetail id="passport" />);
    await fireEvent.press(await screen.findByTestId('document-more'));
    await fireEvent.press(await screen.findByTestId('document-share'));
    await screen.findByTestId('share-protect-pin');
    expect(screen.queryByTestId('share-protect-text')).toBeNull();
  });
});
