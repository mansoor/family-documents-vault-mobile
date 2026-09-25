import { ApiRequestError, NetworkError } from '@fdv/client';
import type { DocumentView, OfflineGrant } from '@fdv/shared';
import { randomUUID } from 'expo-crypto';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState } from 'react-native';
import { jpegDataUri } from '../essentials/base64';
import { openPrivateCopies, type CopiesIo } from '../essentials/copies';
import { deleteEssentials, openEssentials, type Tier } from '../essentials/open';
import { sendOpens } from '../essentials/opens';
import type { EssentialsStore } from '../essentials/store';
import { ageOf, lastChecked, PRIVATE_COUNT_KEY, syncEssentials, type Age, type Checked, type PageFetch } from '../essentials/sync';
import { endWipes, OWNER_KEY, ownerKey } from '../essentials/wipe';
import { log } from '../log';
import { readPrefs, writePrefs } from '../platform/prefs';
import { on } from './events';
import { useLock } from './lock';
import { useVault } from './vault';

/**
 * Essentials in airplane mode (4.10).
 *
 * The phone keeps the Essentials the vault says it may, for when there is
 * no connection. This is where that happens:
 *
 *  - **Keeping them** asks for the password once (the vault's offline
 *    grant); the person's own Only me ones are a separate, explicit choice.
 *  - **Syncing** happens only in front: when the app unlocks, comes back,
 *    is pulled to refresh, or the connection returns. The vault's set is
 *    applied whole (see syncEssentials); what was opened is told.
 *  - **Removing them**: a session the vault ended, signing out, changing
 *    server, somebody else signing in, or copies left unchecked past the
 *    vault's limit. A lost connection never removes anything.
 *
 * Copies are opened only while the app's lock is open: their key is read
 * when it opens and dropped when it closes, and the store with it.
 */

export interface KeptDocument {
  id: string;
  versionId: string;
  document: DocumentView;
  pages: number;
  keptAt: number;
  private: boolean;
}

export interface OpenCopy {
  document: DocumentView;
  versionId: string;
  pages: number;
  /** A page as a data URI, from memory; null when it is not kept. */
  page(n: number): Promise<string | null>;
}

export type EssentialsNotice = 'removed_age' | 'signed_out' | 'short_of_space' | null;
export type EnrolOutcome = 'ok' | 'wrong_password' | 'offline' | 'failed';

export interface EssentialsDeps {
  io: CopiesIo;
  now: () => number;
  uuid: () => string;
}

interface Prefs {
  /** The person chose to keep Essentials on this phone. */
  enrolled: boolean;
  /** Home has offered it once. */
  offered: boolean;
  /** Copies are kept (the lock covers sign-in too while they are). */
  kept: boolean;
}

interface EssentialsValue {
  /** This phone and this vault can keep Essentials at all. */
  available: boolean;
  prefs: Prefs;
  items: KeptDocument[];
  /** Only me Essentials in the vault's set, and how many are kept here. */
  privateInSet: number;
  privateKept: number;
  checked: Checked | null;
  age: Age | null;
  grant: OfflineGrant | null;
  /** The grant lapses within three days: one password keeps it going. */
  renewDue: boolean;
  syncing: boolean;
  notice: EssentialsNotice;
  enrol(password: string, includePrivate: boolean): Promise<EnrolOutcome>;
  sync(): Promise<void>;
  open(id: string, mode: 'view' | 'show'): Promise<OpenCopy | null>;
  offered(): void;
  dismissNotice(): void;
}

const DAY = 86_400_000;
const RENEW_WITHIN = 3 * DAY;

function defaultDeps(): EssentialsDeps {
  return {
    io: { open: openEssentials, remove: deleteEssentials },
    now: () => Date.now(),
    uuid: () => randomUUID(),
  };
}

const Ctx = createContext<EssentialsValue | null>(null);

export function EssentialsProvider(props: { children: ReactNode; deps?: Partial<EssentialsDeps> }) {
  const d = useMemo<EssentialsDeps>(() => ({ ...defaultDeps(), ...props.deps }), [props.deps]);
  const { t } = useTranslation();
  const { who, withToken, caps, offline } = useVault();
  const lock = useLock();
  const [prefs, setPrefsState] = useState<Prefs>(() =>
    readPrefs('essentials', { enrolled: false, offered: false, kept: false }),
  );
  const [store, setStore] = useState<EssentialsStore | null>(null);
  const [items, setItems] = useState<KeptDocument[]>([]);
  const [privateInSet, setPrivateInSet] = useState(0);
  const [privateKept, setPrivateKept] = useState(0);
  const [checked, setChecked] = useState<Checked | null>(null);
  const [grant, setGrant] = useState<OfflineGrant | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<EssentialsNotice>(null);
  const storeRef = useRef<EssentialsStore | null>(null);
  const busy = useRef<Promise<void> | null>(null);

  const available =
    caps?.features.offline_essentials === true && lock.status !== 'none' && lock.level !== null && who?.role !== 'viewer';

  const setPrefs = useCallback((next: Partial<Prefs>) => {
    setPrefsState((p) => {
      const merged = { ...p, ...next };
      writePrefs('essentials', merged);
      return merged;
    });
  }, []);

  /** What the everyday store holds, as the list shows it. */
  const refresh = useCallback(async (s: EssentialsStore) => {
    const docs = await s.documents();
    setItems(
      docs.map((doc) => ({
        id: doc.id,
        versionId: doc.version_id,
        document: JSON.parse(doc.view) as DocumentView,
        pages: doc.pages,
        keptAt: doc.kept_at,
        private: false,
      })),
    );
    setChecked(await lastChecked(s));
    setPrivateInSet(Number((await s.state(PRIVATE_COUNT_KEY)) ?? 0));
  }, []);

  /** Every copy gone: the files, and what the screen shows. */
  const wipe = useCallback(
    async (why: EssentialsNotice) => {
      const s = storeRef.current;
      storeRef.current = null;
      setStore(null);
      await s?.close().catch(() => undefined);
      for (const tier of ['everyday', 'private'] as Tier[]) await d.io.remove(tier).catch(() => undefined);
      setItems([]);
      setChecked(null);
      setPrivateKept(0);
      setPrefs({ kept: false });
      if (why) setNotice(why);
      log.info('essentials.wiped', { why: why ?? 'signed_out_quietly' });
    },
    [d, setPrefs],
  );

  // The vault ended the session: its reason decides. Signing out: all of it.
  useEffect(() => {
    const offEnded = on('sessionEnded', (reason) => {
      if (endWipes(reason)) void wipe('signed_out');
    });
    const offOut = on('signedOut', () => {
      void wipe(null);
      setPrefs({ enrolled: false, offered: false });
    });
    return () => {
      offEnded();
      offOut();
    };
  }, [wipe, setPrefs]);

  // Open while the lock is open (its key is in memory then); closed when it closes.
  useEffect(() => {
    let cancelled = false;
    const hex = lock.everydayKey;
    if (lock.status !== 'unlocked' || !hex || !prefs.enrolled) {
      const s = storeRef.current;
      storeRef.current = null;
      setStore(null);
      void s?.close().catch(() => undefined);
      return;
    }
    void (async () => {
      try {
        const s = await d.io.open('everyday', hex);
        if (cancelled) {
          await s.close();
          return;
        }
        // Somebody else's copies: gone before anything is shown.
        const owner = who ? ownerKey(who.origin, who.member_id) : null;
        const before = await s.state(OWNER_KEY);
        if (owner && before && before !== owner) {
          await s.close();
          await wipe(null);
          return;
        }
        if (owner) await s.setState(OWNER_KEY, owner);
        // Unchecked too long: removed at this unlock.
        const last = await lastChecked(s);
        if (last && ageOf(last, d.now()).expired) {
          await s.close();
          await wipe('removed_age');
          return;
        }
        storeRef.current = s;
        setStore(s);
        await refresh(s);
      } catch (err) {
        log.error('essentials.open_failed', { err: String(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
    // The key appears a moment after the status: both are watched.
  }, [lock.status, lock.everydayKey, prefs.enrolled, who, d, refresh, wipe]);

  const fetchPage = useCallback(
    async (versionId: string, n: number): Promise<PageFetch> => {
      try {
        const res = await withToken((a, token) => a.offlinePage(token, versionId, n));
        return new Uint8Array(await res.arrayBuffer());
      } catch (err) {
        if (err instanceof ApiRequestError && err.code === 'preview_pending') return 'pending';
        if (err instanceof ApiRequestError && (err.code === 'no_preview' || err.status === 404)) return 'none';
        throw err;
      }
    },
    [withToken],
  );

  /** One sync at a time; the private copies only when their store is handed in. */
  const run = useCallback(
    (privateStore: EssentialsStore | null = null): Promise<void> => {
      const s = storeRef.current;
      if (!s || offline) return Promise.resolve();
      if (busy.current) return busy.current;
      setSyncing(true);
      busy.current = (async () => {
        try {
          const result = await syncEssentials({
            fetchSet: () => withToken((a, token) => a.offlineEssentials(token)),
            fetchPage,
            everyday: s,
            private: privateStore,
            now: d.now,
          });
          setGrant(result.grant);
          if (privateStore) setPrivateKept((await privateStore.documents()).length);
          await refresh(s);
          setPrefs({ kept: true });
          await sendOpens(s, (events) => withToken((a, token) => a.offlineOpens(token, events)));
        } catch (err) {
          // No connection changes nothing; a full phone says so.
          if (/full|space/i.test(String((err as Error)?.message ?? err))) setNotice('short_of_space');
          else if (!(err instanceof NetworkError)) log.warn('essentials.sync_failed', { err: String(err) });
        } finally {
          busy.current = null;
          setSyncing(false);
        }
      })();
      return busy.current;
    },
    [offline, withToken, fetchPage, d, refresh, setPrefs],
  );

  // In front only: when the store opens (after unlocking), when the app
  // comes back, and when the connection does.
  useEffect(() => {
    if (store) void run();
  }, [store, run]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void run();
    });
    return () => sub.remove();
  }, [run]);

  const enrol = useCallback(
    async (password: string, includePrivate: boolean): Promise<EnrolOutcome> => {
      try {
        const g = await withToken((a, token) => a.offlineGrant(token, password, includePrivate));
        setGrant(g);
        setPrefs({ enrolled: true, offered: true });
      } catch (err) {
        if (err instanceof ApiRequestError && err.code === 'invalid_credentials') return 'wrong_password';
        if (err instanceof NetworkError) return 'offline';
        return 'failed';
      }
      if (!includePrivate) return 'ok';
      // The Only me copies: their own store, opened with the person's biometrics.
      const copies = await lock.away(() => openPrivateCopies(lock.keys, t('lock.privatePrompt'), d.io));
      if (copies.kind === 'ok') {
        await run(copies.store);
        await copies.store.close();
      }
      return 'ok';
    },
    [withToken, setPrefs, lock, t, d, run],
  );

  const open = useCallback(
    async (id: string, mode: 'view' | 'show'): Promise<OpenCopy | null> => {
      const s = storeRef.current;
      if (!s) return null;
      const doc = await s.document(id);
      if (!doc) return null;
      await s.recordOpen({
        id: d.uuid(),
        document_id: doc.id,
        version_id: doc.version_id,
        at: d.now(),
        mode,
        online: !offline,
      });
      return {
        document: JSON.parse(doc.view) as DocumentView,
        versionId: doc.version_id,
        pages: doc.pages,
        page: async (n) => {
          const bytes = await s.page(doc.version_id, n);
          return bytes ? jpegDataUri(bytes) : null;
        },
      };
    },
    [d, offline],
  );

  const age = useMemo(() => (checked ? ageOf(checked, d.now()) : null), [checked, d]);
  const renewDue = grant !== null && Date.parse(grant.expires_at) - d.now() <= RENEW_WITHIN;

  const value = useMemo<EssentialsValue>(
    () => ({
      available,
      prefs,
      items,
      privateInSet,
      privateKept,
      checked,
      age,
      grant,
      renewDue,
      syncing,
      notice,
      enrol,
      sync: () => run(),
      open,
      offered: () => setPrefs({ offered: true }),
      dismissNotice: () => setNotice(null),
    }),
    [available, prefs, items, privateInSet, privateKept, checked, age, grant, renewDue, syncing, notice, enrol, run, open, setPrefs],
  );
  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>;
}

const NONE: EssentialsValue = {
  available: false,
  prefs: { enrolled: false, offered: true, kept: false },
  items: [],
  privateInSet: 0,
  privateKept: 0,
  checked: null,
  age: null,
  grant: null,
  renewDue: false,
  syncing: false,
  notice: null,
  enrol: async () => 'failed',
  sync: async () => undefined,
  open: async () => null,
  offered: () => undefined,
  dismissNotice: () => undefined,
};

/** Outside an EssentialsProvider (some tests): nothing kept. */
export function useEssentials(): EssentialsValue {
  return useContext(Ctx) ?? NONE;
}
