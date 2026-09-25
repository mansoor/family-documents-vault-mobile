import { can, type CaptureMetadata } from '@fdv/shared';
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
  /** The reminders it will get, when it has the date they come from. */
  reminder: string | null;
  /** A kind that expires, saved without its expiry date: no reminders yet. */
  noExpiry: boolean;
}

interface CaptureValue {
  scanner: ScannerPort;
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
  const { who, withToken, uploadApi, api, sessionOwner } = useVault();
  const [store, setStore] = useState<QueueStore | null>(null);
  const [openTry, setOpenTry] = useState(0);
  const [pending, setPending] = useState<CaptureSource | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
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
  const current = useRef({ who, withToken, uploadApi, api, sessionOwner });
  useEffect(() => {
    current.current = { who, withToken, uploadApi, api, sessionOwner };
  }, [who, withToken, uploadApi, api, sessionOwner]);

  const refresh = useCallback(async () => {
    if (!store) return;
    const w = current.current.who;
    const all = await store.list();
    setQueue(w ? all.filter((i) => i.origin === w.origin && i.account === w.member_id) : []);
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
        asOwner(item, (token) => {
          const up = current.current.uploadApi;
          if (!up) throw new NotThisAccountError();
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
  }, [whoKey, uploader, refresh]);

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
      return await open();
    } catch {
      return { kind: 'cancelled' };
    } finally {
      sub?.remove();
      busyScanning.current = false;
    }
  }, []);

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

  const value = useMemo<CaptureValue>(
    () => ({
      scanner: deps.scanner,
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
    [deps, pending, start, morePages, save, throwAway, queue, delivered, saved, remove, timings],
  );
  return <CaptureContext.Provider value={value}>{props.children}</CaptureContext.Provider>;
}
