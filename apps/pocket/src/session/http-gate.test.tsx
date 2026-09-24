import { act, render, screen, waitFor } from '@testing-library/react-native';
import { useEffect } from 'react';
import { Text } from 'react-native';
import '../i18n';
import type { NetworkKind } from '../net/policy';
import { useVault, VaultProvider, type SignInResult, type VaultDeps } from '../state/vault';
import { readVaults } from '../state/vaults';
import { installed, knownVault, signedIn } from '../test-support/render';
import { capabilities, testVault, type TestVault } from '../test-support/vault';
import { resetInstallationForTests } from './store';

const HOME = 'http://192.168.1.20:8099';
const NEW_INSTANCE = '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';

type Vault = ReturnType<typeof useVault>;

/** The provider, a way to reach it from the test, and a network the test controls. */
async function mount(t: TestVault, over: Partial<VaultDeps> = {}) {
  const box: { v: Vault | null; network: NetworkKind } = { v: null, network: 'wifi' };
  const changes = new Set<() => void>();
  function Grab() {
    const v = useVault();
    useEffect(() => {
      box.v = v;
    });
    return <Text testID="phase">{v.phase}</Text>;
  }
  const deps: Partial<VaultDeps> = {
    fetch: t.fetch,
    network: async () => box.network,
    onNetworkChange: (cb) => {
      changes.add(cb);
      return () => changes.delete(cb);
    },
    ...over,
  };
  await render(
    <VaultProvider deps={deps}>
      <Grab />
    </VaultProvider>,
  );
  const vault = () => {
    if (!box.v) throw new Error('not rendered yet');
    return box.v;
  };
  return {
    box,
    vault,
    changeNetwork: (to: NetworkKind) => {
      box.network = to;
      for (const cb of changes) cb();
    },
    run: async <T,>(fn: (v: Vault) => Promise<T>): Promise<T | Error> => {
      let out: T | Error = new Error('did not run');
      await act(async () => {
        out = await fn(vault()).catch((err: unknown) => err as Error);
      });
      return out;
    },
  };
}

/** What went to the http vault other than the capability check. */
const secrets = (t: TestVault) => t.calls.filter((c) => c.includes(HOME) && !c.endsWith('/api/v1/capabilities'));

describe('the gate in front of a plain-http vault', () => {
  beforeEach(() => {
    resetInstallationForTests();
    installed();
  });

  it.each<NetworkKind>(['cellular', 'unknown'])(
    'on %s nothing is sent to an approved http vault, not even the capability check',
    async (network) => {
      const t = testVault([HOME]);
      knownVault(HOME);
      const m = await mount(t);
      await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('sign_in'));
      m.box.network = network;
      t.calls.length = 0;
      const r = await m.run((v) => v.signIn('owner@example.test', 'correct horse battery staple'));
      expect(r).toEqual({ kind: 'wifi_only' } satisfies SignInResult);
      expect(t.calls).toEqual([]);
      expect(m.vault().notice).toBe('wifi_only');
    },
  );

  it('signed in, on mobile data: no refresh token and no access token go out', async () => {
    const t = testVault([HOME]);
    await signedIn(t, HOME);
    const m = await mount(t);
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('ready'));
    m.changeNetwork('cellular');
    t.calls.length = 0;
    const r = await m.run((v) => v.withToken((a, token) => a.documents(token, { limit: 1 })));
    expect(r).toBeInstanceOf(Error);
    expect(t.calls).toEqual([]);
    expect(m.vault().offline).toBe(true);
    // The session is kept for when the phone is back on Wi-Fi.
    expect(m.vault().phase).toBe('ready');
  });

  it('moving to another Wi-Fi checks again before anything secret is sent, and a stranger there gets nothing', async () => {
    const t = testVault([HOME]);
    await signedIn(t, HOME);
    const m = await mount(t);
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('ready'));
    const list = (v: Vault) => v.withToken((a, token) => a.documents(token, { limit: 1 }));

    t.calls.length = 0;
    await m.run(list);
    await m.run(list);
    // Checked once, then trusted for a while on the same network.
    expect(t.calls.filter((c) => c.endsWith('/api/v1/capabilities'))).toHaveLength(1);

    // A café's Wi-Fi, with something else at the same address.
    m.changeNetwork('wifi');
    t.impostor.set(HOME, capabilities({ instance_id: NEW_INSTANCE }));
    t.calls.length = 0;
    const r = await m.run(list);
    expect(r).toBeInstanceOf(Error);
    expect(t.calls).toEqual([`GET ${HOME}/api/v1/capabilities`]);
    expect(secrets(t)).toEqual([]);
    expect(m.vault().notice).toBe('stranger');
  });

  it('a stranger answering when the app comes back is not believed: its name is not shown', async () => {
    const t = testVault([HOME]);
    await signedIn(t, HOME);
    const m = await mount(t);
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('ready'));
    await m.run((v) => v.withToken(async () => null));
    expect(m.vault().caps?.branding.display_name).toBe('The Test family');

    t.impostor.set(HOME, capabilities({ instance_id: NEW_INSTANCE, branding: { display_name: 'Not yours' } }));
    await m.run((v) => v.recheck());
    expect(m.vault().caps?.branding.display_name).toBe('The Test family');
    expect(m.vault().notice).toBe('stranger');
    expect(m.vault().offline).toBe(true);
  });
});

describe('the session around it', () => {
  beforeEach(() => {
    resetInstallationForTests();
    installed();
  });

  it('signing in keeps the access token it was given: the first request does not refresh', async () => {
    const t = testVault();
    knownVault();
    const m = await mount(t);
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('sign_in'));
    await m.run((v) => v.signIn('owner@example.test', 'correct horse battery staple'));
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('ready'));
    t.calls.length = 0;
    await m.run((v) => v.withToken((a, token) => a.documents(token, { limit: 1 })));
    expect(t.calls.filter((c) => c.includes('/auth/refresh'))).toEqual([]);
    expect(t.calls).toHaveLength(1);
  });

  it('a vault reinstalled behind https is noticed once: the new installation is recorded', async () => {
    const t = testVault();
    await signedIn(t);
    const m = await mount(t);
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('ready'));

    t.caps = capabilities({ instance_id: NEW_INSTANCE });
    await m.run((v) => v.recheck());
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('sign_in'));
    expect(m.vault().notice).toBe('reinstalled');
    expect(readVaults().known[0]?.instanceId).toBe(NEW_INSTANCE);

    await m.run((v) => v.signIn('owner@example.test', 'correct horse battery staple'));
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('ready'));
    await m.run((v) => v.recheck());
    expect(m.vault().phase).toBe('ready');
  });

  it('a keystore that cannot be read starts signed out, not stuck loading', async () => {
    const t = testVault();
    knownVault();
    await mount(t, {
      store: {
        load: async () => {
          throw new Error('the keystore key is gone');
        },
        save: async () => undefined,
      },
    });
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('sign_in'));
  });
});
