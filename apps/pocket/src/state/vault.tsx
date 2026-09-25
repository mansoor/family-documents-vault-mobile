import {
  ApiRequestError,
  createApi,
  createHttp,
  isSessionOver,
  NetworkError,
  serverOriginFrom,
  SessionCore,
  type Api,
  type FetchLike,
  type ResponseLike,
  type StoredSession,
  type TokenStore,
} from '@fdv/client';
import type { Capabilities } from '@fdv/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import { log } from '../log';
import { appHeaders } from '../net/app-headers';
import type { ConnectOutcome } from '../net/connect';
import { currentNetwork, onNetworkChange } from '../net/network';
import { httpDecision, identityCheck, type NetworkKind } from '../net/policy';
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
 *    phone must be on Wi-Fi or Ethernet, and the vault answering on this
 *    network must give the recorded instance_id — checked at most five
 *    minutes ago, and again after any network change (one Wi-Fi to another
 *    included) or the app coming back to the front.
 */

export type Phase = 'loading' | 'connect' | 'sign_in' | 'ready';
export type Notice = 'signed_out_here' | 'reinstalled' | 'stranger' | 'wifi_only' | null;

export type SignInResult =
  | { kind: 'ok' }
  | { kind: 'code' }
  | { kind: 'refused'; message: string; passkeyHint: boolean }
  | { kind: 'unreachable' }
  | { kind: 'stranger' }
  | { kind: 'wifi_only' };

export interface VaultDeps {
  fetch: FetchLike;
  /** For uploads: expo/fetch on the phone, which sends a body of bytes as it is. */
  uploadFetch: FetchLike;
  network: () => Promise<NetworkKind>;
  /** Calls back on any change of network; returns the unsubscribe. */
  onNetworkChange: (callback: () => void) => () => void;
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
  /** The same vault, for uploads (longer timeout, bytes-safe fetch). */
  uploadApi: Api | null;
  /** Who is signed in, to which vault; null until the phase is ready. */
  who: (Pick<StoredSession, 'member_id' | 'role' | 'household_id'> & { origin: string }) | null;
  /**
   * Whose session this is at this instant — read from the session itself,
   * not from the last render — for work that must only ever be done as one
   * person (the queue's uploads).
   */
  sessionOwner: () => { origin: string; member_id: string } | null;
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

/** An http vault, and the phone is not on Wi-Fi or Ethernet: nothing is sent. */
export class WifiOnlyError extends Error {
  constructor() {
    super('This vault is only used on Wi-Fi.');
    this.name = 'WifiOnlyError';
  }
}

/** Anything that means "no usable answer from the vault here and now". */
const unusable = (err: unknown) =>
  err instanceof NetworkError || err instanceof StrangerError || err instanceof WifiOnlyError;

const platformFetch: FetchLike = (url, init) =>
  globalThis.fetch(url, init as RequestInit) as unknown as Promise<ResponseLike>;

const expoUploadFetch: FetchLike = (url, init) => {
  if (Platform.OS === 'web') return platformFetch(url, init);
  // Loaded when first used: it is native code, and the tests never send through it.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { fetch } = require('expo/fetch') as typeof import('expo/fetch');
  return fetch(url, init as never) as unknown as Promise<ResponseLike>;
};

/** The slowest uplink an upload is waited for: about 128 kbit/s. */
const MIN_UPLOAD_RATE = 16 * 1024;

/**
 * An upload waits a minute, plus as long as its body takes at the slowest
 * uplink worth waiting for: a 25 MB file on poor mobile data still gets
 * there, and a stalled one is still given up on.
 */
function withSizedTimeout(send: FetchLike): FetchLike {
  return async (url, init) => {
    const size = init.body instanceof Uint8Array ? init.body.byteLength : 0;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000 + Math.ceil((size / MIN_UPLOAD_RATE) * 1000));
    try {
      return await send(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };
}

const defaultDeps = (): VaultDeps => ({
  fetch: platformFetch,
  uploadFetch: expoUploadFetch,
  network: currentNetwork,
  onNetworkChange,
  store: new SecureTokenStore(),
  now: () => Date.now(),
});

export function VaultProvider(props: { children: ReactNode; deps?: Partial<VaultDeps> }) {
  const deps = useMemo<VaultDeps>(
    // A test's fetch is the vault for uploads too, unless it says otherwise.
    () => ({ ...defaultDeps(), ...props.deps, uploadFetch: props.deps?.uploadFetch ?? props.deps?.fetch ?? expoUploadFetch }),
    [props.deps],
  );
  const [phase, setPhase] = useState<Phase>('loading');
  const [vault, setVault] = useState<VaultRecord | null>(null);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [offline, setOffline] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [installation, setInstallation] = useState<string | null>(null);
  const verified = useRef<{ at: number; network: NetworkKind; epoch: number } | null>(null);
  // Bumped on every network change: an identity check that began on the
  // previous network says nothing about this one.
  const epoch = useRef(0);
  const mfaToken = useRef<string | null>(null);

  // Keyed on the origin, not the record: saving the email after sign-in
  // must not make a new client, and with it a new session core that has
  // forgotten the access token it was just given.
  const origin = vault?.origin ?? null;
  const api = useMemo(() => {
    if (!origin || !installation) return null;
    return createApi(
      createHttp({
        baseUrl: origin,
        fetch: deps.fetch,
        headers: () => appHeaders(installation),
        timeoutMs: 20_000,
      }),
    );
  }, [origin, installation, deps.fetch]);

  const uploadApi = useMemo(() => {
    if (!origin || !installation) return null;
    return createApi(
      createHttp({
        baseUrl: origin,
        fetch: withSizedTimeout(deps.uploadFetch),
        headers: () => appHeaders(installation),
      }),
    );
  }, [origin, installation, deps.uploadFetch]);

  useEffect(
    () =>
      deps.onNetworkChange(() => {
        epoch.current += 1;
        verified.current = null;
      }),
    [deps],
  );

  /**
   * For an http vault: may anything secret go to it, here and now? Only on
   * Wi-Fi or Ethernet, and only if the vault answering on this network is
   * the approved one. Throws WifiOnlyError, StrangerError or NetworkError.
   */
  const gate = useCallback(async (): Promise<void> => {
    if (!vault || !api || vault.origin.startsWith('https://')) return;
    // A check that the network changed under is thrown away and made again.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const started = epoch.current;
      const network = await deps.network();
      const decision = httpDecision(
        { origin: vault.origin, host: serverOriginFrom(vault.origin)?.host ?? '' },
        network,
        vault,
      );
      if (decision.kind === 'refuse_mobile_data') {
        verified.current = null;
        setNotice('wifi_only');
        throw new WifiOnlyError();
      }
      if (decision.kind !== 'allowed') {
        // No longer approved, or no longer private: send it nothing.
        verified.current = null;
        setNotice('stranger');
        throw new StrangerError();
      }
      const v = verified.current;
      if (v && v.epoch === started && v.network === network && deps.now() - v.at < IDENTITY_TTL) return;
      verified.current = null;
      const answered = await api.capabilities(); // NetworkError propagates: offline
      if (epoch.current !== started) continue;
      const identity = identityCheck(vault.origin, vault.instanceId, answered.instance_id);
      if (identity.kind !== 'same') {
        setNotice('stranger');
        log.warn('identity.mismatch', { secure: false });
        throw new StrangerError();
      }
      verified.current = { at: deps.now(), network, epoch: started };
      setNotice((n) => (n === 'stranger' || n === 'wifi_only' ? null : n));
      setCaps(answered);
      return;
    }
    throw new NetworkError('offline');
  }, [vault, api, deps]);

  // The session core outlives changes to the vault record, so it reaches
  // the gate through a ref. Until the first effect has run it refuses.
  const gateRef = useRef<() => Promise<void>>(async () => {
    throw new NetworkError('offline');
  });
  useEffect(() => {
    gateRef.current = gate;
  }, [gate]);

  const session = useMemo(
    () =>
      new SessionCore(
        // The refresher reads the gate (a ref) when a refresh runs, not
        // while rendering; the compiler cannot see that from here.
        // eslint-disable-next-line react-hooks/refs
        {
          refresh: async (refreshToken: string) => {
            if (!api) throw new NetworkError('offline');
            try {
              await gateRef.current();
            } catch (err) {
              // Not the approved vault, or not on Wi-Fi: say nothing to it,
              // and treat it as no answer — the session stays for later.
              if (unusable(err)) throw new NetworkError('offline');
              throw err;
            }
            return api.refresh(refreshToken);
          },
        },
        deps.store,
        { now: deps.now },
      ),
    [api, deps.store, deps.now],
  );

  // Each session core reads the store once. Anything that wants a token
  // waits for that read: a core that has not read it yet says "signed out",
  // and believing it would clear a session that is really there. A store
  // that cannot be read counts as empty: signed out, not stuck.
  const hydration = useRef<{ core: SessionCore; done: Promise<void> } | null>(null);
  const hydrated = useCallback((core: SessionCore): Promise<void> => {
    if (hydration.current?.core !== core) {
      const done = core.hydrate().catch(async () => {
        log.error('session.unreadable', {});
        await core.clear().catch(() => undefined);
      });
      hydration.current = { core, done };
    }
    return hydration.current.done;
  }, []);

  // Launch: forget a previous installation, find the vault, hydrate.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (firstLaunch()) await forgetPreviousInstallation();
        const id = await installationId();
        const v = readVaults();
        const current = v.known.find((k) => k.origin === v.current) ?? null;
        if (cancelled) return;
        setInstallation(id);
        setVault(current);
        if (!current) setPhase('connect');
      } catch {
        // Never stuck on the loading screen: start from Connect.
        log.error('launch.failed', {});
        if (!cancelled) setPhase('connect');
      }
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
    if (!api || !vault) return;
    epoch.current += 1;
    verified.current = null;
    if (vault.origin.startsWith('http://')) {
      // Over http only the gate may believe what answers: a stranger's
      // capability document is not shown, and does not clear the banner.
      try {
        await gate();
        setOffline(false);
      } catch (err) {
        if (unusable(err)) setOffline(true);
      }
      return;
    }
    try {
      const answered = await api.capabilities();
      setOffline(false);
      const identity = identityCheck(vault.origin, vault.instanceId, answered.instance_id);
      if (identity.kind === 'reinstalled' || identity.kind === 'first') {
        // Record who is there now, so the next look does not say so again.
        const next = updateVault(vault.origin, { instanceId: answered.instance_id ?? null });
        setVault(next.known.find((k) => k.origin === vault.origin) ?? vault);
      }
      setCaps(answered);
      if (identity.kind === 'reinstalled') {
        await session.clear();
        setNotice('reinstalled');
        setPhase('sign_in');
      }
    } catch (err) {
      if (err instanceof NetworkError) setOffline(true);
    }
  }, [api, vault, session, gate]);

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
      try {
        await gate();
      } catch (err) {
        if (unusable(err)) setOffline(true);
        throw err;
      }
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
    if (err instanceof WifiOnlyError) return { kind: 'wifi_only' };
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

  const sessionOwner = useCallback(() => {
    const info = session.info;
    return info && origin ? { origin, member_id: info.member_id } : null;
  }, [session, origin]);

  // The session core is not React state; what it says changes only as the phase does.
  const who = useMemo<VaultValue['who']>(() => {
    const info = phase === 'ready' ? session.info : null;
    return info && vault ? { origin: vault.origin, member_id: info.member_id, role: info.role, household_id: info.household_id } : null;
  }, [phase, vault, session]);

  const value = useMemo<VaultValue>(
    () => ({
      phase,
      vault,
      caps,
      offline,
      notice,
      api,
      uploadApi,
      who,
      sessionOwner,
      chooseVault,
      signIn,
      signInCode,
      signOut,
      chooseAnotherVault,
      withToken,
      recheck,
    }),
    [phase, vault, caps, offline, notice, api, uploadApi, who, sessionOwner, chooseVault, signIn, signInCode, signOut, chooseAnotherVault, withToken, recheck],
  );
  return <VaultContext.Provider value={value}>{props.children}</VaultContext.Provider>;
}
