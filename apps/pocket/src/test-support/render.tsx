import '../i18n';
import { createApi, createHttp, SessionCore, type FetchLike } from '@fdv/client';
import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { writePrefs } from '../platform/prefs';
import { SecureTokenStore } from '../session/store';
import { VaultProvider, type VaultDeps } from '../state/vault';
import type { Vaults } from '../state/vaults';
import { TextScaleProvider } from '../ui/text-scale';
import { INSTANCE, testVault, type TestVault } from './vault';

/** Not the first launch: the app's installation marker is already there. */
export function installed(): void {
  writePrefs('installed-marker', true);
  // prefs.firstLaunch() looks for a file called "installed".
  const files = (globalThis as unknown as { __files: Map<string, string> }).__files;
  files.set('doc:/installed', '');
}

/** The phone already knows this vault (and nobody is signed in yet). */
export function knownVault(origin = 'https://vault.test', over: Partial<Vaults['known'][number]> = {}): void {
  writePrefs('vaults', {
    current: origin,
    known: [
      {
        origin,
        instanceId: INSTANCE,
        httpApproved: origin.startsWith('http://'),
        displayName: 'The Test family',
        email: null,
        ...over,
      },
    ],
  } satisfies Vaults);
}

/**
 * A second step for sign-in: the fake vault answers the password with a
 * code challenge, and the code 123456 with real tokens.
 */
export function withTwoStep(t: TestVault): FetchLike {
  return async (url, init) => {
    if (url.endsWith('/api/v1/auth/password')) {
      const body = JSON.parse(String(init.body)) as { email: string; password: string };
      if (body.password === t.vault.state.password) {
        return respond(200, { mfa_required: true, mfa_token: 'mfa-1' });
      }
    }
    if (url.endsWith('/api/v1/auth/mfa')) {
      const body = JSON.parse(String(init.body)) as { code: string };
      if (body.code !== '123456') {
        return respond(401, { error: { code: 'invalid_code', message: "That code didn't work.", retriable: false } });
      }
      return t.fetch(url.replace('/auth/mfa', '/auth/password'), {
        ...init,
        body: JSON.stringify({ email: t.vault.state.email, password: t.vault.state.password }),
      });
    }
    return t.fetch(url, init);
  };
}

/** Signed in to this vault already: real tokens from the fake, kept where the app keeps them. */
export async function signedIn(t: TestVault, origin = 'https://vault.test'): Promise<void> {
  const { email, password } = t.vault.state;
  if (!email || !password) throw new Error('the test vault has no one to sign in as');
  knownVault(origin, { email });
  const api = createApi(createHttp({ baseUrl: origin, fetch: t.fetch }));
  const tokens = await api.signIn(email, password);
  if ('mfa_required' in tokens) throw new Error('no second step here');
  await new SessionCore({ refresh: (r) => api.refresh(r) }, new SecureTokenStore()).accept(tokens);
}

export function respond(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(body)).buffer,
  } as unknown as Awaited<ReturnType<FetchLike>>;
}

export async function renderApp(ui: ReactElement, opts: { fetch?: FetchLike; deps?: Partial<VaultDeps>; large?: boolean } = {}) {
  const t = testVault();
  const deps: Partial<VaultDeps> = {
    fetch: opts.fetch ?? t.fetch,
    network: async () => 'wifi',
    ...opts.deps,
  };
  const utils = await render(
    <TextScaleProvider {...(opts.large !== undefined ? { initialLarge: opts.large } : {})}>
      <VaultProvider deps={deps}>{ui}</VaultProvider>
    </TextScaleProvider>,
  );
  return { ...utils, vault: t };
}

export { testVault };
