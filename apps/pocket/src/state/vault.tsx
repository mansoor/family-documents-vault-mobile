import {
  ApiRequestError,
  createApi,
  createHttp,
  isSessionOver,
  NetworkError,
  SessionCore,
  type Api,
  type FetchLike,
  type ResponseLike,
  type TokenStore,
} from '@fdv/client';
import type { Capabilities } from '@fdv/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { log } from '../log';
import { appHeaders } from '../net/app-headers';
import type { ConnectOutcome } from '../net/connect';
import { currentNetwork } from '../net/network';
import { identityCheck, type NetworkKind } from '../net/policy';
import { firstLaunch } from '../platform/prefs';
import { forgetPreviousInstallation, installationId, SecureTokenStore } from '../session/store';
import { leaveVault, readVaults, saveVault, updateVault, type VaultRecord } from './vaults';

/**
 * The app's one piece of shared state: which vault, whether somebody is
 * signed in, and whether the vault can be reached.
 *
 * Two rules live here because every request passes through:
 *
 *  - **Offline is not signed out.** A refresh that gets no answer keeps the
 *    session and shows the offline banner; only the vault saying so ends it.
 *  - **Nothing secret goes to a plain-http vault unless it is the one that
 *    was approved.** Before a token or a password is sent over http, the
 *    vault answering on this network must give the recorded instance_id —
 *    checked at most five minutes ago, and again whenever the network
 *    changes or the app comes back to the front.
 */

export type Phase = 'loading' | 'connect' | 'sign_in' | 'ready';
export type Notice = 'signed_out_here' | 'reinstalled' | 'stranger' | null;

export type SignInResult =
  | { kind: 'ok' }
  | { kind: 'code' }
  | { kind: 'refused'; message: string; passkeyHint: boolean }
  | { kind: 'unreachable' }
  | { kind: 'stranger' };

export interface VaultDeps {
  fetch: FetchLike;
  network: () => Promise<NetworkKind>;
  store: TokenStore;
  now: () => number;
}

interface VaultValue {
  phase: Phase;
  vault: VaultRecord | null;
  caps: Capabilities | null;
  offline: boolean;
  notice: Notice;
  api: Api | null;
  chooseVault: (outcome: Extract<ConnectOutcome, { kind: 'ok' | 'reinstalled' }>) => Promise<void>;
  signIn: (email: string, password: string) => Promise<SignInResult>;
  signInCode: (code: string) => Promise<SignInResult>;
  signOut: () => Promise<void>;
  chooseAnotherVault: () => Promise<void>;
  withToken: <T>(fn: (api: Api, token: string) => Promise<T>) => Promise<T>;
  recheck: () => Promise<void>;
}

const VaultContext = createContext<VaultValue | null>(null);

export const useVault = (): VaultValue => {
  const v = useContext(VaultContext);
  if (!v) throw new Error('useVault outside VaultProvider');
  return v;
};

const IDENTITY_TTL = 5 * 60_000;

/** The vault answering on this network is not the one approved. */
export class StrangerError extends Error {
  constructor() {
    super('Something else is answering at this address.');
    this.name = 'StrangerError';
  }
}

const defaultDeps = (): VaultDeps => ({
  fetch: (url, init) => globalThis.fetch(url, init as RequestInit) as unknown as Promise<ResponseLike>,
  network: currentNetwork,
  store: new SecureTokenStore(),
  now: () => Date.now(),
});

export function VaultProvider(props: { children: ReactNode; deps?: Partial<VaultDeps> }) {
  const deps = useMemo<VaultDeps>(() => ({ ...defaultDeps(), ...props.deps }), [props.deps]);
  const [phase, setPhase] = useState<Phase>('loading');
  const [vault, setVault] = useState<VaultRecord | null>(null);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [offline, setOffline] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [installation, setInstallation] = useState<string | null>(null);
  const verified = useRef<{ at: number; network: NetworkKind } | null>(null);
  const mfaToken = useRef<string | null>(null);

  const api = useMemo(() => {
    if (!vault || !installation) return null;
    return createApi(
      createHttp({
        baseUrl: vault.origin,
        fetch: deps.fetch,
        headers: () => appHeaders(installation),
        timeoutMs: 20_000,
      }),
    );
  }, [vault, installation, deps.fetch]);

  /** For an http vault: is the one answering here the approved one? */
  const gate = useCallback(async (): Promise<void> => {
    if (!vault || !api || vault.origin.startsWith('https://')) return;
    const network = await deps.network();
    const v = verified.current;
    if (v && v.network === network && deps.now() - v.at < IDENTITY_TTL) return;
    const answered = await api.capabilities(); // NetworkError propagates: offline
    const identity = identityCheck(vault.origin, vault.instanceId, answered.instance_id);
    if (identity.kind !== 'same') {
      verified.current = null;
      setNotice('stranger');
      log.warn('identity.mismatch', { secure: false });
      throw new StrangerError();
    }
    verified.current = { at: deps.now(), network };
    setCaps(answered);
  }, [vault, api, deps]);

  const session = useMemo(
    () =>
      new SessionCore(
        // The refresher reads the identity cache (a ref) when a refresh
        // runs, not while rendering; the compiler cannot see that from here.
        // eslint-disable-next-line react-hooks/refs
        {
          refresh: async (refreshToken: string) => {
            if (!api) throw new NetworkError('offline');
            try {
              await gate();
            } catch (err) {
              // Not the approved vault: say nothing to it, and treat it as
              // no answer — the session stays for when the right one is back.
              if (err instanceof StrangerError) throw new NetworkError('offline');
              throw err;
            }
            return api.refresh(refreshToken);
          },
        },
        deps.store,
        { now: deps.now },
      ),
    [api, gate, deps.store, deps.now],
  );

  // Each session core reads the store once. Anything that wants a token
  // waits for that read: a core that has not read it yet says "signed out",
  // and believing it would clear a session that is really there.
  const hydration = useRef<{ core: SessionCore; done: Promise<void> } | null>(null);
  const hydrated = useCallback((core: SessionCore): Promise<void> => {
    if (hydration.current?.core !== core) hydration.current = { core, done: core.hydrate() };
    return hydration.current.done;
  }, []);

  // Launch: forget a previous installation, find the vault, hydrate.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (firstLaunch()) await forgetPreviousInstallation();
      const id = await installationId();
      const v = readVaults();
      const current = v.known.find((k) => k.origin === v.current) ?? null;
      if (cancelled) return;
      setInstallation(id);
      setVault(current);
      if (!current) setPhase('connect');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Once the vault and its session core exist: signed in or not.
  useEffect(() => {
    if (!vault || !api || phase !== 'loading') return;
    let cancelled = false;
    void (async () => {
      await hydrated(session);
      if (!cancelled) setPhase(session.signedIn ? 'ready' : 'sign_in');
    })();
    return () => {
      cancelled = true;
    };
  }, [vault, api, session, phase, hydrated]);

  const recheck = useCallback(async () => {
    if (!api) return;
    verified.current = null;
    try {
      const answered = await api.capabilities();
      setOffline(false);
      if (vault && vault.origin.startsWith('https://')) {
        const identity = identityCheck(vault.origin, vault.instanceId, answered.instance_id);
        if (identity.kind === 'reinstalled') {
          await session.clear();
          setNotice('reinstalled');
          setPhase('sign_in');
          return;
        }
      }
      setCaps(answered);
    } catch (err) {
      if (err instanceof NetworkError) setOffline(true);
    }
  }, [api, vault, session]);

  // Coming back to the front: look again, as the network may have changed.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void recheck();
    });
    return () => sub.remove();
  }, [recheck]);

  const withToken = useCallback(
    async <T,>(fn: (a: Api, token: string) => Promise<T>): Promise<T> => {
      if (!api) throw new NetworkError('offline');
      await hydrated(session);
      await gate();
      const t = await session.token();
      if (t.kind === 'offline') {
        setOffline(true);
        throw new NetworkError('offline');
      }
      if (t.kind === 'ended' || t.kind === 'signed_out') {
        await session.clear();
        setNotice(t.kind === 'ended' ? 'signed_out_here' : null);
        setPhase('sign_in');
        throw new ApiRequestError(401, 'session_ended', 'Sign in again to carry on.');
      }
      try {
        const out = await fn(api, t.token);
        setOffline(false);
        return out;
      } catch (err) {
        if (err instanceof NetworkError) setOffline(true);
        if (isSessionOver(err)) {
          await session.clear();
          setNotice('signed_out_here');
          setPhase('sign_in');
        }
        throw err;
      }
    },
    [api, gate, session, hydrated],
  );

  const chooseVault = useCallback(
    async (outcome: Extract<ConnectOutcome, { kind: 'ok' | 'reinstalled' }>) => {
      const before = readVaults();
      const previous = before.known.find((k) => k.origin === outcome.origin);
      const record: VaultRecord = {
        origin: outcome.origin,
        instanceId: outcome.caps.instance_id ?? null,
        httpApproved: outcome.origin.startsWith('http://') || previous?.httpApproved === true,
        displayName: outcome.caps.branding.display_name,
        email: previous?.email ?? null,
      };
      // A session belongs to one vault; another vault, or this one
      // reinstalled, starts from nothing.
      if (before.current !== outcome.origin || outcome.kind === 'reinstalled') await session.clear();
      saveVault(record);
      verified.current = null;
      setNotice(outcome.kind === 'reinstalled' ? 'reinstalled' : null);
      setCaps(outcome.caps);
      setVault(record);
      setPhase('loading');
    },
    [session],
  );

  const accepted = useCallback(
    async (tokens: Parameters<SessionCore['accept']>[0], email: string | null) => {
      await session.accept(tokens);
      if (vault && email) setVault(updateVault(vault.origin, { email }).known.find((k) => k.origin === vault.origin) ?? vault);
      mfaToken.current = null;
      setNotice(null);
      setOffline(false);
      setPhase('ready');
    },
    [session, vault],
  );

  const pendingEmail = useRef<string | null>(null);

  const signInFailed = (err: unknown): SignInResult => {
    if (err instanceof StrangerError) return { kind: 'stranger' };
    if (err instanceof NetworkError) return { kind: 'unreachable' };
    if (err instanceof ApiRequestError) {
      return { kind: 'refused', message: err.message, passkeyHint: err.code === 'invalid_credentials' };
    }
    return { kind: 'refused', message: (err as Error).message, passkeyHint: false };
  };

  const signIn = useCallback(
    async (email: string, password: string): Promise<SignInResult> => {
      if (!api) return { kind: 'unreachable' };
      try {
        await gate();
        const r = await api.signIn(email.trim(), password);
        if ('mfa_required' in r) {
          mfaToken.current = r.mfa_token;
          pendingEmail.current = email.trim();
          return { kind: 'code' };
        }
        await accepted(r, email.trim());
        return { kind: 'ok' };
      } catch (err) {
        return signInFailed(err);
      }
    },
    [api, gate, accepted],
  );

  const signInCode = useCallback(
    async (code: string): Promise<SignInResult> => {
      if (!api || !mfaToken.current) return { kind: 'refused', message: 'Start again from your password.', passkeyHint: false };
      try {
        await gate();
        const tokens = await api.signInMfa(mfaToken.current, code.replace(/\s/g, ''));
        await accepted(tokens, pendingEmail.current);
        return { kind: 'ok' };
      } catch (err) {
        return signInFailed(err);
      }
    },
    [api, gate, accepted],
  );

  const signOut = useCallback(async () => {
    try {
      await withToken((a, token) => a.logout(token));
    } catch {
      // Signed out here regardless; the vault ends the session when it can.
    }
    await session.clear();
    setNotice(null);
    setPhase('sign_in');
  }, [withToken, session]);

  const chooseAnotherVault = useCallback(async () => {
    await session.clear();
    leaveVault();
    verified.current = null;
    setVault(null);
    setCaps(null);
    setNotice(null);
    setPhase('connect');
  }, [session]);

  const value = useMemo<VaultValue>(
    () => ({
      phase,
      vault,
      caps,
      offline,
      notice,
      api,
      chooseVault,
      signIn,
      signInCode,
      signOut,
      chooseAnotherVault,
      withToken,
      recheck,
    }),
    [phase, vault, caps, offline, notice, api, chooseVault, signIn, signInCode, signOut, chooseAnotherVault, withToken, recheck],
  );
  return <VaultContext.Provider value={value}>{props.children}</VaultContext.Provider>;
}
