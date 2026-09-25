import { ApiRequestError } from '@fdv/client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, PermissionsAndroid, Platform } from 'react-native';
import { ownerKey } from '../essentials/wipe';
import { log } from '../log';
import { readPrefs, writePrefs } from '../platform/prefs';
import { emit, on } from '../state/events';
import { useVault } from '../state/vault';
import { pushNative, type Distributor, type PushNative } from './native';

/**
 * Notifications on this phone (4.14), through the person's own
 * distributor (ntfy and the like) — never Google's or Apple's.
 *
 * Turning them on: the notification permission (Android 13 and later),
 * a distributor (asked which, when there are several), the vault's VAPID
 * key, then the distributor's address — which arrives by itself, later —
 * told to the vault as this phone's device. A new address is told again.
 * Signing out removes the device and unregisters first, while the session
 * still works: the vault then has nobody here to tell "you were signed
 * out". A session the vault ends unregisters too: every session gets its
 * own address and keys, so a message meant for an old one — late, or
 * sent again — reaches nobody. The same person signing in again gets
 * them back without asking; somebody else does not.
 */
export type PushStatus =
  /** No push here: an iPhone, the web build. */
  | { kind: 'unsupported' }
  /** Not known yet: what the vault can do has not been heard. */
  | { kind: 'unknown' }
  /** The vault is older than 0.4.14. */
  | { kind: 'old_vault' }
  /** The vault can push, but has not been set up to. */
  | { kind: 'not_set_up' }
  | { kind: 'no_distributor' }
  | { kind: 'permission_off' }
  | { kind: 'off' }
  | { kind: 'waiting' }
  | { kind: 'on'; distributor: string | null }
  /** The distributor's reason, or the vault's own words when it refused the device. */
  | { kind: 'failed'; reason: string; message?: string };

export type TurnOn = 'on' | 'choose' | 'permission_off' | 'no_distributor' | 'not_set_up' | 'unreachable';

interface Prefs {
  /** Whose phone wants them: the same person signing in again gets them back. */
  wantedBy: string | null;
  /** What the vault was last told, and by whom: this address, as this device. */
  registered: { endpoint: string; id: string; owner: string } | null;
}

const PREFS = 'push';
const NONE: Prefs = { wantedBy: null, registered: null };

export interface PushDeps {
  native: PushNative | null;
  /** Android 13 and later ask; before that, an app may simply notify. */
  askPermission: () => Promise<boolean>;
}

async function askPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  if (Number(Platform.Version) < 33) return true;
  const answer = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  return answer === PermissionsAndroid.RESULTS.GRANTED;
}

interface PushValue {
  status: PushStatus;
  distributors: () => Distributor[];
  turnOn: (distributor?: string) => Promise<TurnOn>;
  turnOff: () => Promise<void>;
  sendTest: () => Promise<boolean>;
  /** The daily push, as the vault keeps it for this person (null: not heard yet). */
  daily: boolean | null;
  setDaily: (on: boolean) => Promise<void>;
  /** Bumped when a notification is tapped with the app open. */
  opened: number;
  takeOpen: () => string | null;
}

const PushContext = createContext<PushValue | null>(null);

export const usePush = (): PushValue => {
  const v = useContext(PushContext);
  if (!v) throw new Error('usePush outside PushProvider');
  return v;
};

export function PushProvider(props: { children: ReactNode; deps?: Partial<PushDeps> }) {
  const native = props.deps?.native !== undefined ? props.deps.native : pushNative();
  const ask = props.deps?.askPermission ?? askPermission;
  const { phase, caps, withToken, who, onBeforeSignOut } = useVault();
  const owner = who ? ownerKey(who.origin, who.member_id) : null;
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((n) => n + 1), []);
  const [daily, setDailyState] = useState<boolean | null>(null);
  const [opened, setOpened] = useState(0);
  // Refused when Android asked (until the app may notify after all).
  const [refused, setRefused] = useState(false);
  // What the vault said when it would not take the device.
  const [trouble, setTrouble] = useState<string | null>(null);
  // A registration asked of the distributor and not yet answered.
  const asked = useRef(false);

  const read = useCallback(() => readPrefs<Prefs>(PREFS, NONE), []);
  const write = useCallback(
    (p: Partial<Prefs>) => {
      writePrefs(PREFS, { ...readPrefs<Prefs>(PREFS, NONE), ...p });
      refresh();
    },
    [refresh],
  );

  const status = useMemo<PushStatus>(() => {
    void version;
    if (!native) return { kind: 'unsupported' };
    if (!caps) return { kind: 'unknown' };
    const flag = caps.features.unified_push;
    if (flag === undefined) return { kind: 'old_vault' };
    if (!flag) return { kind: 'not_set_up' };
    const s = native.state();
    const list = native.distributors();
    const p = read();
    if (refused && !s.allowed) return { kind: 'permission_off' };
    if (!owner || p.wantedBy !== owner) return list.length === 0 ? { kind: 'no_distributor' } : { kind: 'off' };
    if (!s.allowed) return { kind: 'permission_off' };
    if (list.length === 0) return { kind: 'no_distributor' };
    const saved = native.savedDistributor();
    const mine = p.registered?.owner === owner ? p.registered : null;
    if (mine && s.endpoint === mine.endpoint) {
      return { kind: 'on', distributor: list.find((d) => d.id === saved)?.name ?? null };
    }
    if (trouble) return { kind: 'failed', reason: 'VAULT', message: trouble };
    if (s.failure) return { kind: 'failed', reason: s.failure };
    // Nothing chosen and several to choose from: turning them on again asks which.
    if (!s.endpoint && list.length > 1 && !list.some((d) => d.id === saved)) return { kind: 'off' };
    return { kind: 'waiting' };
  }, [native, caps, owner, read, version, refused, trouble]);

  /** The key the vault signs its pushes with: the distributor needs it to register. */
  const vapid = useCallback(async (): Promise<string | null> => {
    const key = await withToken((a) => a.pushKey());
    return key.enabled && key.public_key ? key.public_key : null;
  }, [withToken]);

  /**
   * The vault told what the distributor gave: at a new address, after
   * signing in again, or when the address arrives. Nothing when it is
   * already told, or the person has not asked for notifications here.
   */
  const syncOnce = useCallback(async () => {
    if (!native || !owner || phase !== 'ready' || !caps?.features.unified_push) return;
    const p = read();
    if (p.wantedBy !== owner) return;
    const s = native.state();
    try {
      if (!s.endpoint || !s.p256dh || !s.auth) {
        // Signed in again, or the distributor forgot: asked again, once —
        // of the distributor chosen before, or the only one there is.
        if (s.failure || asked.current) return;
        const list = native.distributors();
        const saved = native.savedDistributor();
        if (!saved || !list.some((d) => d.id === saved)) {
          const only = list.length === 1 ? list[0] : undefined;
          if (!only) return;
          native.chooseDistributor(only.id);
        }
        const key = await vapid();
        if (!key) return;
        asked.current = true;
        native.register(key);
        return;
      }
      if (p.registered?.owner === owner && p.registered.endpoint === s.endpoint) return;
      const { endpoint, p256dh, auth } = s;
      const { id } = await withToken((a, token) =>
        a.registerDevice(token, { kind: 'unified_push', endpoint, keys: { p256dh, auth } }),
      );
      setTrouble(null);
      write({ registered: { endpoint, id, owner } });
      log.info('push.registered', {});
    } catch (err) {
      // The vault's refusal is shown; no connection is simply tried again later.
      if (err instanceof ApiRequestError) setTrouble(err.message);
      log.warn('push.sync_failed', { kind: err instanceof ApiRequestError ? err.code : 'network' });
    }
  }, [native, owner, phase, caps, read, write, vapid, withToken]);

  // One at a time: the address arriving, the app coming to the front and
  // turning them on may all ask at once, and the vault is told once.
  const latest = useRef(syncOnce);
  useEffect(() => {
    latest.current = syncOnce;
  }, [syncOnce]);
  const running = useRef<Promise<void> | null>(null);
  const again = useRef(false);
  const sync = useCallback((): Promise<void> => {
    const go = (): Promise<void> => {
      if (running.current) {
        again.current = true;
        return running.current;
      }
      const run = latest.current().finally(() => {
        running.current = null;
        if (again.current) {
          again.current = false;
          void go();
        }
      });
      running.current = run;
      return run;
    };
    return go();
  }, []);

  const turnOn = useCallback(
    async (distributor?: string): Promise<TurnOn> => {
      if (!native || !owner) return 'unreachable';
      if (!(await ask()) || !native.state().allowed) {
        setRefused(true);
        return 'permission_off';
      }
      setRefused(false);
      setTrouble(null);
      const list = native.distributors();
      if (list.length === 0) return 'no_distributor';
      const saved = native.savedDistributor();
      const pick =
        distributor ??
        (saved && list.some((d) => d.id === saved) ? saved : list.length === 1 ? (list[0]?.id ?? null) : null);
      if (!pick) return 'choose';
      native.chooseDistributor(pick);
      let key: string | null;
      try {
        key = await vapid();
      } catch {
        return 'unreachable';
      }
      if (!key) return 'not_set_up';
      write({ wantedBy: owner });
      asked.current = true;
      native.register(key);
      // An address the distributor already had comes back at once: told now.
      await sync();
      return 'on';
    },
    [native, owner, ask, write, vapid, sync],
  );

  const removeHere = useCallback(async () => {
    const p = read();
    if (p.registered) {
      const { endpoint } = p.registered;
      await withToken((a, token) => a.removeDevice(token, endpoint)).catch(() => undefined);
    }
    native?.unregister();
    asked.current = false;
  }, [native, read, withToken]);

  const turnOff = useCallback(async () => {
    await removeHere();
    setTrouble(null);
    write(NONE);
  }, [removeHere, write]);

  const sendTest = useCallback(async (): Promise<boolean> => {
    const id = read().registered?.id;
    if (!id) return false;
    try {
      await withToken((a, token) => a.testDevice(token, id));
      return true;
    } catch (err) {
      // Removed at the vault (from the web, say): told again, and tried once more.
      if (err instanceof ApiRequestError && err.status === 404) {
        write({ registered: null });
        await sync();
      }
      return false;
    }
  }, [read, write, sync, withToken]);

  const setDaily = useCallback(
    async (value: boolean) => {
      const p = await withToken((a, token) => a.updatePreferences(token, { daily_push: value }));
      setDailyState(p.daily_push);
    },
    [withToken],
  );

  const takeOpen = useCallback(() => native?.takeOpen() ?? null, [native]);

  // Signing out: the device goes first, while the session can still say so.
  useEffect(
    () =>
      onBeforeSignOut(async () => {
        if (!native) return;
        await removeHere();
        write({ registered: null });
      }),
    [native, onBeforeSignOut, removeHere, write],
  );

  // A session the vault ended took its devices with it: this registration
  // goes too, and the next sign-in makes a new one, with new keys. A tap
  // not yet followed is nobody's any more.
  useEffect(() => {
    const offEnded = on('sessionEnded', () => {
      native?.unregister();
      native?.takeOpen();
      asked.current = false;
      write({ registered: null });
    });
    const offOut = on('signedOut', () => {
      native?.takeOpen();
    });
    const offIn = on('signedIn', () => {
      asked.current = false;
    });
    return () => {
      offEnded();
      offOut();
      offIn();
    };
  }, [native, write]);

  // Somebody else signed in on this phone: nothing of the last person's
  // push. (The status already reads as off for them: nothing to redraw.)
  useEffect(() => {
    if (!native || !owner) return;
    const p = read();
    if ((p.wantedBy && p.wantedBy !== owner) || (p.registered && p.registered.owner !== owner)) {
      native.unregister();
      writePrefs(PREFS, NONE);
    }
  }, [native, owner, read]);

  // Signed in (again), or the app back at the front: anything new is told.
  useEffect(() => {
    if (phase !== 'ready') return;
    void sync();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        refresh();
        void sync();
      }
    });
    return () => sub.remove();
  }, [phase, sync, refresh]);

  // What the distributor and the notifications say, as it happens.
  useEffect(() => {
    if (!native) return;
    const sub = native.addListener('onPush', (e) => {
      if (e.kind === 'endpoint') {
        asked.current = false;
        void sync();
      } else if (e.kind === 'failed' || e.kind === 'unregistered') {
        asked.current = false;
      } else if (e.kind === 'message' && e.type === 'digest') {
        emit('remindersChanged');
      } else if (e.kind === 'open') {
        setOpened((n) => n + 1);
      }
      refresh();
    });
    return () => sub.remove();
  }, [native, sync, refresh]);

  // The daily push, once notifications are on.
  const isOn = status.kind === 'on';
  useEffect(() => {
    if (!isOn) return;
    let cancelled = false;
    withToken((a, token) => a.preferences(token))
      .then((p) => {
        if (!cancelled) setDailyState(p.daily_push);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isOn, withToken]);

  const distributors = useCallback(() => native?.distributors() ?? [], [native]);

  const value = useMemo<PushValue>(
    () => ({ status, distributors, turnOn, turnOff, sendTest, daily, setDaily, opened, takeOpen }),
    [status, distributors, turnOn, turnOff, sendTest, daily, setDaily, opened, takeOpen],
  );
  return <PushContext.Provider value={value}>{props.children}</PushContext.Provider>;
}
