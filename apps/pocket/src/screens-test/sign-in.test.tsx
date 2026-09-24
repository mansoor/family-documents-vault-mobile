import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { useVault } from '../state/vault';
import { installed, knownVault, renderApp, testVault, withTwoStep } from '../test-support/render';
import SignIn from '../app/sign-in';

function Phase() {
  const { phase } = useVault();
  return <Text testID="phase">{phase}</Text>;
}

describe('Sign in', () => {
  beforeEach(() => {
    installed();
    knownVault();
  });

  it('the code step appears and completes', async () => {
    const t = testVault();
    await renderApp(
      <>
        <Phase />
        <SignIn />
      </>,
      { fetch: withTwoStep(t) },
    );
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('sign_in'));
    await fireEvent.changeText(screen.getByTestId('sign-in-email'), 'owner@example.test');
    await fireEvent.changeText(screen.getByTestId('sign-in-password'), 'correct horse battery staple');
    await fireEvent.press(screen.getByTestId('sign-in-go'));
    await screen.findByText('One more step: the six-digit code from your authenticator app.');
    // The password is not kept once it has done its job.
    expect(screen.queryByTestId('sign-in-password')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('sign-in-code'), '123 456');
    await fireEvent.press(screen.getByTestId('sign-in-go'));
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('ready'));
  });

  it("a wrong password shows the vault's own words, and a passkey hint, and nothing changes", async () => {
    await renderApp(
      <>
        <Phase />
        <SignIn />
      </>,
    );
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('sign_in'));
    await fireEvent.changeText(screen.getByTestId('sign-in-email'), 'owner@example.test');
    await fireEvent.changeText(screen.getByTestId('sign-in-password'), 'not it');
    await fireEvent.press(screen.getByTestId('sign-in-go'));
    await screen.findByText("That email and password don't match.");
    expect(screen.getByText(/You sign in with a passkey/)).toBeTruthy();
    expect(screen.getByTestId('phase')).toHaveTextContent('sign_in');
  });

  it('a wrong code says so and keeps the code step', async () => {
    const t = testVault();
    await renderApp(<SignIn />, { fetch: withTwoStep(t) });
    await screen.findByTestId('sign-in-email');
    await fireEvent.changeText(screen.getByTestId('sign-in-email'), 'owner@example.test');
    await fireEvent.changeText(screen.getByTestId('sign-in-password'), 'correct horse battery staple');
    await fireEvent.press(screen.getByTestId('sign-in-go'));
    await screen.findByTestId('sign-in-code');
    await fireEvent.changeText(screen.getByTestId('sign-in-code'), '000000');
    await fireEvent.press(screen.getByTestId('sign-in-go'));
    await screen.findByText("That code didn't work.");
    expect(screen.getByTestId('sign-in-code')).toBeTruthy();
  });
});
