import { fireEvent, screen } from '@testing-library/react-native';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';
import Connect from '../app/connect';
import { extra } from '../config';
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
    const os = jest.replaceProperty(Platform, 'OS', 'android');
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
    // The Android steps, as they ship (the tests run as an iPhone otherwise).
    expect(screen.getByTestId('connect-certificate-guide')).toHaveTextContent(/vault-ca\.crt/);
    expect(audit()).toEqual([]);
    expect(screen.getByTestId('connect-certificate-guide')).toHaveTextContent(/Install anyway/);
    expect(screen.getByTestId('connect-certificate-guide')).toHaveTextContent(/User credentials/);
    os.restore();
  });

});

describe('Connect: the Android release build (0.21.0)', () => {
  const trust = new Error(
    'javax.net.ssl.SSLHandshakeException: java.security.cert.CertPathValidatorException: Trust anchor for certification path not found.',
  );
  let os: { restore: () => void } | null = null;
  beforeEach(() => {
    installed();
    os = jest.replaceProperty(Platform, 'OS', 'android');
    extra.variant = 'release';
  });
  afterEach(() => {
    os?.restore();
    delete extra.variant;
    delete extra.userCertificates;
  });

  async function connectTo(address: string) {
    const t = testVault([]);
    await renderApp(
      <Connect
        deps={{ fetch: t.fetch, network: async () => 'wifi', whyFailed: async () => trust, validated: async () => true }}
      />,
    );
    await fireEvent.changeText(screen.getByTestId('connect-address'), address);
    await fireEvent.press(screen.getByTestId('connect-go'));
  }

  it('as built (its switch on): a vault’s own certificate is installed on the phone, as before', async () => {
    extra.userCertificates = true;
    await connectTo('vault.local');
    expect(await screen.findByTestId('connect-certificate')).toHaveTextContent(/install it on this phone once/);
    await fireEvent.press(screen.getByTestId('connect-certificate-how'));
    expect(screen.getByTestId('connect-certificate-guide')).toHaveTextContent(/vault-ca\.crt/);
  });

  it('made strict: says plainly that one installed by hand can’t be used, and offers no steps', async () => {
    extra.userCertificates = false;
    await connectTo('vault.local');
    expect(await screen.findByTestId('connect-certificate')).toHaveTextContent(
      /^This phone doesn't trust your vault's certificate, and this app can't use one installed on the phone\./,
    );
    expect(screen.getByTestId('connect-certificate-for-host')).toHaveTextContent(/Let's Encrypt or Tailscale/);
    expect(screen.queryByTestId('connect-certificate-how')).toBeNull();
  });

  it('plain http is never tried, either way: it asks for the vault’s https address', async () => {
    extra.userCertificates = true;
    await connectTo('http://192.168.1.20:8099');
    expect(await screen.findByTestId('connect-https-only')).toHaveTextContent(/starting https:\/\//);
  });
});

describe('Connect: Wi-Fi sign-in pages (4.15)', () => {
  beforeEach(() => {
    installed();
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
