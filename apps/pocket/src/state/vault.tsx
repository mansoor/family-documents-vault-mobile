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
import { pushNative, type PushNative } from '../push/native';
import { forgetPreviousInstallation, installationId, SecureTokenStore } from '../session/store';
import { wordsFor } from '../errors/words';
import i18n from '../i18n';
import { emit } from './events';
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
/**
 * Why the sign-in screen is shown, or what Home should say. `paused`: the
 * vault ended the session because an owner locked this person's sign-in,
 * or a restore paused it (5.28: the end reason `suspended`).
 */
export type Notice = 'signed_out_here' | 'paused' | 'reinstalled' | 'stranger' | 'wifi_only' | null;

/** What the sign-in screen says after the vault ended the session, by its reason. */
const endedNotice = (reason: string | undefined): Notice => (reason === 'suspended' ? 'paused' : 'signed_out_here');

export type SignInResult =
  | { kind: 'ok' }
  | { kind: 'code' }
  | { kind: 'refused'; message: string; passkeyHint: boolean }
  /**
   * The password (and code) were right, but an owner has locked this
   * sign-in, or a restore paused it until an owner turns it back on (5.28,
   * `403 membership_suspended`). A reason never heard of is a lock.
   */
  | { kind: 'paused'; reason: 'locked' | 'restored' }
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
  /**
   * UnifiedPush's side of a session the vault ended (4.14): a flag the
   * native code set when the message came with the app closed, and the
   * message itself when it is open. Null where there is no push.
   */
  push: Pick<PushNative, 'sessionEnded' | 'clearSessionEnded' | 'addListener'> | null;
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
  /**
   * Work that must be done while the session still works, before signing
   * out or leaving the vault (4.14: the phone's push device is removed, so
   * the vault does not tell it "you were signed out"). Returns the undo.
   */
  onBeforeSignOut: (fn: () => Promise<void>) => () => void;
}

const VaultContext = createContext<VaultValue | null>(null);

export const useVault = (): VaultValue => {
  const v = useContext(VaultContext);
  if (!v) throw new Error('useVault outside VaultProvider');
  return v;
};

const IDENTITY_TTL = 5 * 60_000;
/** How long an https vault's capability document is believed before the front looks again. */
const RECHECK_TTL = 5 * 60_000;

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
  push: pushNative(),
});

export function VaultProvider(props: { children: ReactNode; deps?: Partial<VaultDeps> }) {
  const deps = useMemo<VaultDeps>(
    // A test's fetch is the vault for uploads too, unless it says otherwise.
    () => ({
      ...defaultDeps(),
      ...props.deps,
      uploadFetch: props.deps?.uploadFetch ?? props.deps?.fetch ?? expoUploadFetch,
    }),
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
  // When the capability document was last read over https, and the version
  // an answer last said: the vault is asked again when there is a reason —
  // an upgrade, a new network, a while away — not every time the app comes
  // to the front (0.2.0).
  const checkedAt = useRef(0);
  const versionHeard = useRef<(version: string) => void>(() => undefined);
  const versionSeen = useRef<string | null>(null);

  // Keyed on the origin, not the record: saving the email after sign-in
  // must not make a new client, and with it a new session core that has
  // forgotten the access token it was just given.
  const origin = vault?.origin ?? null;
  const api = useMemo(() => {
    if (!origin || !installation) return null;
    return createApi(
      // onServerVersion reads its ref when an answer arrives, not while
      // rendering; the compiler cannot see that from here.
      // eslint-disable-next-line react-hooks/refs
      createHttp({
        baseUrl: origin,
        fetch: deps.fetch,
        headers: () => appHeaders(installation),
        timeoutMs: 20_000,
        onServerVersion: (version) => versionHeard.current(version),
      }),
    );
  }, [origin, installation, deps.fetch]);

  const uploadApi = useMemo(() => {
    if (!origin || !installation) return null;
    return createApi(
      // As above: onServerVersion reads its ref when an answer arrives.
      // eslint-disable-next-line react-hooks/refs
      createHttp({
        baseUrl: origin,
        fetch: withSizedTimeout(deps.uploadFetch),
        headers: () => appHeaders(installation),
        onServerVersion: (version) => versionHeard.current(version),
      }),
    );
  }, [origin, installation, deps.uploadFetch]);

  // A network change: anything checked on the old one is checked again.
  // And if the app had found no connection, it looks now — what waited
  // for the connection (kept Essentials, 4.10) carries on when it answers.
  const offlineRef = useRef(false);
  const recheckRef = useRef<() => Promise<void>>(async () => undefined);
  useEffect(
    () =>
      deps.onNetworkChange(() => {
        epoch.current += 1;
        verified.current = null;
        if (offlineRef.current && AppState.currentState === 'active') void recheckRef.current();
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
      checkedAt.current = deps.now();
      if (identity.kind === 'reinstalled') {
        await session.clear();
        setNotice('reinstalled');
        setPhase('sign_in');
      }
    } catch (err) {
      if (err instanceof NetworkError) setOffline(true);
    }
  }, [api, vault, session, gate, deps]);

  /**
   * The vault signed this phone out and said so by push (4.14): signed out
   * here too, and the phone's copies go (sessionEnded, as when the vault
   * refuses a token). The native side already deleted the offline
   * databases when the message came.
   */
  const endedByPush = useCallback(async () => {
    // Not the vault's session core yet: the launch looks at the flag itself.
    if (!api) return;
    // Until the core has read the store, "signed out" means nothing.
    await hydrated(session);
    if (session.signedIn) {
      await session.clear();
      setNotice('signed_out_here');
      setPhase('sign_in');
      log.info('session.ended_by_push', {});
    }
    // The copies go whether or not anybody is signed in here (kept after an
    // expiry, say): a failure to remove them is retried at the next start.
    emit('sessionEnded', 'revoked');
    deps.push?.clearSessionEnded();
  }, [api, session, hydrated, deps.push]);

  // Once the vault and its session core exist: signed in or not.
  useEffect(() => {
    if (!vault || !api || phase !== 'loading') return;
    let cancelled = false;
    void (async () => {
      await hydrated(session);
      if (cancelled) return;
      // Told while the app was closed: finished before any screen shows.
      if (deps.push?.sessionEnded()) {
        await endedByPush();
        if (!cancelled) setPhase('sign_in');
        return;
      }
      setPhase(session.signedIn ? 'ready' : 'sign_in');
      // Signed in from the start (a session kept from before): what the
      // vault can do is learned now, not only the next time the app comes
      // to the front — keeping Essentials depends on it (4.10). Over http
      // the gate learns it before the first thing is sent.
      if (session.signedIn && vault.origin.startsWith('https://')) void recheck();
    })();
    return () => {
      cancelled = true;
    };
  }, [vault, api, session, phase, hydrated, recheck, deps.push, endedByPush]);

  // Told while the app is open: at once.
  useEffect(() => {
    const sub = deps.push?.addListener('onPush', (e) => {
      if (e.kind === 'message' && e.type === 'session_ended') void endedByPush();
    });
    return () => sub?.remove();
  }, [deps.push, endedByPush]);

  useEffect(() => {
    offlineRef.current = offline;
    recheckRef.current = recheck;
  }, [offline, recheck]);

  // An answer from another version than the one last read: the vault was
  // upgraded (or rolled back), so what it can do is read again. Once per
  // version, so a vault that says two things cannot make every answer a
  // check. A vault before 0.5.0 says nothing, and is read as before.
  useEffect(() => {
    versionHeard.current = (version) => {
      const known = caps?.server_version;
      if (!known || known === version || versionSeen.current === version) return;
      versionSeen.current = version;
      void recheck();
    };
  }, [caps, recheck]);

  // Coming back to the front: look again, as the network may have changed.
  // Over http the gate always looks — it is what vouches for the vault.
  // Over https the certificate does that, so the capability document is
  // read again only after a while away, or when the app had found no
  // connection; an upgrade is noticed from the version every answer says.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      const secure = vault?.origin.startsWith('https://') ?? false;
      if (secure && !offlineRef.current && deps.now() - checkedAt.current < RECHECK_TTL) return;
      void recheck();
    });
    return () => sub.remove();
  }, [recheck, vault, deps]);

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
        if (t.kind === 'ended') emit('sessionEnded', t.reason);
        setNotice(t.kind === 'ended' ? endedNotice(t.reason) : null);
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
          emit('sessionEnded', (err as ApiRequestError).reason ?? 'revoked');
          setNotice(endedNotice((err as ApiRequestError).reason));
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
      if (vault && email)
        setVault(updateVault(vault.origin, { email }).known.find((k) => k.origin === vault.origin) ?? vault);
      mfaToken.current = null;
      setNotice(null);
      setOffline(false);
      // The password was just given: the app's lock opens with it.
      emit('signedIn');
      setPhase('ready');
      // What the vault can do, learned now — keeping Essentials depends on
      // it (4.10). Over http the gate learns it before anything is sent.
      if (vault?.origin.startsWith('https://')) void recheckRef.current();
    },
    [session, vault],
  );

  const pendingEmail = useRef<string | null>(null);

  const signInFailed = (err: unknown): SignInResult => {
    if (err instanceof StrangerError) return { kind: 'stranger' };
    if (err instanceof WifiOnlyError) return { kind: 'wifi_only' };
    if (err instanceof NetworkError) return { kind: 'unreachable' };
    // Proven, and paused by an owner or a restore: said in the phone's own words (5.28).
    if (err instanceof ApiRequestError && err.code === 'membership_suspended') {
      return { kind: 'paused', reason: err.reason === 'restored' ? 'restored' : 'locked' };
    }
    // The vault's words for a wrong password; the catalogue's for anything else (4.17).
    const words = wordsFor(err, i18n.t.bind(i18n));
    if (err instanceof ApiRequestError) {
      return { kind: 'refused', message: words, passkeyHint: err.code === 'invalid_credentials' };
    }
    return { kind: 'refused', message: words, passkeyHint: false };
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
      if (!api || !mfaToken.current)
        return { kind: 'refused', message: i18n.t('signIn.startAgain'), passkeyHint: false };
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

  const beforeSignOut = useRef(new Set<() => Promise<void>>());
  const onBeforeSignOut = useCallback((fn: () => Promise<void>) => {
    beforeSignOut.current.add(fn);
    return () => {
      beforeSignOut.current.delete(fn);
    };
  }, []);
  const runBeforeSignOut = useCallback(async () => {
    for (const fn of [...beforeSignOut.current]) {
      try {
        await fn();
      } catch {
        // Best done, never in the way of signing out.
      }
    }
  }, []);

  const signOut = useCallback(async () => {
    await runBeforeSignOut();
    try {
      await withToken((a, token) => a.logout(token));
    } catch {
      // Signed out here regardless; the vault ends the session when it can.
    }
    await session.clear();
    emit('signedOut');
    setNotice(null);
    setPhase('sign_in');
  }, [withToken, session, runBeforeSignOut]);

  const chooseAnotherVault = useCallback(async () => {
    await runBeforeSignOut();
    await session.clear();
    emit('signedOut');
    leaveVault();
    verified.current = null;
    setVault(null);
    setCaps(null);
    setNotice(null);
    setPhase('connect');
  }, [session, runBeforeSignOut]);

  const sessionOwner = useCallback(() => {
    const info = session.info;
    return info && origin ? { origin, member_id: info.member_id } : null;
  }, [session, origin]);

  // The session core is not React state; what it says changes only as the phase does.
  const who = useMemo<VaultValue['who']>(() => {
    const info = phase === 'ready' ? session.info : null;
    return info && vault
      ? { origin: vault.origin, member_id: info.member_id, role: info.role, household_id: info.household_id }
      : null;
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
      onBeforeSignOut,
    }),
    [
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
      onBeforeSignOut,
    ],
  );
  return <VaultContext.Provider value={value}>{props.children}</VaultContext.Provider>;
}
