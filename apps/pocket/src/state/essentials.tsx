import { ApiRequestError, NetworkError } from '@fdv/client';
import {
  deriveStatus,
  localToday,
  type DocumentView,
  type OfflineGrant,
  type Status,
  type StatusInput,
} from '@fdv/shared';
import { randomUUID } from 'expo-crypto';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState } from 'react-native';
import { jpegDataUri } from '../essentials/base64';
import { openPrivateCopies, type CopiesIo } from '../essentials/copies';
import { deleteEssentials, openEssentials, type Tier } from '../essentials/open';
import { sendOpens } from '../essentials/opens';
import type { EssentialsStore, OfflineDocument } from '../essentials/store';
import {
  ageOf,
  lastChecked,
  PAGES_PENDING,
  PRIVATE_COUNT_KEY,
  PRIVATE_KEPT_KEY,
  privateKept as keptPrivate,
  syncEssentials,
  type Age,
  type Checked,
  type PageFetch,
} from '../essentials/sync';
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
  /** The vault was still drawing its pages when the phone last synced. */
  pending: boolean;
  /** Its status today, worked out on the phone: the vault's may be days old. */
  status: Status | null;
  /** A page as a data URI, from memory; null when it is not kept. */
  page(n: number): Promise<string | null>;
}

export type EssentialsNotice = 'removed_age' | 'signed_out' | 'short_of_space' | null;
export type EnrolOutcome = 'ok' | 'wrong_password' | 'offline' | 'failed';
export type PrivateOutcome = 'ok' | 'not_confirmed' | 'unavailable' | 'changed';

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
  /** Copies are kept. */
  kept: boolean;
  /**
   * The session simply expired with copies kept: they stay readable from
   * the sign-in screen (behind the lock) until their maximum age.
   */
  expired: boolean;
  /** The person also chose to keep their Only me Essentials. */
  private: boolean;
  /**
   * Signed in again, and the new session has no grant yet: the vault keeps
   * nothing for such a session, so nothing syncs (and nothing kept is
   * removed) until there is one — across restarts too.
   */
  regrant: boolean;
  /** Whose choice it was (vault and member): nobody else inherits it. */
  owner: string | null;
  /** A removal that failed (a file left behind): tried again at the next start. */
  leftover: boolean;
  /**
   * Why copies went, kept until it is dismissed or somebody signs in: the
   * app may learn of it in one run and be looked at in the next.
   */
  notice: EssentialsNotice;
}

const NO_PREFS: Prefs = {
  enrolled: false,
  offered: false,
  kept: false,
  expired: false,
  private: false,
  regrant: false,
  owner: null,
  leftover: false,
  notice: null,
};

/** Nobody's choice any more: offered afresh to whoever signs in next. */
const NOT_ENROLLED: Partial<Prefs> = { enrolled: false, offered: false, private: false, owner: null };

interface EssentialsValue {
  /** This phone and this vault can keep Essentials at all. */
  available: boolean;
  /** Signed out by expiry, with copies kept: they can be read, not synced. */
  keptWhileSignedOut: boolean;
  prefs: Prefs;
  /** What is kept, and — while the person has opened them — their Only me ones. */
  items: KeptDocument[];
  /** The person's own Only me Essentials, and how many are kept here. */
  privateInSet: number;
  privateKept: number;
  /** The Only me copies are open (the person confirmed it is them). */
  privateOpen: boolean;
  checked: Checked | null;
  age: Age | null;
  grant: OfflineGrant | null;
  /**
   * One password keeps them up to date: the grant lapses within three
   * days, or has lapsed, or this is a new session (signed in again) with
   * none yet.
   */
  renewDue: boolean;
  syncing: boolean;
  notice: EssentialsNotice;
  enrol(password: string, includePrivate: boolean): Promise<EnrolOutcome>;
  /** The grant again, as first chosen: after signing in again, or before it lapses. */
  regrant(password: string): Promise<EnrolOutcome>;
  /** Signed in with this password: a grant still awaited is renewed with it. */
  signedInWith(password: string): Promise<void>;
  /** The person's own Only me Essentials, counted with the vault (0 without a connection). */
  countOwnPrivate(): Promise<number>;
  /** The Only me copies, with the person's fingerprint or face; brought up to date when online. */
  openPrivate(): Promise<PrivateOutcome>;
  sync(): Promise<void>;
  open(id: string, mode: 'view' | 'show'): Promise<OpenCopy | null>;
  offered(): void;
  dismissNotice(): void;
}

const DAY = 86_400_000;
const RENEW_WITHIN = 3 * DAY;
/** The document types, as much as today's status needs: kept with the copies. */
const TYPES_KEY = 'types';
type StatusType = NonNullable<StatusInput['type']>;

function defaultDeps(): EssentialsDeps {
  return {
    io: { open: openEssentials, remove: deleteEssentials },
    now: () => Date.now(),
    uuid: () => randomUUID(),
  };
}

/** What kind of failure, never the storage layer's own words (they can quote a statement). */
function failureKind(err: unknown): string {
  const m = String((err as Error | undefined)?.message ?? err);
  if (/locked|busy/i.test(m)) return 'busy';
  if (/full|space/i.test(m)) return 'full';
  if (/keystore|secure ?store|decrypt|authenticat/i.test(m)) return 'key';
  if (/not a database|corrupt|malformed|i\/o|disk/i.test(m)) return 'file';
  return 'other';
}

function listOf(docs: OfflineDocument[], isPrivate: boolean): KeptDocument[] {
  return docs.map((doc) => ({
    id: doc.id,
    versionId: doc.version_id,
    document: JSON.parse(doc.view) as DocumentView,
    pages: Math.max(0, doc.pages),
    keptAt: doc.kept_at,
    private: isPrivate,
  }));
}

/** Today's status on the phone, from the kept types; the vault's own word when they are not known. */
function statusToday(doc: DocumentView, types: StatusType[]): Status | null {
  const type = types.find((x) => x.key === doc.type_key) ?? null;
  if (doc.type_key && !type) return doc.status ?? null;
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return deriveStatus({ type, owner_member_id: doc.owner_member_id, expires: doc.expires }, localToday(zone));
  } catch {
    return doc.status ?? null;
  }
}

async function typesOf(store: EssentialsStore): Promise<StatusType[]> {
  try {
    const raw = await store.state(TYPES_KEY);
    return raw ? (JSON.parse(raw) as StatusType[]) : [];
  } catch {
    return [];
  }
}

const Ctx = createContext<EssentialsValue | null>(null);

export function EssentialsProvider(props: { children: ReactNode; deps?: Partial<EssentialsDeps> }) {
  const d = useMemo<EssentialsDeps>(() => ({ ...defaultDeps(), ...props.deps }), [props.deps]);
  const { t } = useTranslation();
  const { who, withToken, caps, offline, sessionOwner } = useVault();
  const lock = useLock();
  const [prefs, setPrefsState] = useState<Prefs>(() => ({ ...NO_PREFS, ...readPrefs('essentials', NO_PREFS) }));
  const [store, setStore] = useState<EssentialsStore | null>(null);
  const [everyday, setEveryday] = useState<KeptDocument[]>([]);
  const [privateItems, setPrivateItems] = useState<KeptDocument[]>([]);
  const [privateInSet, setPrivateInSet] = useState(0);
  const [privateKept, setPrivateKept] = useState(0);
  const [privateOpen, setPrivateOpen] = useState(false);
  const [checked, setChecked] = useState<Checked | null>(null);
  const [grant, setGrant] = useState<OfflineGrant | null>(null);
  const [synced, setSynced] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [ready, setReady] = useState(false);
  const [reopen, setReopen] = useState(0);
  const storeRef = useRef<EssentialsStore | null>(null);
  const privateRef = useRef<EssentialsStore | null>(null);
  // An open still under way, and which copies it is for: a wipe starts a
  // new generation, and whatever was opening for the old one is closed.
  const opening = useRef<Promise<EssentialsStore> | null>(null);
  const generation = useRef(0);
  const waiting = useRef<(() => void)[]>([]);
  const busy = useRef<{ promise: Promise<void>; store: EssentialsStore; private: EssentialsStore | null } | null>(null);
  const prefsRef = useRef(prefs);

  // Enrolled means the vault could do it when it was chosen: without a
  // connection (no capabilities yet) the kept copies still show.
  const supported = caps ? caps.features.offline_essentials === true : prefs.enrolled;
  const available = supported && lock.status !== 'none' && lock.level !== null && who?.role !== 'viewer';
  const keptWhileSignedOut = who === null && prefs.enrolled && prefs.kept && prefs.expired;
  // Whose copies may be opened: the person signed in, or — after expiry — the last one.
  const readable = who !== null || keptWhileSignedOut;

  const setPrefs = useCallback((next: Partial<Prefs>) => {
    // The ref first: listeners and callbacks read it before the next render.
    const merged = { ...prefsRef.current, ...next };
    prefsRef.current = merged;
    writePrefs('essentials', merged);
    setPrefsState(merged);
  }, []);

  /** What the everyday store holds, as the list shows it. */
  const refresh = useCallback(async (s: EssentialsStore) => {
    setEveryday(listOf(await s.documents(), false));
    setChecked(await lastChecked(s));
    setPrivateInSet(Number((await s.state(PRIVATE_COUNT_KEY)) ?? 0));
    setPrivateKept((await keptPrivate(s)).length);
  }, []);

  /** Nothing of the copies on screen: the lock closed, or they are gone. */
  const clearLists = useCallback(() => {
    setEveryday([]);
    setPrivateItems([]);
    setChecked(null);
    setPrivateInSet(0);
    setPrivateKept(0);
    setSynced(false);
  }, []);

  const closePrivate = useCallback(() => {
    const p = privateRef.current;
    privateRef.current = null;
    setPrivateOpen(false);
    setPrivateItems([]);
    if (p) void p.close().catch(() => undefined);
  }, []);

  /** Both stores' files removed; one that cannot be is tried again at the next start. */
  const removeFiles = useCallback(async (): Promise<boolean> => {
    let left = false;
    for (const tier of ['everyday', 'private'] as Tier[]) {
      try {
        await d.io.remove(tier);
      } catch (err) {
        left = true;
        log.error('essentials.remove_failed', { tier, kind: failureKind(err) });
      }
    }
    return !left;
  }, [d]);

  /** Every copy gone: the files, and what the screen shows. */
  const wipe = useCallback(
    async (why: EssentialsNotice) => {
      generation.current += 1;
      const s = storeRef.current;
      storeRef.current = null;
      setStore(null);
      const p = privateRef.current;
      privateRef.current = null;
      setPrivateOpen(false);
      // Closed before the files go: an open database is not removed.
      const pending = opening.current;
      opening.current = null;
      await Promise.all([
        s?.close().catch(() => undefined),
        p?.close().catch(() => undefined),
        pending?.then((o) => o.close()).catch(() => undefined),
      ]);
      const gone = await removeFiles();
      clearLists();
      setGrant(null);
      setPrefs({ kept: false, expired: false, regrant: false, leftover: !gone });
      if (why) setPrefs({ notice: why });
      log.info('essentials.wiped', { why: why ?? 'signed_out_quietly' });
    },
    [removeFiles, clearLists, setPrefs],
  );

  // Starting: a removal that failed last time is tried again before anything opens.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (prefsRef.current.leftover && (await removeFiles())) setPrefs({ leftover: false });
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [removeFiles, setPrefs]);

  // The vault ended the session: its reason decides. Signing out: all of
  // it. Somebody else signing in: nothing of the last person's, not even
  // their choice to keep Essentials here.
  useEffect(() => {
    const offEnded = on('sessionEnded', (reason) => {
      const had = prefsRef.current.kept || prefsRef.current.enrolled;
      if (endWipes(reason)) void wipe(had ? 'signed_out' : null);
      else setPrefs({ expired: true });
    });
    const offIn = on('signedIn', () => {
      setPrefs({ expired: false, notice: null });
      const p = prefsRef.current;
      if (!p.enrolled) return;
      const me = sessionOwner();
      const mine = me ? ownerKey(me.origin, me.member_id) : null;
      if (mine === null || p.owner !== mine) {
        void wipe(null);
        setPrefs(NOT_ENROLLED);
        return;
      }
      setPrefs({ regrant: true });
    });
    const offOut = on('signedOut', () => {
      void wipe(null);
      setPrefs(NOT_ENROLLED);
    });
    return () => {
      offEnded();
      offIn();
      offOut();
    };
  }, [wipe, setPrefs, sessionOwner]);

  // The Only me copies close with the lock.
  useEffect(() => {
    if (lock.status !== 'unlocked') return;
    return closePrivate;
  }, [lock.status, closePrivate]);

  // Open while the lock is open (its key is in memory then); closed when it closes.
  useEffect(() => {
    const hex = lock.everydayKey;
    // Nobody signed in (a session just ended, and may have taken the copies
    // with it): nothing is opened — not even an empty store. After expiry,
    // what is kept is opened as it is: nobody new has signed in to check.
    if (!ready || lock.status !== 'unlocked' || !hex || !prefs.enrolled || !readable) return;
    let cancelled = false;
    let opened: EssentialsStore | null = null;
    const gen = generation.current;
    const stale = () => cancelled || generation.current !== gen;
    void (async () => {
      let s: EssentialsStore | null = null;
      try {
        const p = d.io.open('everyday', hex);
        opening.current = p;
        s = await p;
        if (opening.current === p) opening.current = null;
        if (stale()) {
          await s.close().catch(() => undefined);
          return;
        }
        // Somebody else's copies: gone before anything is shown — and
        // keeping Essentials was their choice, not this person's.
        const owner = who ? ownerKey(who.origin, who.member_id) : null;
        const before = await s.state(OWNER_KEY);
        if (owner && before && before !== owner) {
          await s.close();
          await wipe(null);
          setPrefs(NOT_ENROLLED);
          return;
        }
        if (owner) await s.setState(OWNER_KEY, owner);
        // Unchecked too long: removed at this unlock, and an empty store
        // opened in their place, to fill again when the phone is online.
        const last = await lastChecked(s);
        if (last && ageOf(last, d.now()).expired) {
          await s.close();
          await wipe('removed_age');
          setReopen((n) => n + 1);
          return;
        }
        if (stale()) {
          await s.close();
          return;
        }
        opened = s;
        storeRef.current = s;
        setStore(s);
        for (const go of waiting.current.splice(0)) go();
        await refresh(s);
      } catch (err) {
        if (s && !opened) await s.close().catch(() => undefined);
        log.error('essentials.open_failed', { kind: failureKind(err) });
      }
    })();
    // Closed when the lock closes, or when what it was opened with changes.
    return () => {
      cancelled = true;
      if (!opened) return;
      if (storeRef.current === opened) {
        storeRef.current = null;
        setStore(null);
      }
      clearLists();
      closePrivate();
      void opened.close().catch(() => undefined);
    };
    // The key appears a moment after the status: both are watched.
  }, [
    ready,
    reopen,
    lock.status,
    lock.everydayKey,
    prefs.enrolled,
    readable,
    who,
    d,
    refresh,
    wipe,
    setPrefs,
    clearLists,
    closePrivate,
  ]);

  /** The everyday store, once it is open (or soon after): what the Only me copies sync beside. */
  const whenOpen = useCallback(
    () =>
      storeRef.current
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            waiting.current.push(resolve);
            setTimeout(resolve, 10_000);
          }),
    [],
  );

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

  const countOwnPrivate = useCallback(async (): Promise<number> => {
    const me = who?.member_id;
    if (!me) return 0;
    try {
      const page = await withToken((a, token) => a.documents(token, { essential: 'true', limit: 200 }));
      return page.items.filter((doc) => doc.visibility === 'private' && doc.owner_member_id === me).length;
    } catch {
      return 0;
    }
  }, [who, withToken]);

  /**
   * One sync at a time. Asked again while one runs: the same sync; asked
   * for another store, or with the Only me store, it follows the one
   * running. The Only me copies sync whenever their store is open.
   */
  const runRef = useRef<(privateStore?: EssentialsStore | null) => Promise<void>>(async () => undefined);
  const run = useCallback(
    (privateStore: EssentialsStore | null = null): Promise<void> => {
      const s = storeRef.current;
      // Signed out: read, never synced — the vault would not answer. Signed
      // in again: not before the grant, or the vault's answer is "keep nothing".
      if (!s || offline || !who || prefsRef.current.regrant) return Promise.resolve();
      const priv = privateStore ?? privateRef.current;
      const current = busy.current;
      if (current) {
        if (current.store === s && (priv === null || current.private === priv)) return current.promise;
        return current.promise.then(() => runRef.current(priv));
      }
      setSyncing(true);
      const promise = (async () => {
        let problem: unknown = null;
        try {
          const result = await syncEssentials({
            fetchSet: () => withToken((a, token) => a.offlineEssentials(token)),
            fetchPage,
            everyday: s,
            private: priv,
            now: d.now,
            removePrivate: () => d.io.remove('private'),
          });
          problem = result.pageError;
          setGrant(result.grant);
          setSynced(true);
          // For today's status without a connection.
          try {
            const types = await withToken((a, token) => a.documentTypes(token));
            const kept: StatusType[] = types.items.map((x) => ({
              key: x.key,
              expiry_driver: x.expiry_driver,
              reminder_leads: x.reminder_leads,
            }));
            await s.setState(TYPES_KEY, JSON.stringify(kept));
          } catch {
            // The last types kept stay.
          }
          // Not chosen: their own Only me ones are not in the set, so counted.
          if (!result.grant?.include_private) await s.setState(PRIVATE_COUNT_KEY, String(await countOwnPrivate()));
          if (priv) setPrivateItems(listOf(await priv.documents(), true));
          await refresh(s);
          setPrefs({ kept: true });
        } catch (err) {
          problem = err;
        }
        // What was opened is told, whatever happened to the pages.
        for (const kept of priv ? [s, priv] : [s]) {
          await sendOpens(kept, (events) => withToken((a, token) => a.offlineOpens(token, events))).catch(
            () => undefined,
          );
        }
        // No connection changes nothing; a full phone says so.
        if (problem && failureKind(problem) === 'full') setPrefs({ notice: 'short_of_space' });
        else if (problem && !(problem instanceof NetworkError))
          log.warn('essentials.sync_failed', { kind: failureKind(problem) });
      })();
      const entry = { promise, store: s, private: priv };
      busy.current = entry;
      void promise.finally(() => {
        if (busy.current === entry) busy.current = null;
        setSyncing(false);
      });
      return promise;
    },
    [offline, who, withToken, fetchPage, d, refresh, setPrefs, countOwnPrivate],
  );
  useEffect(() => {
    runRef.current = run;
  }, [run]);

  // In front only: when the store opens (after unlocking), when the app
  // comes back, and when the connection does (run changes as `offline` does).
  useEffect(() => {
    if (store && !prefs.regrant) void run();
  }, [store, prefs.regrant, run]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void run();
    });
    return () => sub.remove();
  }, [run]);

  /** The vault's offline grant, for this session. */
  const granted = useCallback(
    async (password: string, includePrivate: boolean): Promise<EnrolOutcome> => {
      try {
        const g = await withToken((a, token) => a.offlineGrant(token, password, includePrivate));
        setGrant(g);
      } catch (err) {
        if (err instanceof ApiRequestError && err.code === 'invalid_credentials') return 'wrong_password';
        if (err instanceof NetworkError) return 'offline';
        return 'failed';
      }
      setPrefs({ regrant: false });
      return 'ok';
    },
    [withToken, setPrefs],
  );

  // As first chosen; the sync follows (and the one that was held, see above).
  const regrant = useCallback(
    async (password: string): Promise<EnrolOutcome> => {
      const outcome = await granted(password, prefsRef.current.private);
      if (outcome === 'ok') void runRef.current();
      return outcome;
    },
    [granted],
  );
  const signedInWith = useCallback(
    async (password: string): Promise<void> => {
      if (prefsRef.current.regrant) await regrant(password);
    },
    [regrant],
  );

  const openPrivate = useCallback(async (): Promise<PrivateOutcome> => {
    if (privateRef.current) return 'ok';
    const copies = await lock.away(() => openPrivateCopies(lock.keys, t('lock.privatePrompt'), d.io));
    if (copies.kind !== 'ok') {
      // A new fingerprint or face: those copies are gone (and fetched again next time).
      if (copies.kind === 'changed') {
        await storeRef.current?.setState(PRIVATE_KEPT_KEY, '[]').catch(() => undefined);
        setPrivateKept(0);
      }
      return copies.kind;
    }
    privateRef.current = copies.store;
    setPrivateOpen(true);
    setPrivateItems(listOf(await copies.store.documents(), true));
    await whenOpen();
    await runRef.current(copies.store);
    return 'ok';
  }, [lock, t, d, whenOpen]);

  const enrol = useCallback(
    async (password: string, includePrivate: boolean): Promise<EnrolOutcome> => {
      const outcome = await granted(password, includePrivate);
      if (outcome !== 'ok') return outcome;
      setPrefs({
        enrolled: true,
        offered: true,
        private: includePrivate,
        owner: who ? ownerKey(who.origin, who.member_id) : null,
      });
      // The Only me copies: their own store, opened with the person's biometrics.
      if (includePrivate) await openPrivate();
      else void runRef.current();
      return 'ok';
    },
    [granted, setPrefs, who, openPrivate],
  );

  const open = useCallback(
    async (id: string, mode: 'view' | 'show'): Promise<OpenCopy | null> => {
      for (const s of [storeRef.current, privateRef.current]) {
        if (!s) continue;
        const doc = await s.document(id);
        if (!doc) continue;
        await s.recordOpen({
          id: d.uuid(),
          document_id: doc.id,
          version_id: doc.version_id,
          at: d.now(),
          mode,
          online: !offline,
        });
        const document = JSON.parse(doc.view) as DocumentView;
        const types = await typesOf(storeRef.current ?? s);
        return {
          document,
          versionId: doc.version_id,
          pages: Math.max(0, doc.pages),
          pending: doc.pages === PAGES_PENDING,
          status: statusToday(document, types),
          page: async (n) => {
            const bytes = await s.page(doc.version_id, n);
            return bytes ? jpegDataUri(bytes) : null;
          },
        };
      }
      return null;
    },
    [d, offline],
  );

  const items = useMemo(() => [...everyday, ...privateItems], [everyday, privateItems]);
  const age = useMemo(() => (checked ? ageOf(checked, d.now()) : null), [checked, d]);
  // Lapsed (or ended by the vault): the set came back with no grant.
  const lapsed = prefs.enrolled && synced && grant === null && who !== null;
  const renewDue =
    prefs.regrant || lapsed || (grant !== null && Date.parse(grant.expires_at) - d.now() <= RENEW_WITHIN);

  const value = useMemo<EssentialsValue>(
    () => ({
      available,
      keptWhileSignedOut,
      prefs,
      items,
      privateInSet,
      privateKept,
      privateOpen,
      checked,
      age,
      grant,
      renewDue,
      syncing,
      notice: prefs.notice,
      enrol,
      regrant,
      signedInWith,
      countOwnPrivate,
      openPrivate,
      sync: () => run(),
      open,
      offered: () => setPrefs({ offered: true }),
      dismissNotice: () => setPrefs({ notice: null }),
    }),
    [
      available,
      keptWhileSignedOut,
      prefs,
      items,
      privateInSet,
      privateKept,
      privateOpen,
      checked,
      age,
      grant,
      renewDue,
      syncing,
      enrol,
      regrant,
      signedInWith,
      countOwnPrivate,
      openPrivate,
      run,
      open,
      setPrefs,
    ],
  );
  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>;
}

const NONE: EssentialsValue = {
  available: false,
  keptWhileSignedOut: false,
  prefs: { ...NO_PREFS, offered: true },
  items: [],
  privateInSet: 0,
  privateKept: 0,
  privateOpen: false,
  checked: null,
  age: null,
  grant: null,
  renewDue: false,
  syncing: false,
  notice: null,
  enrol: async () => 'failed',
  regrant: async () => 'failed',
  signedInWith: async () => undefined,
  countOwnPrivate: async () => 0,
  openPrivate: async () => 'unavailable',
  sync: async () => undefined,
  open: async () => null,
  offered: () => undefined,
  dismissNotice: () => undefined,
};

/** Outside an EssentialsProvider (some tests): nothing kept. */
export function useEssentials(): EssentialsValue {
  return useContext(Ctx) ?? NONE;
}
