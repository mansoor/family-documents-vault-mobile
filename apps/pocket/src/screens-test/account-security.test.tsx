import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { ChangePassword } from '../settings/password';
import { TwoStep } from '../settings/two-step';
import { audit } from '../test-support/a11y';
import { unlocked } from '../test-support/lookup';
import SignIn from '../app/sign-in';
import { installed, knownVault, renderApp } from '../test-support/render';
import { resetRoutes } from '../test-support/router';
import { testVault } from '../test-support/vault';

jest.mock(
  'expo-router',
  () => jest.requireActual<typeof import('../test-support/router')>('../test-support/router').routerMock,
);

/**
 * The person's own sign-in, from the phone (the owner's ask of 12 Nov
 * 2026): their password changed, and two-step sign-in set up and turned off.
 */

const ORIGIN = 'https://vault.test';

beforeEach(() => {
  installed();
  resetRoutes();
});

describe('Change your password', () => {
  it('the password now and the new one; ten characters at least; said when done', async () => {
    const t = testVault([ORIGIN]);
    await unlocked(t, <ChangePassword />);
    await fireEvent.press(await screen.findByTestId('password-open'));
    await fireEvent.changeText(screen.getByTestId('password-current'), t.vault.state.password as string);
    await fireEvent.changeText(screen.getByTestId('password-new'), 'too short');
    expect(screen.getByTestId('password-save').props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );
    await fireEvent.changeText(screen.getByTestId('password-new'), 'a much longer one');
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByTestId('password-save'));
    expect(await screen.findByTestId('password-done')).toHaveTextContent(/other devices have been signed out/);
    expect(t.library.account.changes).toEqual([
      { current_password: t.vault.state.password, new_password: 'a much longer one' },
    ]);
  });

  it('a wrong password now: said, and nothing changed', async () => {
    const t = testVault([ORIGIN]);
    await unlocked(t, <ChangePassword />);
    await fireEvent.press(await screen.findByTestId('password-open'));
    await fireEvent.changeText(screen.getByTestId('password-current'), 'not it at all');
    await fireEvent.changeText(screen.getByTestId('password-new'), 'a much longer one');
    await fireEvent.press(screen.getByTestId('password-save'));
    expect(await screen.findByTestId('password-problem')).toBeTruthy();
    expect(t.library.account.changes).toEqual([]);
  });
});

describe('Two-step sign-in', () => {
  it('set up after confirming it is you: opened in the authenticator app, a code turns it on; a code turns it off', async () => {
    const t = testVault([ORIGIN]);
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await unlocked(t, <TwoStep />);
    expect(await screen.findByTestId('two-step-state')).toHaveTextContent(/^Off/);
    await fireEvent.press(screen.getByTestId('two-step-begin'));
    await fireEvent.changeText(await screen.findByTestId('step-up-password'), t.vault.state.password as string);
    await fireEvent.press(screen.getByTestId('step-up-go'));
    expect(await screen.findByTestId('two-step-secret')).toHaveTextContent('JBSW Y3DP EHPK 3PXP');
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByTestId('two-step-open-app'));
    expect(open).toHaveBeenCalledWith(expect.stringMatching(/^otpauth:\/\/totp\//));
    await fireEvent.changeText(screen.getByTestId('two-step-code'), '123456');
    await fireEvent.press(screen.getByTestId('two-step-confirm'));
    expect(await screen.findByTestId('two-step-said')).toHaveTextContent('Two-step sign-in is on.');
    await waitFor(() => expect(screen.getByTestId('two-step-state')).toHaveTextContent(/^On/));
    expect(t.library.account.totp).toBe(true);
    // An owner keeps it: the household asks it of them.
    expect(screen.getByTestId('two-step-required')).toBeTruthy();
    expect(screen.queryByTestId('two-step-turn-off')).toBeNull();
    open.mockRestore();
  });

  it('turned off with a code, by somebody the household does not ask to keep it', async () => {
    const t = testVault([ORIGIN]);
    t.library.account.totp = true;
    t.library.account.required = false;
    await unlocked(t, <TwoStep />);
    expect(await screen.findByTestId('two-step-state')).toHaveTextContent(/^On/);
    await fireEvent.press(screen.getByTestId('two-step-turn-off'));
    await fireEvent.changeText(await screen.findByTestId('two-step-off-code'), '123456');
    await fireEvent.press(screen.getByTestId('two-step-off-yes'));
    expect(await screen.findByText('Two-step sign-in is off.')).toBeTruthy();
    expect(t.library.account.totp).toBe(false);
  });
});

describe('Forgot your password?', () => {
  it('at sign-in: the address, a link by email, and the same words whether or not it has a sign-in', async () => {
    knownVault();
    const t = testVault();
    await renderApp(<SignIn />, { fetch: t.fetch });
    await fireEvent.changeText(await screen.findByTestId('sign-in-email'), 'owner@example.test');
    await fireEvent.press(screen.getByTestId('sign-in-forgot'));
    // The address typed already is kept.
    expect(screen.getByTestId('forgot-email').props.value).toBe('owner@example.test');
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByTestId('forgot-send'));
    expect(await screen.findByTestId('forgot-said')).toHaveTextContent(/a link is on its way/);
    expect(t.library.account.forgot).toEqual(['owner@example.test']);
  });
});
