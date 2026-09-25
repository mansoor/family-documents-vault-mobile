import { fireEvent, screen } from '@testing-library/react-native';
import * as Linking from 'expo-linking';
import Connect from '../app/connect';
import { audit } from '../test-support/a11y';
import { installed, renderApp } from '../test-support/render';
import { testVault } from '../test-support/vault';

jest.mock('expo-linking', () => ({ openURL: jest.fn(async () => true) }));

/** Everything the app keeps: its preference files and its secure store. */
function kept(): string {
  const g = globalThis as unknown as { __files: Map<string, string>; __secureStore: Map<string, string> };
  return JSON.stringify([...g.__files.entries(), ...g.__secureStore.entries()]);
}

describe('Connect: links, certificates, Wi-Fi sign-in pages (4.15)', () => {
  beforeEach(() => {
    installed();
    jest.mocked(Linking.openURL).mockClear();
  });

  it('a pasted invitation becomes the address, with the browser for the rest; its secret is kept nowhere', async () => {
    const t = testVault(['https://vault.test']);
    await renderApp(<Connect deps={{ fetch: t.fetch, network: async () => 'wifi' }} />);
    await fireEvent.changeText(screen.getByTestId('connect-address'), 'https://vault.test/join/link-secret-0123456789');
    expect(screen.getByTestId('connect-address').props.value).toBe('https://vault.test');
    expect(screen.getByTestId('connect-link-join')).toHaveTextContent(
      'Invitations are accepted in the browser. Open it there, then come back and sign in.',
      { exact: false },
    );
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByTestId('connect-link-open'));
    expect(Linking.openURL).toHaveBeenCalledWith('https://vault.test/join/link-secret-0123456789');
    // Connecting afterwards reaches the vault at its origin; the secret was never written down.
    await fireEvent.press(screen.getByTestId('connect-go'));
    expect(t.calls.every((c) => !c.includes('link-secret'))).toBe(true);
    expect(kept()).not.toContain('link-secret');
  });

  it('a shared link is for the browser, and leaves the field empty', async () => {
    const t = testVault(['https://vault.test']);
    await renderApp(<Connect deps={{ fetch: t.fetch, network: async () => 'wifi' }} />);
    await fireEvent.changeText(screen.getByTestId('connect-address'), 'vault.test/shared/share-secret-99');
    expect(screen.getByTestId('connect-address').props.value).toBe('');
    expect(screen.getByTestId('connect-link-shared')).toHaveTextContent(
      "That's a link for someone outside the family. It opens in the browser.",
      { exact: false },
    );
    await fireEvent.press(screen.getByTestId('connect-link-open'));
    expect(Linking.openURL).toHaveBeenCalledWith('https://vault.test/shared/share-secret-99');
  });

  it('a trust failure shows the certificate copy, and how to install it', async () => {
    const t = testVault([]);
    const trust = new Error(
      'javax.net.ssl.SSLHandshakeException: java.security.cert.CertPathValidatorException: Trust anchor for certification path not found.',
    );
    await renderApp(
      <Connect
        deps={{
          fetch: t.fetch,
          network: async () => 'wifi',
          whyFailed: async () => trust,
          validated: async () => true,
        }}
      />,
    );
    await fireEvent.changeText(screen.getByTestId('connect-address'), 'vault.local');
    await fireEvent.press(screen.getByTestId('connect-go'));
    expect(await screen.findByTestId('connect-certificate')).toHaveTextContent(
      "This phone doesn't trust your vault's certificate yet. If your vault makes its own certificate, install it on this phone once — here's how.",
      { exact: false },
    );
    await fireEvent.press(screen.getByTestId('connect-certificate-how'));
    expect(screen.getByTestId('connect-certificate-guide')).toHaveTextContent(/vault-ca\.crt/);
    expect(audit()).toEqual([]);
  });

  it('a Wi-Fi sign-in page says to finish signing in to the Wi-Fi', async () => {
    const t = testVault(['https://vault.test']);
    t.impostor.set('https://vault.test', '<html>Welcome</html>');
    await renderApp(<Connect deps={{ fetch: t.fetch, network: async () => 'wifi', validated: async () => false }} />);
    await fireEvent.changeText(screen.getByTestId('connect-address'), 'vault.test');
    await fireEvent.press(screen.getByTestId('connect-go'));
    expect(await screen.findByTestId('connect-captive')).toHaveTextContent(
      'Something answered, but it looks like a Wi-Fi sign-in page. Finish signing in to the Wi-Fi, then try again.',
    );
  });
});
