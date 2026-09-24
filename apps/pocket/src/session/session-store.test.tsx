import { createApi, createHttp, SessionCore, type FetchLike } from '@fdv/client';
import { render, screen, waitFor } from '@testing-library/react-native';
import { useEffect } from 'react';
import { Text } from 'react-native';
import '../i18n';
import { appHeaders } from '../net/app-headers';
import { useVault, VaultProvider } from '../state/vault';
import { installed, knownVault, signedIn } from '../test-support/render';
import { testVault } from '../test-support/vault';
import { installationId, resetInstallationForTests, SecureTokenStore, SESSION_KEY } from './store';

function Phase() {
  const { phase } = useVault();
  return <Text testID="phase">{phase}</Text>;
}

describe('the session on the phone', () => {
  beforeEach(() => resetInstallationForTests());

  it('hydrates before the first screen', async () => {
    installed();
    knownVault();
    await new SecureTokenStore().save({
      refresh_token: 'refresh-1',
      household_id: 'h',
      member_id: 'm',
      role: 'owner',
    });
    const seen: string[] = [];
    function Record() {
      const { phase } = useVault();
      seen.push(phase);
      return <Text testID="phase">{phase}</Text>;
    }
    await render(
      <VaultProvider deps={{ fetch: testVault().fetch, network: async () => 'wifi' }}>
        <Record />
      </VaultProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('ready'));
    // Never shown the sign-in screen, or Connect, on the way.
    expect(seen.filter((p) => p !== 'loading')).toEqual(['ready']);
  });

  it('with no vault chosen, Connect comes first', async () => {
    installed();
    await render(
      <VaultProvider deps={{ fetch: testVault().fetch, network: async () => 'wifi' }}>
        <Phase />
      </VaultProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('connect'));
  });

  it('asking for a token before the store has been read keeps the session', async () => {
    installed();
    const t = testVault();
    await signedIn(t);
    const got: string[] = [];
    // Asks the moment the vault is known, before the launch has read the store.
    function Eager() {
      const { api, withToken } = useVault();
      useEffect(() => {
        if (!api) return;
        withToken(async (_a, token) => token).then(
          () => got.push('token'),
          (err: unknown) => got.push(String(err)),
        );
      }, [api, withToken]);
      return null;
    }
    await render(
      <VaultProvider deps={{ fetch: t.fetch, network: async () => 'wifi' }}>
        <Phase />
        <Eager />
      </VaultProvider>,
    );
    await waitFor(() => expect(got).toContain('token'));
    expect(got.filter((g) => g !== 'token')).toEqual([]);
    expect(screen.getByTestId('phase')).toHaveTextContent('ready');
    const secure = (globalThis as unknown as { __secureStore: Map<string, string> }).__secureStore;
    expect(secure.has(SESSION_KEY)).toBe(true);
  });

  it('session_ended clears the tokens', async () => {
    const t = testVault();
    const api = createApi(createHttp({ baseUrl: 'https://vault.test', fetch: t.fetch }));
    const store = new SecureTokenStore();
    const core = new SessionCore({ refresh: (r) => api.refresh(r) }, store);
    const tokens = await api.signIn('owner@example.test', 'correct horse battery staple');
    if ('mfa_required' in tokens) throw new Error('no second step here');
    await core.accept(tokens);
    const secure = (globalThis as unknown as { __secureStore: Map<string, string> }).__secureStore;
    expect(secure.has(SESSION_KEY)).toBe(true);
    // The vault ends every session.
    for (const s of t.vault.state.sessions) s.revoked = true;
    const fresh = new SessionCore({ refresh: (r) => api.refresh(r) }, store);
    await fresh.hydrate();
    const result = await fresh.token();
    expect(result.kind).toBe('ended');
    await fresh.clear();
    expect(secure.has(SESSION_KEY)).toBe(false);
  });

  it('a first launch after installing forgets what the keystore still held', async () => {
    const secure = (globalThis as unknown as { __secureStore: Map<string, string> }).__secureStore;
    secure.set(SESSION_KEY, JSON.stringify({ refresh_token: 'left-over', household_id: 'h', member_id: 'm', role: 'owner' }));
    knownVault();
    await render(
      <VaultProvider deps={{ fetch: testVault().fetch, network: async () => 'wifi' }}>
        <Phase />
      </VaultProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('sign_in'));
    expect(secure.has(SESSION_KEY)).toBe(false);
  });

  it('the installation id is created once and sent on every request with the app User-Agent', async () => {
    const first = await installationId();
    resetInstallationForTests();
    expect(await installationId()).toBe(first);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);

    const seen: Record<string, string>[] = [];
    const t = testVault();
    const spy: FetchLike = async (url, init) => {
      seen.push(init.headers);
      return t.fetch(url, init);
    };
    const api = createApi(createHttp({ baseUrl: 'https://vault.test', fetch: spy, headers: () => appHeaders(first) }));
    await api.capabilities();
    await api.signIn('owner@example.test', 'correct horse battery staple');
    expect(seen).toHaveLength(2);
    for (const h of seen) {
      expect(h['x-fdv-installation']).toBe(first);
      expect(h['user-agent']).toMatch(/^FamilyDocumentVault\/[\d.]+ \((Android|iOS) 15; Test Phone 1\)$/);
    }
  });
});
