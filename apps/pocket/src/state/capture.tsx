import { multipartBody } from '@fdv/client';
import { can, type CaptureMetadata, type DocumentTypeView, type Member } from '@fdv/shared';
import { randomUUID } from 'expo-crypto';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { defaultScanner, type ScannerPort, type ScanOutcome } from '../capture/scanner';
import { TimingRecorder } from '../capture/timings';
import { log } from '../log';
import { onNetworkChange } from '../net/network';
import { discard as discardFile, readBytes } from '../platform/files';
import {
  commitCapture,
  CommitError,
  MAX_PAGES,
  sourceFiles,
  type CaptureSource,
  type CommitProblem,
  type PageRef,
} from '../queue/commit';
import type { QueueItem } from '../queue/item';
import { openQueue } from '../queue/open';
import type { QueueStore } from '../queue/store';
import { NotThisAccountError, Uploader } from '../queue/uploader';
import { useLock } from './lock';
import { useVault } from './vault';

/**
 * Capturing a document, from the tap to the vault's 201: what the scanner
 * brought (waiting on the card), the encrypted queue it goes into at Save
 * or Skip, and the uploader that sends it — which starts only then, never
 * while the card is open, only while the app is in front, and only ever
 * as the person who made the capture.
 */

export interface CaptureDeps {
  scanner: ScannerPort;
  openStore: () => Promise<QueueStore>;
  read: (uri: string) => Promise<Uint8Array>;
  discard: (uri: string) => Promise<void>;
  uuid: () => string;
  now: () => number;
  /** Runs `fn` after `ms`; returns a cancel. */
  schedule?: (ms: number, fn: () => void) => () => void;
}

export type StartOutcome = 'card' | 'cancelled' | 'failed';
/** Why a Save did not happen: the scan's own problem, the phone's queue, or not allowed to add. */
export type SaveProblem = CommitProblem | 'queue_unavailable' | 'not_allowed';
export type SaveOutcome = { kind: 'saved' } | { kind: 'refused'; problem: SaveProblem };

/** The line Home shows once a capture is safely in the queue. */
export interface SavedNote {
  /** Skipped, or saved without saying what it is: it needs a name. */
  unnamed: boolean;
  /** Saved with no connection to the vault: it goes when there is one. */
  offline?: boolean;
  /** A new version of a document already in the vault. */
  renewal?: boolean;
  /** The reminders it will get, when it has the date they come from. */
  reminder: string | null;
  /** A kind that expires, saved without its expiry date: no reminders yet. */
  noExpiry: boolean;
}

/** What the card offers, as last seen from the vault: kept so it works offline. */
export interface CardData {
  types: DocumentTypeView[];
  members: Member[];
  /** The type of each document the phone could see, for ranking the chips. */
  filed: (string | null)[];
}

interface CaptureValue {
  scanner: ScannerPort;
  /** The card's choices from the last time the vault was reached; null if never. */
  cardData: () => Promise<CardData | null>;
  /** This start's card is kept on the phone: a scan made offline from now on can be filed. */
  cardKept: boolean;
  /** "Scan the new one": a new version of a document, straight into the queue. */
  renew: (documentId: string) => Promise<StartOutcome | 'saved' | SaveProblem>;
  /** A Needs-you item, put right (another person, no person) and sent again. */
  retry: (id: string, metadata: CaptureMetadata) => Promise<void>;
  /** This vault's captures made by someone else who used this phone. */
  others: QueueItem[];
  /** Captures waiting on this phone for this vault: this account's, or anyone's when signed out. */
  waitingHere: number;
  removeMany: (ids: string[]) => Promise<void>;
  pending: CaptureSource | null;
  start: (how: 'scan' | 'file' | 'photo') => Promise<StartOutcome>;
  /** Add page, or Retake: more pages from the scanner, at most `max`. */
  morePages: (max: number) => Promise<PageRef[] | null>;
  /** The card can be used: its choices have loaded. */
  cardShown: () => void;
  save: (
    source: CaptureSource,
    metadata: CaptureMetadata | null,
    note: Omit<SavedNote, 'unnamed'>,
  ) => Promise<SaveOutcome>;
  throwAway: (source: CaptureSource) => Promise<void>;
  discard: (uri: string) => Promise<void>;
  /** This account's captures not yet in the vault. */
  queue: QueueItem[];
  /** Bumped each time the vault takes one, so lists can load again. */
  delivered: number;
  saved: SavedNote | null;
  dismissSaved: () => void;
  remove: (id: string) => Promise<void>;
  timings: TimingRecorder;
}

const CaptureContext = createContext<CaptureValue | null>(null);

export const useCapture = (): CaptureValue => {
  const v = useContext(CaptureContext);
  if (!v) throw new Error('useCapture outside CaptureProvider');
  return v;
};

const defaultDeps = (): CaptureDeps => ({
  scanner: defaultScanner(),
  openStore: openQueue,
  read: readBytes,
  discard: discardFile,
  uuid: randomUUID,
  now: () => Date.now(),
});

/** In front, or not yet known to be anywhere else (AppState says 'unknown' until its first event). */
const inFront = () => AppState.currentState !== 'background' && AppState.currentState !== 'inactive';

export function CaptureProvider(props: { children: ReactNode; deps?: Partial<CaptureDeps> }) {
  const deps = useMemo<CaptureDeps>(() => ({ ...defaultDeps(), ...props.deps }), [props.deps]);
  const { who, withToken, uploadApi, api, sessionOwner, vault, offline } = useVault();
  // Leaving for the scanner or a picker is not leaving the app: it does not lock.
  const lock = useLock();
  const origin = vault?.origin ?? null;
  const [store, setStore] = useState<QueueStore | null>(null);
  const [openTry, setOpenTry] = useState(0);
  const [pending, setPending] = useState<CaptureSource | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [others, setOthers] = useState<QueueItem[]>([]);
  const [waitingHere, setWaitingHere] = useState(0);
  const [delivered, setDelivered] = useState(0);
  const [saved, setSaved] = useState<SavedNote | null>(null);
  const timings = useMemo(() => new TimingRecorder(deps.now), [deps.now]);
  const storeRef = useRef<QueueStore | null>(null);

  useEffect(() => {
    let cancelled = false;
    deps
      .openStore()
      .then((s) => {
        storeRef.current = s;
        if (!cancelled) setStore(s);
      })
      .catch(() => log.error('queue.open_failed', {}));
    return () => {
      cancelled = true;
    };
  }, [deps, openTry]);

  // A queue that would not open is tried again when the app comes back to the front.
  useEffect(() => {
    if (store) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setOpenTry((n) => n + 1);
    });
    return () => sub.remove();
  }, [store]);

  // The uploader reads who is signed in, and how to reach the vault, when
  // it runs — through a ref, so one uploader lives as long as the store.
  const current = useRef({ who, withToken, uploadApi, api, sessionOwner, origin, offline });
  useEffect(() => {
    current.current = { who, withToken, uploadApi, api, sessionOwner, origin, offline };
  }, [who, withToken, uploadApi, api, sessionOwner, origin, offline]);

  /** The capture the Saved line is about. */
  const savedItem = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!store) return;
    const w = current.current.who;
    const here = current.current.origin;
    const all = (await store.list()).filter((i) => i.origin === here);
    const mine = w ? all.filter((i) => i.account === w.member_id) : [];
    setQueue(mine);
    // The Saved line goes by what happened, not by a guess made before
    // anything was sent: once the capture's first try found no connection,
    // it says it is saved on this phone.
    const just = mine.find((i) => i.id === savedItem.current);
    if (just?.lastCode === 'offline') setSaved((n) => (n && !n.offline ? { ...n, offline: true } : n));
    setOthers(w ? all.filter((i) => i.account !== w.member_id) : []);
    // Signed out, every scan waiting for this vault counts: they go when their person signs in.
    setWaitingHere(w ? mine.length : all.length);
  }, [store]);

  const uploader = useMemo(() => {
    if (!store) return null;
    // As the item's own person, or not at all: checked against the session
    // itself the moment the token is in hand.
    const asOwner = <T,>(item: QueueItem, fn: (token: string) => Promise<T>) =>
      current.current.withToken((_a, token) => {
        const owner = current.current.sessionOwner();
        if (!owner || owner.origin !== item.origin || owner.member_id !== item.account) throw new NotThisAccountError();
        return fn(token);
      });
    // The uploader reads the ref when it sends, not while rendering; the
    // compiler cannot see that from here.
    // eslint-disable-next-line react-hooks/refs
    const u = new Uploader({
      store,
      send: (item, bytes) =>
        asOwner(item, async (token) => {
          const up = current.current.uploadApi;
          if (!up) throw new NotThisAccountError();
          if (item.kind === 'version' && item.target) {
            // A renewal: the new version of a document already there.
            const body = multipartBody([{ name: 'file', filename: item.filename, contentType: item.mime, bytes }]);
            const v = await up.upload(token, item.target, { kind: 'bytes', ...body }, item.key);
            return { document_id: v.document_id, version_id: v.id, job_id: null, state: 'stored' };
          }
          return up.capture(
            token,
            {
              file: {
                kind: 'bytes',
                filename: item.filename,
                contentType: item.mime,
                bytes,
              },
              ...(item.metadata ? { metadata: item.metadata } : {}),
            },
            item.key,
          );
        }),
      status: (item) =>
        asOwner(item, (token) => {
          const a = current.current.api;
          if (!a) throw new NotThisAccountError();
          return a.uploadStatus(token, item.key);
        }),
      who: () => {
        const w = current.current.who;
        return w ? { origin: w.origin, account: w.member_id } : null;
      },
      now: deps.now,
      ...(deps.schedule ? { schedule: deps.schedule } : {}),
      onEvent: (e) => {
        if (e.kind === 'sent') {
          timings.created(e.item.id);
          setDelivered((n) => n + 1);
        }
        void refresh();
      },
    });
    if (!inFront()) u.stop();
    return u;
  }, [store, deps.now, deps.schedule, timings, refresh]);

  // Signed in (again), or somebody else: their queue, and a look at it now.
  // What was saved or scanned for the one before is not theirs.
  const whoKey = who ? `${who.origin}|${who.member_id}` : null;
  const pendingFor = useRef<string | null>(null);
  useEffect(() => {
    // Only when the account changes: the Saved line was the last person's.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSaved(null);
    setPending((p) => {
      if (p && pendingFor.current !== whoKey) {
        for (const uri of sourceFiles(p)) void deps.discard(uri);
        timings.cancel();
        return null;
      }
      return p;
    });
  }, [whoKey, deps, timings]);
  useEffect(() => {
    // Loading the queue for whoever is signed in: set after the store answers.
    void refresh();
    if (whoKey && inFront()) void uploader?.kick({ fresh: true });
  }, [whoKey, origin, uploader, refresh]);

  // The card's choices, fetched on every start that reaches the vault and
  // kept, so a scan made with no connection can still be filed properly.
  // One fetch at a time: a card opened while the start's fetch is still on
  // its way waits for it rather than racing it (and, offline, finding the
  // cache not yet written). What came back is held in memory too, and
  // written to the queue store as soon as the store is open.
  const cardKey = whoKey ? `card|${whoKey}` : null;
  const cardFetch = useRef<{ key: string; promise: Promise<CardData | null> } | null>(null);
  const cardFresh = useRef<{ key: string; data: CardData } | null>(null);
  const [cardKept, setCardKept] = useState<string | null>(null);
  const keepCard = useCallback(async (key: string, data: CardData) => {
    const s = storeRef.current;
    if (!s) return;
    await s.cache(key, data);
    setCardKept(key);
  }, []);
  const loadCard = useCallback((): Promise<CardData | null> => {
    if (!cardKey) return Promise.resolve(null);
    const running = cardFetch.current;
    if (running && running.key === cardKey) return running.promise;
    const key = cardKey;
    const entry = { key, promise: Promise.resolve<CardData | null>(null) };
    entry.promise = (async (): Promise<CardData | null> => {
      try {
        const fresh = await current.current.withToken(async (a, token) => {
          const [types, members, docs] = await Promise.all([
            a.documentTypes(token),
            a.members(token),
            a.documents(token, { limit: 100 }),
          ]);
          return { types: types.items, members: members.items, filed: docs.items.map((d) => d.type_key) };
        });
        cardFresh.current = { key, data: fresh };
        await keepCard(key, fresh).catch(() => undefined);
        return fresh;
      } catch {
        const held = cardFresh.current;
        if (held && held.key === key) return held.data;
        return (await storeRef.current?.cached<CardData>(key)) ?? null;
      } finally {
        if (cardFetch.current === entry) cardFetch.current = null;
      }
    })();
    cardFetch.current = entry;
    return entry.promise;
  }, [cardKey, keepCard]);
  // Fetched as soon as somebody is signed in, whether or not the store is open yet…
  useEffect(() => {
    if (cardKey) void loadCard();
  }, [cardKey, loadCard]);
  // …and kept once it is.
  useEffect(() => {
    const held = cardFresh.current;
    if (store && held && held.key === cardKey && cardKept !== cardKey) void keepCard(held.key, held.data).catch(() => undefined);
  }, [store, cardKey, cardKept, keepCard]);

  // Foreground only: sending stops in the background and starts again in
  // front; a network change is worth a look only while in front.
  useEffect(() => {
    if (!uploader) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void uploader.resume();
      else uploader.stop();
    });
    const off = onNetworkChange(() => {
      if (inFront()) void uploader.kick({ fresh: true });
    });
    return () => {
      sub.remove();
      off();
      uploader.stop();
    };
  }, [uploader]);

  // Read from this render, not the ref: a tap can come before the ref's effect has run.
  const allowed = useCallback(() => who !== null && can(who.role, 'document.add'), [who]);

  // One scanner or picker at a time: a second tap while it opens is nothing.
  const busyScanning = useRef(false);
  const run = useCallback(async (open: () => Promise<ScanOutcome>, onOpened?: () => void): Promise<ScanOutcome> => {
    if (busyScanning.current) return { kind: 'cancelled' };
    busyScanning.current = true;
    // The scanner and the pickers are screens of their own: the app leaves the front when they open.
    const sub = onOpened
      ? AppState.addEventListener('change', (state) => {
          if (state !== 'active') onOpened();
        })
      : null;
    try {
      return await lock.away(open);
    } catch {
      return { kind: 'cancelled' };
    } finally {
      sub?.remove();
      busyScanning.current = false;
    }
  }, [lock]);

  const start = useCallback(
    async (how: 'scan' | 'file' | 'photo'): Promise<StartOutcome> => {
      if (!allowed() || busyScanning.current) return 'cancelled';
      timings.start(how);
      const scanner = deps.scanner;
      const outcome = await run(
        () => (how === 'scan' ? scanner.scan(MAX_PAGES) : how === 'file' ? scanner.pickFile() : scanner.pickPhoto()),
        () => timings.mark('scanner_shown'),
      );
      if (outcome.kind === 'pages' || outcome.kind === 'file') {
        // A capture left on an earlier card, never saved or thrown away: its files go.
        setPending((p) => {
          if (p) for (const uri of sourceFiles(p)) void deps.discard(uri);
          return outcome.kind === 'pages'
            ? { kind: 'pages', pages: outcome.pages }
            : { kind: 'file', file: outcome.file };
        });
        pendingFor.current = whoKey;
        timings.mark('pages_accepted', outcome.kind === 'pages' ? outcome.pages.length : 1);
        return 'card';
      }
      timings.cancel();
      return outcome.kind;
    },
    [allowed, deps, run, timings, whoKey],
  );

  const morePages = useCallback(
    async (max: number): Promise<PageRef[] | null> => {
      const outcome = await run(() => deps.scanner.scan(max));
      return outcome.kind === 'pages' ? outcome.pages.slice(0, max) : null;
    },
    [deps.scanner, run],
  );

  // One Save at a time: a second one for the same scan waits for the first.
  const saving = useRef<Promise<SaveOutcome> | null>(null);
  const save = useCallback(
    (
      source: CaptureSource,
      metadata: CaptureMetadata | null,
      note: Omit<SavedNote, 'unnamed'>,
    ): Promise<SaveOutcome> => {
      if (saving.current) return saving.current;
      const run = (async (): Promise<SaveOutcome> => {
        const w = who;
        if (!w || !can(w.role, 'document.add')) return { kind: 'refused', problem: 'not_allowed' };
        let s = storeRef.current;
        if (!s) {
          // The queue would not open before; one more try, now.
          try {
            s = await deps.openStore();
            storeRef.current = s;
            setStore(s);
          } catch {
            return { kind: 'refused', problem: 'queue_unavailable' };
          }
        }
        timings.mark('save');
        try {
          const item = await commitCapture(
            { source, metadata, origin: w.origin, account: w.member_id },
            {
              store: s,
              read: deps.read,
              discard: deps.discard,
              uuid: deps.uuid,
              now: deps.now,
            },
          );
          timings.queued(item.id);
          savedItem.current = item.id;
        } catch (err) {
          if (err instanceof CommitError) return { kind: 'refused', problem: err.problem };
          throw err;
        }
        setPending(null);
        const unnamed = metadata === null || !metadata.type_key;
        setSaved({
          unnamed,
          reminder: unnamed ? null : note.reminder,
          noExpiry: unnamed ? false : note.noExpiry,
          offline: current.current.offline,
        });
        await refresh();
        void uploader?.kick();
        return { kind: 'saved' };
      })();
      saving.current = run;
      void run.finally(() => {
        saving.current = null;
      });
      return run;
    },
    [who, deps, timings, refresh, uploader],
  );

  const throwAway = useCallback(
    async (source: CaptureSource) => {
      // A Save already under way wins: the scan is kept, not half thrown away.
      if (saving.current && (await saving.current).kind === 'saved') return;
      timings.cancel();
      setPending(null);
      await Promise.all(sourceFiles(source).map((uri) => deps.discard(uri)));
    },
    [deps, timings],
  );

  const remove = useCallback(
    async (id: string) => {
      await store?.remove(id);
      await refresh();
    },
    [store, refresh],
  );

  const removeMany = useCallback(
    async (ids: string[]) => {
      for (const id of ids) await store?.remove(id);
      await refresh();
    },
    [store, refresh],
  );

  // Put right and sent again, under the same key: the vault kept nothing of
  // a refused try. The visibility is the card's, never less private.
  const retry = useCallback(
    async (id: string, metadata: CaptureMetadata) => {
      await store?.update(id, { metadata, state: 'waiting', problem: null, attempts: 0, nextAt: 0, lastCode: null });
      await refresh();
      if (inFront()) void uploader?.kick();
    },
    [store, refresh, uploader],
  );

  // "Scan the new one": a renewal needs no card — it is the same document,
  // newer — so the pages go straight into the queue as its next version.
  const renew = useCallback(
    async (documentId: string): Promise<StartOutcome | 'saved' | SaveProblem> => {
      if (!allowed() || busyScanning.current || !who) return 'cancelled';
      const scanner = deps.scanner;
      const outcome = await run(() => (scanner.scans ? scanner.scan(MAX_PAGES) : scanner.pickFile()));
      if (outcome.kind !== 'pages' && outcome.kind !== 'file') return outcome.kind;
      const source: CaptureSource =
        outcome.kind === 'pages' ? { kind: 'pages', pages: outcome.pages } : { kind: 'file', file: outcome.file };
      // There is no card to go back to: a scan that cannot be kept is
      // deleted here, with the reason, never left in the cache.
      const drop = async () => {
        await Promise.all(sourceFiles(source).map((uri) => deps.discard(uri)));
      };
      const s = storeRef.current;
      if (!s) {
        await drop();
        return 'queue_unavailable';
      }
      try {
        const item = await commitCapture(
          { source, metadata: null, origin: who.origin, account: who.member_id, renews: documentId },
          { store: s, read: deps.read, discard: deps.discard, uuid: deps.uuid, now: deps.now },
        );
        savedItem.current = item.id;
      } catch (err) {
        await drop();
        return err instanceof CommitError ? err.problem : 'unreadable';
      }
      setSaved({ unnamed: false, reminder: null, noExpiry: false, renewal: true, offline: current.current.offline });
      await refresh();
      if (inFront()) void uploader?.kick();
      return 'saved';
    },
    [allowed, who, deps, run, refresh, uploader],
  );

  const value = useMemo<CaptureValue>(
    () => ({
      scanner: deps.scanner,
      cardData: loadCard,
      cardKept: cardKept !== null && cardKept === cardKey,
      renew,
      retry,
      others,
      waitingHere,
      removeMany,
      pending,
      start,
      morePages,
      cardShown: () => timings.mark('card_shown'),
      save,
      throwAway,
      discard: deps.discard,
      queue,
      delivered,
      saved,
      dismissSaved: () => setSaved(null),
      remove,
      timings,
    }),
    [
      deps,
      loadCard,
      cardKept,
      cardKey,
      renew,
      retry,
      others,
      waitingHere,
      removeMany,
      pending,
      start,
      morePages,
      save,
      throwAway,
      queue,
      delivered,
      saved,
      remove,
      timings,
    ],
  );
  return <CaptureContext.Provider value={value}>{props.children}</CaptureContext.Provider>;
}
