import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Linking from 'expo-linking';
import { Text } from 'react-native';
import { useVault } from '../state/vault';
import { readVaults } from '../state/vaults';
import { installed, renderApp } from '../test-support/render';
import { testVault } from '../test-support/vault';
import Connect from '../app/connect';

jest.mock('expo-linking', () => ({ openURL: jest.fn(async () => true) }));

function Phase() {
  const { phase } = useVault();
  return <Text testID="phase">{phase}</Text>;
}

async function go(address: string) {
  await fireEvent.changeText(screen.getByTestId('connect-address'), address);
  await fireEvent.press(screen.getByTestId('connect-go'));
}

describe('Connect', () => {
  beforeEach(() => installed());

  it('an address that answers but is not a vault is refused, in words', async () => {
    const t = testVault(['https://router.test']);
    t.impostor.set('https://router.test', { hello: 'router' });
    await renderApp(<Connect deps={{ fetch: t.fetch, network: async () => 'wifi' }} />);
    await go('router.test');
    await screen.findByText(/isn't a Family Document Vault/);
  });

  it('a vault older than the minimum shows both versions and who can update it', async () => {
    const t = testVault(['https://vault.test']);
    t.caps = { ...t.caps, server_version: '0.4.2' };
    await renderApp(<Connect deps={{ fetch: t.fetch, network: async () => 'wifi' }} />);
    await go('vault.test');
    await screen.findByText(/Your vault is on version 0\.4\.2\. This app needs 0\.4\.4 or newer\. Whoever looks after the vault can update it/);
    await fireEvent.press(screen.getByText('Show how'));
    expect(Linking.openURL).toHaveBeenCalledWith(expect.stringContaining('#upgrading'));
  });

  it('an app older than min_client_version asks for an update', async () => {
    const t = testVault(['https://vault.test']);
    t.caps = { ...t.caps, min_client_version: '9.0.0' };
    await renderApp(<Connect deps={{ fetch: t.fetch, network: async () => 'wifi' }} />);
    await go('vault.test');
    await screen.findByText(/This version of the app is too old for your vault\. It needs 9\.0\.0 or newer/);
  });

  it('setup_required sends you to the browser', async () => {
    const t = testVault(['https://vault.test']);
    t.caps = { ...t.caps, setup_required: true };
    await renderApp(<Connect deps={{ fetch: t.fetch, network: async () => 'wifi' }} />);
    await go('vault.test');
    await screen.findByText(/hasn't been set up yet/);
    await fireEvent.press(screen.getByText('Open in browser'));
    expect(Linking.openURL).toHaveBeenCalledWith('https://vault.test');
  });

  it('a home vault without a certificate is used only after you say so', async () => {
    const t = testVault(['http://192.168.1.20:8099']);
    await renderApp(
      <>
        <Phase />
        <Connect deps={{ fetch: t.fetch, network: async () => 'wifi' }} />
      </>,
      { fetch: t.fetch },
    );
    await go('192.168.1.20:8099');
    await screen.findByText(/doesn't use a secure connection/);
    // Until the answer is yes nothing is remembered, and the only thing sent
    // is the capability check that found a vault there to ask about.
    expect(readVaults().known).toEqual([]);
    expect(t.calls.filter((c) => c.includes('http://'))).toEqual(['GET http://192.168.1.20:8099/api/v1/capabilities']);
    await fireEvent.press(screen.getByTestId('connect-approve-http'));
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('sign_in'));
    expect(screen.queryByText(/doesn't use a secure connection/)).toBeNull();
    expect(readVaults().known).toEqual([expect.objectContaining({ origin: 'http://192.168.1.20:8099', httpApproved: true })]);
  });
});
