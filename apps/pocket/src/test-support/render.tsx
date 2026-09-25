import '../i18n';
import { createApi, createHttp, SessionCore, type FetchLike } from '@fdv/client';
import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { fixtureScanner } from '../capture/scanner';
import { writePrefs } from '../platform/prefs';
import { MemoryQueueStore } from '../queue/store';
import { installationId, SecureTokenStore } from '../session/store';
import { CaptureProvider, type CaptureDeps } from '../state/capture';
import { EssentialsProvider, type EssentialsDeps } from '../state/essentials';
import { LockProvider, type LockDeps } from '../state/lock';
import { StepUpProvider } from '../state/step-up';
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
  // As the app signs in: saying which installation it is (the vault keeps it on the session).
  const api = createApi(createHttp({ baseUrl: origin, fetch: t.fetch, installationId: await installationId() }));
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

/** A phone for the capture tests: files in memory, a queue in memory, pages from the test. */
export function testCapture(over: Partial<CaptureDeps> = {}): CaptureDeps & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  let n = 0;
  return {
    files,
    scanner: fixtureScanner([]),
    openStore: async () => new MemoryQueueStore(),
    read: async (uri) => {
      const f = files.get(uri);
      if (!f) throw new Error(`no such file ${uri}`);
      return f;
    },
    discard: async (uri) => {
      files.delete(uri);
    },
    uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    now: () => Date.now(),
    schedule: () => () => undefined,
    ...over,
  };
}

export async function renderApp(
  ui: ReactElement,
  opts: {
    fetch?: FetchLike;
    deps?: Partial<VaultDeps>;
    large?: boolean;
    capture?: Partial<CaptureDeps>;
    /** With the app's lock (4.8), on these parts; without, a phone with no lock. */
    lock?: Partial<LockDeps>;
    /** With the kept Essentials (4.10), inside the lock; on these parts. */
    essentials?: Partial<EssentialsDeps>;
  } = {},
) {
  const t = testVault();
  const deps: Partial<VaultDeps> = {
    fetch: opts.fetch ?? t.fetch,
    network: async () => 'wifi',
    ...opts.deps,
  };
  const capture = opts.capture ?? testCapture();
  const utils = await render(
    <SafeAreaProvider>
      <TextScaleProvider {...(opts.large !== undefined ? { initialLarge: opts.large } : {})}>
        <VaultProvider deps={deps}>
          {opts.lock ? (
            <LockProvider deps={opts.lock}>
              {opts.essentials ? (
                <EssentialsProvider deps={opts.essentials}>
                  <CaptureProvider deps={capture}>
                    <StepUpProvider>{ui}</StepUpProvider>
                  </CaptureProvider>
                </EssentialsProvider>
              ) : (
                <CaptureProvider deps={capture}>
                  <StepUpProvider>{ui}</StepUpProvider>
                </CaptureProvider>
              )}
            </LockProvider>
          ) : (
            <CaptureProvider deps={capture}>
              <StepUpProvider>{ui}</StepUpProvider>
            </CaptureProvider>
          )}
        </VaultProvider>
      </TextScaleProvider>
    </SafeAreaProvider>,
  );
  return { ...utils, vault: t };
}

export { testVault };
