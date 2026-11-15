import { ApiRequestError, multipartBody, type Api } from '@fdv/client';
import { can, noteFirstWords, type CaptureMetadata, type DocumentTypeView, type Member } from '@fdv/shared';
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
import i18n from '../i18n';
import { NoBatchesError, sendToInbox, shortDay, type InboxOutcome } from '../queue/inbox';
import { filedWithout as leftOut, type FiledWithout, type QueueItem } from '../queue/item';
import {
  noteBody,
  noteBytes,
  noteItem,
  readNote,
  sameBody,
  type KeyedTry,
  type Landed,
  type NoteBody,
  type NotePayload,
} from '../queue/note';
import {
  ArrivedEarlierError,
  CreatedNotVisibleError,
  idempotentCreate,
  keyLive,
  KeyReusedError,
  MaybeSentError,
  NoAnswerError,
  nextTry,
  NotSentError,
  postNote,
  refusedOutright,
  type Posted,
} from '../queue/note-send';
import { noConnection } from '../net/no-connection';
import { openQueue } from '../queue/open';
import type { QueueStore } from '../queue/store';
import { NotThisAccountError, Uploader } from '../queue/uploader';
import { emit, on } from './events';
import { useLock } from './lock';
import { useVault } from './vault';
import { feel } from '../ui/feel';

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
  /**
   * Sent to the person's Inbox (I5): on its way until the vault has it,
   * then `inboxSent`, said once it is there.
   */
  inbox?: boolean;
  inboxSent?: boolean;
  /** A vault with no batches (rolled back) filed it instead, as Only me (I5-1). */
  inboxFiled?: boolean;
  /** Which item of which batch it is, once in: what the vault read of it is shown under the line (P3). */
  inboxItem?: { batch: string; item: string };
  /** Saved with no connection to the vault: it goes when there is one. */
  offline?: boolean;
  /** A new version of a document already in the vault: which document. */
  renewal?: boolean;
  renews?: string;
  /** The new version is in the vault: its pages are read there, for its details (P2). */
  renewalSent?: boolean;
  /** The reminders it will get, when it has the date they come from. */
  reminder: string | null;
  /** A kind that expires, saved without its expiry date: no reminders yet. */
  noExpiry: boolean;
}

/**
 * A new note written on this phone that the vault doesn't have yet (0.13.0):
 * what it says, and how its sending stands. Only ever its writer's.
 */
export interface QueuedNote {
  id: string;
  /** What it says; null when its bytes can't be read (shown so, to be deleted: never dropped unseen). */
  payload: NotePayload | null;
  state: QueueItem['state'];
  problem: QueueItem['problem'];
  /**
   * Might already be in the vault, and Send again can settle it under its
   * own key (0.13.1): the key within the vault's 24 hours, to a vault that
   * keeps keys. Otherwise Send again makes a new note.
   */
  settles: boolean;
}

/** A note put in the queue, or why not. */
export type NoteOutcome =
  | { kind: 'queued'; id: string; state: 'waiting' | 'unsure' }
  | { kind: 'refused'; problem: 'queue_unavailable' | 'not_allowed' };

/**
 * New note's Save (0.13.0): in the vault, or kept here, waiting or unsure, or
 * refused by the vault — or made, and already somebody else's to keep
 * private (0.13.1, never on a first try in practice): said in Notes.
 */
export type NewNoteOutcome = { kind: 'made'; id: string } | { kind: 'hidden' } | NoteOutcome;

/** A change asked of a queued note: done, or not — gone (sent or deleted), on its way now, or not this person's. */
export type NoteChange = 'done' | 'gone' | 'sending';

/** What the card offers, as last seen from the vault: kept so it works offline. */
export interface CardData {
  /** Each with its own fields and what it requires: a scan's details are checked against them offline. */
  types: DocumentTypeView[];
  members: Member[];
  /** The type of each document the phone could see, for ranking the chips. */
  filed: (string | null)[];
  /**
   * After a start with no connection, whether the vault asked for each
   * type's details (`features.custom_types`) when it last said: the card
   * asks as it did then (0.2.1). Otherwise absent: the vault's word is at hand.
   */
  customTypes?: boolean;
  /** Likewise, whether it had an Inbox for scans (`features.batches`, I5). */
  batches?: boolean;
  /**
   * Likewise, whether its own sensitive papers start as Only me for a teen or
   * a grown-up child (`features.sensitive_protects`, 0.9.0-dev.41, H1a).
   */
  sensitiveProtects?: boolean;
}

interface CaptureValue {
  scanner: ScannerPort;
  /** The card's choices from the last time the vault was reached; null if never. */
  cardData: () => Promise<CardData | null>;
  /** This start's card is kept on the phone: a scan made offline from now on can be filed. */
  cardKept: boolean;
  /** queue.db is open (the e2e build shows it, for a flow that fails). */
  storeOpen: boolean;
  /** "Scan the new one": a new version of a document, straight into the queue. */
  renew: (documentId: string) => Promise<StartOutcome | 'saved' | SaveProblem>;
  /**
   * A Needs-you item sent again: put right (another person, no person), or
   * as it was, after a send the phone itself could not make.
   */
  retry: (id: string, metadata?: CaptureMetadata) => Promise<void>;
  /** This vault's captures made by someone else who used this phone. */
  others: QueueItem[];
  /** Captures waiting on this phone for this vault: this account's, or anyone's when signed out. */
  waitingHere: number;
  removeMany: (ids: string[]) => Promise<void>;
  /**
   * A vault left for good (4.15, Use another vault): every scan waiting for
   * it — anybody's — goes, and what the card kept of it. One already on
   * its way cannot be called back: it is left to arrive. Returns how many.
   */
  forgetVault: (origin: string) => Promise<number>;
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
    /** The card's names for the type's own details it sends, by field key. */
    labels?: Record<string, string>,
    /** "Send to my Inbox" (I5): into the day's batch, with no details, rather than filed. */
    inbox?: boolean,
  ) => Promise<SaveOutcome>;
  throwAway: (source: CaptureSource) => Promise<void>;
  discard: (uri: string) => Promise<void>;
  /** This account's captures not yet in the vault. */
  queue: QueueItem[];
  /**
   * New notes this person wrote here that the vault doesn't have yet
   * (0.13.0), oldest first: in the same encrypted queue as the scans, sent
   * by themselves once the vault answers, and gone from the phone once it
   * has them. Nobody else's, ever.
   */
  notes: QueuedNote[];
  /** Every queued note for this vault, anybody's, in any state: a count only (Change vault says it). */
  notesHere: number;
  /**
   * New note's Save: sent now when the vault answers; else kept here —
   * 'waiting' when it never left, 'unsure' when it went and no answer came.
   * A refusal from the vault is thrown, for New note to say.
   */
  saveNewNote: (payload: NotePayload) => Promise<NewNoteOutcome>;
  /** A new note into the queue, never tried: it goes by itself. */
  writeNote: (payload: NotePayload) => Promise<NoteOutcome>;
  /** A queued note changed before it was sent; its state kept ('unsure' stays unsure). */
  changeNote: (id: string, payload: NotePayload) => Promise<NoteChange>;
  /** A queued note deleted from the phone (asked first, on the screen); never one on its way. */
  removeNote: (id: string) => Promise<NoteChange>;
  /** "Send again": a note that might already be in the vault, sent as a new note, by its person's choice. */
  sendNoteAgain: (id: string) => Promise<NoteChange>;
  /** Not sent while it is open to change, and let go after. */
  holdNote: (id: string) => void;
  releaseNote: (id: string) => void;
  /** Notes sent with less than was asked — as Only me, not Adults only — said once, by their names. */
  notesNarrowed: string[];
  dismissNotesNarrowed: () => void;
  /**
   * Notes that reached the vault and are now kept private by the person they
   * are about (404 created_not_visible, 0.13.1): sent, and said once, by
   * their names.
   */
  notesHidden: string[];
  /** Notes has said them: no longer kept on the phone to say next time. */
  sawNotesHidden: () => void;
  dismissNotesHidden: () => void;
  /** Bumped each time the vault takes one, so lists can load again. */
  delivered: number;
  saved: SavedNote | null;
  dismissSaved: () => void;
  /** Scans the vault took without some of their details, since this person last dismissed them. */
  filedWithout: FiledWithout[];
  dismissFiledWithout: () => void;
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

/** A queue that would not open, as the log says it: busy, the key, the file, or something else. */
function openFailure(err: unknown): string {
  const m = String((err as Error | undefined)?.message ?? err);
  if (/locked|busy/i.test(m)) return 'busy';
  if (/keystore|secure ?store|decrypt|authenticat/i.test(m)) return 'key';
  if (/not a database|corrupt|malformed|i\/o|disk|full/i.test(m)) return 'file';
  return 'other';
}

/** Where the vault's custom_types is kept beside a card's choices (forgotten with them: same prefix). */
const kindsKey = (cardKey: string) => `${cardKey}|kinds`;

/** In front, or not yet known to be anywhere else (AppState says 'unknown' until its first event). */
const inFront = () => AppState.currentState !== 'background' && AppState.currentState !== 'inactive';

/** A note's name, as Notes says it: its title, its first words, or Untitled note. */
const hiddenName = (p: Pick<NotePayload, 'title' | 'notes'> | null): string =>
  p?.title?.trim() || noteFirstWords(p?.notes) || i18n.t('notesList.untitled');

/** Where it is kept, per vault, whether the vault last said it keeps a new note's key: a hint, never a decision. */
const keysKey = (origin: string) => `card|${origin}|idempotent_create`;
/** Where it is kept, per person, which notes reached the vault and are kept private now, until Notes says so. */
const hiddenKey = (origin: string, member: string) => `card|${origin}|${member}|notesHidden`;

/** Why a try waited that was the phone's side, not the vault's: no Retry-After of the vault's to keep. */
const PHONE_SIDE_WAITS: ReadonlySet<string> = new Set(['offline', 'signed_out']);
/** A last-try answer that was the vault's own Retry-After, kept through a change. */
const VAULT_SAID_WHEN = (why: string | null) => why !== null && !PHONE_SIDE_WAITS.has(why);

export function CaptureProvider(props: { children: ReactNode; deps?: Partial<CaptureDeps> }) {
  const deps = useMemo<CaptureDeps>(() => ({ ...defaultDeps(), ...props.deps }), [props.deps]);
  const {
    who,
    withToken,
    withTokenQuick,
    recheck,
    recheckCaps,
    uploadApi,
    api,
    sessionOwner,
    vault,
    offline,
    caps,
    watchedHttp,
  } = useVault();
  // Leaving for the scanner or a picker is not leaving the app: it does not lock.
  const lock = useLock();
  const origin = vault?.origin ?? null;
  const [store, setStore] = useState<QueueStore | null>(null);
  const [openTry, setOpenTry] = useState(0);
  const [pending, setPending] = useState<CaptureSource | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [notes, setNotes] = useState<QueuedNote[]>([]);
  const [notesHere, setNotesHere] = useState(0);
  const notesRef = useRef<QueuedNote[]>([]);
  const [notesNarrowed, setNotesNarrowed] = useState<string[]>([]);
  const [notesHidden, setNotesHidden] = useState<string[]>([]);
  const [others, setOthers] = useState<QueueItem[]>([]);
  const [waitingHere, setWaitingHere] = useState(0);
  const [delivered, setDelivered] = useState(0);
  const [saved, setSaved] = useState<SavedNote | null>(null);
  const [filedWithout, setFiledWithout] = useState<FiledWithout[]>([]);
  const timings = useMemo(() => new TimingRecorder(deps.now), [deps.now]);
  const storeRef = useRef<QueueStore | null>(null);

  // One open at a time: a second, while the first is still opening the
  // same file, would find it busy — and the first one's store would be
  // left where only some of the app could see it.
  const opening = useRef<Promise<QueueStore> | null>(null);
  const [openFailed, setOpenFailed] = useState(false);
  const openOnce = useCallback((): Promise<QueueStore> => {
    if (storeRef.current) return Promise.resolve(storeRef.current);
    if (!opening.current) {
      opening.current = deps
        .openStore()
        .then((s) => {
          storeRef.current = s;
          setStore(s);
          setOpenFailed(false);
          return s;
        })
        .catch((err: unknown) => {
          // What kind of failure, never SQLite's own words (they can quote the statement).
          log.error('queue.open_failed', { kind: openFailure(err) });
          setOpenFailed(true);
          throw err;
        })
        .finally(() => {
          opening.current = null;
        });
    }
    return opening.current;
  }, [deps]);
  useEffect(() => {
    openOnce().catch(() => undefined);
  }, [openOnce, openTry]);

  // A queue that would not open is tried again when the app comes back to
  // the front — only once it has failed, never while it is still opening.
  useEffect(() => {
    if (store || !openFailed) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setOpenTry((n) => n + 1);
    });
    return () => sub.remove();
  }, [store, openFailed]);

  // The uploader reads who is signed in, and how to reach the vault, when
  // it runs — through a ref, so one uploader lives as long as the store.
  const current = useRef({
    who,
    withToken,
    withTokenQuick,
    recheck,
    recheckCaps,
    uploadApi,
    api,
    sessionOwner,
    origin,
    offline,
    caps,
    watchedHttp,
  });
  useEffect(() => {
    current.current = {
      who,
      withToken,
      withTokenQuick,
      recheck,
      recheckCaps,
      uploadApi,
      api,
      sessionOwner,
      origin,
      offline,
      caps,
      watchedHttp,
    };
  }, [
    who,
    withToken,
    withTokenQuick,
    recheck,
    recheckCaps,
    uploadApi,
    api,
    sessionOwner,
    origin,
    offline,
    caps,
    watchedHttp,
  ]);

  /**
   * Whether this vault last said it keeps a new note's key (0.13.1): what it
   * says now, or — before it has said anything since the app started — what
   * it said before, kept on the phone. A hint for what Notes offers; each
   * try still asks the vault itself.
   */
  const keysHint = useRef<{ origin: string; takes: boolean } | null>(null);
  const takesKeys = useCallback((): boolean | null => {
    const c = current.current.caps;
    if (c) return idempotentCreate(c);
    const h = keysHint.current;
    return h && h.origin === current.current.origin ? h.takes : null;
  }, []);
  useEffect(() => {
    if (!store || !origin) return;
    if (caps) {
      const takes = idempotentCreate(caps);
      keysHint.current = { origin, takes };
      void store.cache(keysKey(origin), takes);
      return;
    }
    void store.cached<boolean>(keysKey(origin)).then((takes) => {
      if (typeof takes === 'boolean' && !current.current.caps) keysHint.current = { origin, takes };
    });
  }, [store, origin, caps]);

  /**
   * A note's POST (0.13.0), from the queue or from New note: after the vault
   * answered just now, and telling — with no answer — whether it ever left
   * (queue/note-send.ts). Under its client id where the vault takes one, with
   * the body frozen at its first try (`keyed`, 0.13.1).
   */
  const postNow = useCallback(
    (
      token: string,
      p: NotePayload,
      owner: string,
      key: string,
      prepare?: (keyed: boolean) => Promise<{ body?: NoteBody }>,
    ): Promise<Posted> =>
      postNote(p, {
        http: (watch) => current.current.watchedHttp(watch),
        // What the vault says in this very look decides the key: never a guess from before it answered.
        answers: () => current.current.recheckCaps(),
        token,
        owner,
        key,
        ...(prepare ? { prepare } : {}),
      }),
    [],
  );

  /**
   * One try of a note (0.13.1), from the queue or from New note, as its
   * writer. The vault's answer to this try's own look decides whether it
   * goes under its Idempotency-Key; under it, the body exactly as it first
   * went (frozen with the key in its bytes, before anything goes) — never
   * what it says now — so each try is the same request, and the vault's
   * answer settles whether the first landed.
   *
   * - A note that went once under its key never goes without one: a vault
   *   that says it keeps none now leaves it to its person.
   * - Nothing goes by itself more than 23 hours after the first try.
   * - Changed since, and the vault has it as it went: the change waits for
   *   its person (ArrivedEarlierError), with where the note is when the
   *   vault said (a 201).
   * - "Not yet" (a 5xx, still being made, busy): again under the key when
   *   the vault said, for as long as it keeps the key.
   * - Refused outright on its first try: nothing was made — the note may go
   *   as it is then. Refused on a later try: that says nothing of the
   *   first, so its person decides.
   */
  const sendOne = useCallback(
    async (
      token: string,
      s: QueueStore,
      item: Pick<QueueItem, 'id' | 'account'>,
      p: NotePayload,
      key: string,
    ): Promise<{ id: string | null; hidden: boolean }> => {
      const clock = deps.now;
      const now = clock();
      const first = p.sent;
      const asNow = noteBody(p, item.account);
      const at: { tried: KeyedTry | null; changed: boolean } = { tried: null, changed: false };
      // What the note says, with its key's try and where it landed (or neither): its own try, ending.
      const keep = async (patch: { sent?: KeyedTry | null; landed?: Landed | null }) => {
        const { sent: wasSent, landed: wasLanded, ...words } = p;
        const sent = patch.sent === undefined ? wasSent : (patch.sent ?? undefined);
        const landed = patch.landed === undefined ? wasLanded : (patch.landed ?? undefined);
        const next = noteBytes({ ...words, clientId: key, ...(sent ? { sent } : {}), ...(landed ? { landed } : {}) });
        await s.replaceBytes(item.id, next, { size: next.byteLength }, { evenIfSending: true });
      };
      try {
        const made = await postNow(token, p, item.account, key, async (keyed) => {
          if (!keyed) {
            // Sent once under its key, to a vault that keeps none now: without one it could be made twice.
            if (first) throw new MaybeSentError();
            return {};
          }
          if (first && !keyLive(first, now)) throw new MaybeSentError();
          at.changed = first ? !sameBody(first.body, asNow) : false;
          at.tried = first ?? { body: asNow, firstAt: now, failed: 0, busy: 0 };
          if (!first) await keep({ sent: at.tried });
          return { body: at.tried.body };
        });
        if (!made.keyed || !at.changed) return { id: made.id, hidden: false };
        // In the vault as it first went: the person's change is still theirs to put in, send, or not.
        const landed: Landed = { id: made.id, etag: made.etag, visibility: first?.body.visibility ?? asNow.visibility };
        await keep({ sent: null, landed });
        emit('documentChanged', made.id);
        throw new ArrivedEarlierError(null, landed);
      } catch (err) {
        if (err instanceof ArrivedEarlierError || err instanceof MaybeSentError) throw err;
        if (err instanceof CreatedNotVisibleError) {
          if (at.changed) {
            await keep({ sent: null });
            throw new ArrivedEarlierError('created_not_visible');
          }
          return { id: null, hidden: true };
        }
        if (err instanceof KeyReusedError) {
          // Unchanged, as it first went: those words are there.
          if (first && !at.changed) return { id: null, hidden: false };
          await keep({ sent: null });
          throw new ArrivedEarlierError('idempotency_key_reused');
        }
        const tried = at.tried;
        if (err instanceof NoAnswerError && err.answer && tried) {
          const next = nextTry(tried, err.answer, now);
          await keep({ sent: next.tried });
          if (next.inMs === null) throw new MaybeSentError();
          throw new NoAnswerError(err.answer, next.inMs);
        }
        if (tried && !first && (err instanceof NotSentError || refusedOutright(err))) {
          // This was its first try, and nothing was made by it: the note may go as it is then.
          await keep({ sent: null });
        } else if (first && refusedOutright(err)) {
          // Refused on a later try: that says nothing of the first. Its 23 hours kept, its person decides.
          throw new MaybeSentError();
        }
        throw err;
      }
    },
    [deps, postNow],
  );

  /** The capture the Saved line is about. */
  const savedItem = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!store) return;
    const w = current.current.who;
    const here = current.current.origin;
    const every = (await store.list()).filter((i) => i.origin === here);
    // Notes written offline (0.13.0) are their writer's alone: never in the
    // scans' lists, nor counted for anybody else.
    const all = every.filter((i) => i.kind !== 'note');
    const mine = w ? all.filter((i) => i.account === w.member_id) : [];
    setQueue(mine);
    const written: QueuedNote[] = [];
    for (const i of w ? every.filter((n) => n.kind === 'note' && n.account === w.member_id) : []) {
      const bytes = await store.bytes(i.id);
      const payload = bytes ? readNote(bytes) : null;
      const settles =
        i.state === 'unsure' && !!payload?.sent && keyLive(payload.sent, deps.now()) && takesKeys() !== false;
      written.push({ id: i.id, payload, state: i.state, problem: i.problem, settles });
    }
    notesRef.current = written;
    setNotes(written);
    setNotesHere(every.filter((i) => i.kind === 'note').length);
    // The Saved line goes by what happened, not by a guess made before
    // anything was sent: once the capture's first try found no connection,
    // it says it is saved on this phone.
    const just = mine.find((i) => i.id === savedItem.current);
    if (just?.lastCode === 'offline') setSaved((n) => (n && !n.offline ? { ...n, offline: true } : n));
    setOthers(w ? all.filter((i) => i.account !== w.member_id) : []);
    // Signed out, every scan waiting for this vault counts: they go when their person signs in.
    setWaitingHere(w ? mine.length : all.length);
  }, [store, deps, takesKeys]);

  /**
   * Notes that reached the vault and are kept private now (404
   * created_not_visible): said in Notes, and kept on the phone, encrypted,
   * until Notes has said so — an app closed first says it next time.
   */
  const hiddenRef = useRef<string[]>([]);
  const persistHidden = useCallback((names: string[]) => {
    const s = storeRef.current;
    const w = current.current.who;
    if (s && w) void s.cache(hiddenKey(w.origin, w.member_id), names);
  }, []);
  const addHidden = useCallback(
    (name: string) => {
      const next = [...hiddenRef.current, name];
      hiddenRef.current = next;
      setNotesHidden(next);
      persistHidden(next);
    },
    [persistHidden],
  );

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
    // What became of each Inbox scan the uploader sent, for the Saved line.
    const outcomes = new Map<string, InboxOutcome | 'filed'>();
    // And which batch item each became (P3), for what the vault read of it.
    const inboxItems = new Map<string, { batch: string; item: string }>();
    /**
     * A scan sent to the Inbox (I5): into the day's batch, where the vault
     * has batches. One that has none — rolled back since, as it says now,
     * asked again when GET or POST /batches answers 404 (I5-3) — files it
     * as a document only its person can see (I5-1): never wider than what
     * they chose, an item nobody else sees. A vault that still says it has
     * batches, and has none, is tried again later: never left for a person.
     */
    const toInbox = async (up: Api, token: string, item: QueueItem, bytes: Uint8Array) => {
      let caps = current.current.caps ?? (await up.capabilities());
      if (caps.features.batches === true) {
        try {
          const sent = await sendToInbox(item, bytes, {
            api: up,
            token,
            store,
            now: deps.now,
            name: (at) => i18n.t('inbox.batchName', { date: shortDay(at) }),
          });
          outcomes.set(item.id, sent.outcome);
          if (sent.outcome === 'sent') inboxItems.set(item.id, { batch: sent.batch, item: sent.item });
          return { document_id: null };
        } catch (err) {
          if (!(err instanceof NoBatchesError)) throw err;
          caps = await up.capabilities();
          // The app hears what the vault can do now, too.
          void current.current.recheck();
          if (caps.features.batches === true) {
            throw new ApiRequestError(503, 'unavailable', 'The vault is not taking files into batches just now.', undefined, {
              retriable: true,
            });
          }
        }
      }
      const made = await up.capture(
        token,
        {
          file: { kind: 'bytes', filename: item.filename, contentType: item.mime, bytes },
          metadata: { visibility: 'private', owner_member_id: item.account },
        },
        item.key,
      );
      outcomes.set(item.id, 'filed');
      return made;
    };
    // Notes the vault made and their writer can no longer see (404 created_not_visible): sent, and said.
    const hidden = new Set<string>();
    /**
     * A note written offline (0.13.0): POST /documents, as New note sends it,
     * as its writer and theirs, under its client id (sendOne). Its bytes are
     * what it says; unreadable, the phone's own fault, kept for a person.
     */
    const sendNote = async (token: string, item: QueueItem, bytes: Uint8Array) => {
      const p = readNote(bytes);
      if (!p) throw new Error('A note on this phone could not be read.');
      const out = await sendOne(token, store, item, p, p.clientId ?? item.key);
      if (out.hidden) hidden.add(item.id);
      return { document_id: out.id };
    };
    // The uploader reads the ref when it sends, not while rendering; the
    // compiler cannot see that from here.
    // eslint-disable-next-line react-hooks/refs
    const u = new Uploader({
      store,
      send: (item, bytes) =>
        asOwner(item, async (token) => {
          if (item.kind === 'note') return sendNote(token, item, bytes);
          const up = current.current.uploadApi;
          if (!up) throw new NotThisAccountError();
          if (item.kind === 'inbox') return toInbox(up, token, item, bytes);
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
      // A note for Adults only, refused by its POST (403) from somebody who
      // may no longer choose it — their role no longer sees adults' papers:
      // sent as Only me, narrower, never wider, and said so once it is in.
      // Any other refusal waits for its writer, as they chose it.
      amend: async (item, err) => {
        if (item.kind !== 'note' || err.status !== 403) return false;
        const role = current.current.who?.role;
        if (!role || can(role, 'document.see_adults')) return false;
        const bytes = await store.bytes(item.id);
        const p = bytes ? readNote(bytes) : null;
        if (!p || p.visibility !== 'adults') return false;
        const narrower = noteBytes({ ...p, visibility: 'private' });
        const done = await store.replaceBytes(
          item.id,
          narrower,
          { state: 'waiting', nextAt: 0, size: narrower.byteLength, dropped: [...(item.dropped ?? []), 'visibility'] },
          // Its own try, ending: the uploader may change it.
          { evenIfSending: true },
        );
        return done === 'ok';
      },
      // Cut off while sending: it goes again only if that try went under its
      // key, which its bytes say (sendOne sees to the vault and the 23 hours).
      resumable: async (item) => {
        const bytes = await store.bytes(item.id);
        return !!(bytes && readNote(bytes)?.sent);
      },
      who: () => {
        const w = current.current.who;
        return w ? { origin: w.origin, account: w.member_id } : null;
      },
      now: deps.now,
      ...(deps.schedule ? { schedule: deps.schedule } : {}),
      onEvent: (e) => {
        if (e.kind === 'sent' && e.item.kind === 'note') {
          // In the vault: an ordinary note from now on.
          const sent = e.item;
          const name = notesRef.current.find((n) => n.id === sent.id)?.payload;
          if (e.documentId) emit('documentChanged', e.documentId);
          if (sent.dropped?.includes('visibility') && name) {
            const words = name.title?.trim() || i18n.t('notesList.untitled');
            setNotesNarrowed((l) => [...l, words]);
          }
          // In the vault, and kept private since by the person it's about: said, by its name.
          if (hidden.delete(sent.id)) addHidden(hiddenName(name ?? null));
        } else if (e.kind === 'sent') {
          timings.created(e.item.id);
          setDelivered((n) => n + 1);
          // The Saved line says what became of it (and is said aloud): in the
          // Inbox, filed as Only me by a vault with no batches, or — dealt
          // with on the web already — nothing more to say.
          const outcome = outcomes.get(e.item.id);
          outcomes.delete(e.item.id);
          const inboxItem = inboxItems.get(e.item.id);
          inboxItems.delete(e.item.id);
          if (e.item.kind === 'inbox' && e.item.id === savedItem.current) {
            setSaved((n) =>
              !n?.inbox
                ? n
                : outcome === 'sent'
                  ? { ...n, offline: false, inboxSent: true, ...(inboxItem ? { inboxItem } : {}) }
                  : outcome === 'filed'
                    ? { ...n, offline: false, inboxFiled: true }
                    : null,
            );
          }
          // A new version is in: its details are the version before's until
          // somebody checks what its pages say, on the document's page (P2).
          if (e.item.kind === 'version' && e.item.id === savedItem.current) {
            setSaved((n) => (n?.renewal ? { ...n, offline: false, renewalSent: true } : n));
          }
          // Filed without a detail its kind no longer takes: said, by the detail's name.
          const without = leftOut(e.item);
          if (without) setFiledWithout((l) => [...l, without]);
        }
        void refresh();
      },
    });
    if (!inFront()) u.stop();
    return u;
  }, [store, deps.now, deps.schedule, timings, refresh, sendOne, addHidden]);

  // Signed in (again), or somebody else: their queue, and a look at it now.
  // What was saved or scanned for the one before is not theirs.
  const whoKey = who ? `${who.origin}|${who.member_id}` : null;
  const pendingFor = useRef<string | null>(null);
  useEffect(() => {
    // Only when the account changes: the Saved line was the last person's.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSaved(null);
    setFiledWithout([]);
    setNotesNarrowed([]);
    hiddenRef.current = [];
    setNotesHidden([]);
    setPending((p) => {
      if (p && pendingFor.current !== whoKey) {
        for (const uri of sourceFiles(p)) void deps.discard(uri);
        timings.cancel();
        return null;
      }
      return p;
    });
  }, [whoKey, deps, timings]);
  // Notes said to be kept private now, not yet said in Notes: from the phone, for this person.
  useEffect(() => {
    const w = who;
    if (!store || !w) return;
    void store.cached<string[]>(hiddenKey(w.origin, w.member_id)).then((kept) => {
      if (!Array.isArray(kept) || kept.length === 0 || hiddenRef.current.length > 0) return;
      hiddenRef.current = kept;
      setNotesHidden(kept);
    });
  }, [store, who]);
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
  //
  // Only for somebody who may add documents: the card's choices are the
  // family's kinds and people, and a viewer — a guest from outside the
  // family among them — files nothing, so nothing of the family is fetched
  // or kept for them (5.36).
  const mayFile = who ? can(who.role, 'document.add') : false;
  const cardKey = whoKey && mayFile ? `card|${whoKey}` : null;
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
        // Never waits out a renewal the vault turned away for too many tries
        // (I5-4): what the phone kept answers meanwhile.
        const fresh = await current.current.withTokenQuick(async (a, token) => {
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
        const kept = (await storeRef.current?.cached<CardData>(key)) ?? null;
        // Started with no connection: whether the vault asked for details, as it last said.
        const said =
          kept &&
          (await storeRef.current?.cached<{ customTypes: boolean; batches?: boolean; sensitiveProtects?: boolean }>(
            kindsKey(key),
          ));
        return kept && said
          ? {
              ...kept,
              customTypes: said.customTypes,
              batches: said.batches === true,
              sensitiveProtects: said.sensitiveProtects === true,
            }
          : kept;
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
    if (store && held && held.key === cardKey && cardKept !== cardKey)
      void keepCard(held.key, held.data).catch(() => undefined);
  }, [store, cardKey, cardKept, keepCard]);
  // Whether the vault asks for each type's details (custom_types), kept
  // beside the card's choices each time it says, for a card opened after a
  // start with no connection (0.2.1). And whether it has an Inbox for scans
  // (features.batches, I5): a card opened offline offers Send to my Inbox
  // as the vault last said.
  const customTypes = caps ? caps.features.custom_types === true : null;
  const batches = caps ? caps.features.batches === true : null;
  const sensitiveProtects = caps ? caps.features.sensitive_protects === true : null;
  useEffect(() => {
    if (store && cardKey && customTypes !== null)
      void store
        // Said only where it is on: what an older vault's card kept is as before.
        .cache(kindsKey(cardKey), { customTypes, batches: batches === true, ...(sensitiveProtects ? { sensitiveProtects } : {}) })
        .catch(() => undefined);
  }, [store, cardKey, customTypes, batches, sensitiveProtects]);

  // A session the vault ended because the person is gone from it — their
  // access ended (a guest's), they were taken out, or it was revoked — takes
  // what the phone kept for their card with it (5.36). Whose is the one
  // signed in until then; with nobody signed in (a sign-in refused), nobody's.
  const lastCard = useRef<string | null>(null);
  useEffect(() => {
    lastCard.current = whoKey ? `card|${whoKey}` : null;
  }, [whoKey]);
  useEffect(
    () =>
      on('sessionEnded', (reason) => {
        const key = lastCard.current;
        if (!key || !['access_ended', 'removed', 'revoked'].includes(reason)) return;
        cardFresh.current = null;
        setCardKept(null);
        // The key and its kinds beside it (`…|kinds`): member ids are all one length, so nobody else's.
        void openOnce()
          .then((s) => s.forgetCached(key))
          .catch(() => undefined);
      }),
    [openOnce],
  );

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

  // The vault answering again (Try again, or the app looking by itself):
  // notes written offline go now. Scans keep their own pace, as before.
  const wasOffline = useRef(offline);
  useEffect(() => {
    const was = wasOffline.current;
    wasOffline.current = offline;
    if (was && !offline && notesRef.current.length > 0 && inFront()) void uploader?.kick({ fresh: true });
  }, [offline, uploader]);

  // Read from this render, not the ref: a tap can come before the ref's effect has run.
  const allowed = useCallback(() => who !== null && can(who.role, 'document.add'), [who]);

  // One scanner or picker at a time: a second tap while it opens is nothing.
  const busyScanning = useRef(false);
  const run = useCallback(
    async (open: () => Promise<ScanOutcome>, onOpened?: () => void): Promise<ScanOutcome> => {
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
    },
    [lock],
  );

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
        // Taken in: felt, as the card comes (P10).
        feel('tap');
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
      if (outcome.kind !== 'pages') return null;
      feel('tap');
      return outcome.pages.slice(0, max);
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
      labels?: Record<string, string>,
      inbox?: boolean,
    ): Promise<SaveOutcome> => {
      if (saving.current) return saving.current;
      const run = (async (): Promise<SaveOutcome> => {
        const w = who;
        if (!w || !can(w.role, 'document.add')) return { kind: 'refused', problem: 'not_allowed' };
        let s: QueueStore;
        try {
          // Open already, or still opening, or it would not open before: one more try, now.
          s = await openOnce();
        } catch {
          return { kind: 'refused', problem: 'queue_unavailable' };
        }
        timings.mark('save');
        try {
          const item = await commitCapture(
            {
              source,
              metadata: inbox ? null : metadata,
              origin: w.origin,
              account: w.member_id,
              labels: inbox ? null : (labels ?? null),
              inbox: inbox === true,
            },
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
        const unnamed = !inbox && (metadata === null || !metadata.type_key);
        setSaved({
          unnamed,
          reminder: unnamed || inbox ? null : note.reminder,
          noExpiry: unnamed || inbox ? false : note.noExpiry,
          offline: current.current.offline,
          ...(inbox ? { inbox: true } : {}),
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
    [who, deps, timings, refresh, uploader, openOnce],
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

  const forgetVault = useCallback(
    async (origin: string): Promise<number> => {
      if (!store) return 0;
      const theirs = (await store.list()).filter((i) => i.origin === origin);
      // Notes written here go, every one, anybody's — the sheet said how many
      // (0.13.0); a scan already on its way is left to arrive.
      for (const i of theirs) if (i.kind === 'note' || i.state !== 'sending') await store.remove(i.id);
      await store.forgetCached(`card|${origin}|`);
      await refresh();
      return theirs.filter((i) => i.kind !== 'note' && i.state === 'sending').length;
    },
    [store, refresh],
  );

  // Put right and sent again, under the same key: the vault kept nothing of
  // a refused try. The visibility is the card's, never less private. With
  // no new details it goes as it was, asking the vault first if a try
  // before may have reached it.
  const retry = useCallback(
    async (id: string, metadata?: CaptureMetadata) => {
      await store?.update(id, {
        ...(metadata ? { metadata } : {}),
        state: 'waiting',
        problem: null,
        attempts: 0,
        nextAt: 0,
        lastCode: null,
      });
      await refresh();
      if (inFront()) void uploader?.kick();
    },
    [store, refresh, uploader],
  );

  /** This person's note, for this vault: nobody else's is ever changed, deleted or sent from here. */
  const theirNote = useCallback(
    async (id: string): Promise<QueueItem | null> => {
      const w = who;
      if (!store || !w) return null;
      const item = (await store.list()).find((i) => i.id === id);
      return item && item.kind === 'note' && item.origin === w.origin && item.account === w.member_id ? item : null;
    },
    [store, who],
  );

  /** Into the queue, under its client id: 'waiting' goes by itself; 'unsure' waits for its person. */
  const keepNote = useCallback(
    async (payload: NotePayload, key: string, state: 'waiting' | 'unsure'): Promise<NoteOutcome> => {
      const w = who;
      if (!w || !can(w.role, 'document.add')) return { kind: 'refused', problem: 'not_allowed' };
      let s: QueueStore;
      try {
        s = await openOnce();
      } catch {
        return { kind: 'refused', problem: 'queue_unavailable' };
      }
      const bytes = noteBytes({ ...payload, clientId: key });
      const item = noteItem({
        id: deps.uuid(),
        key,
        origin: w.origin,
        account: w.member_id,
        now: deps.now(),
        size: bytes.byteLength,
        state,
      });
      await s.add(item, bytes);
      await refresh();
      if (state === 'waiting' && inFront()) void uploader?.kick();
      return { kind: 'queued', id: item.id, state };
    },
    [who, deps, openOnce, refresh, uploader],
  );

  const writeNote = useCallback((payload: NotePayload) => keepNote(payload, deps.uuid(), 'waiting'), [keepNote, deps]);

  const saveNewNote = useCallback(
    async (payload: NotePayload): Promise<NewNoteOutcome> => {
      const w = who;
      if (!w || !can(w.role, 'document.add')) return { kind: 'refused', problem: 'not_allowed' };
      const key = deps.uuid();
      // Known to have no answer: kept here at once, nothing sent.
      if (current.current.offline) return keepNote(payload, key, 'waiting');
      let s: QueueStore;
      try {
        s = await openOnce();
      } catch {
        return { kind: 'refused', problem: 'queue_unavailable' };
      }
      // In the queue before anything goes (0.13.1): an app killed mid-Save
      // keeps the note — gone on again under its key if it went with one, or
      // Might already be in your vault — never lost.
      const bytes = noteBytes({ ...payload, clientId: key });
      const item = noteItem({
        id: deps.uuid(),
        key,
        origin: w.origin,
        account: w.member_id,
        now: deps.now(),
        size: bytes.byteLength,
        state: 'sending',
      });
      uploader?.claim(item.id);
      try {
        await s.add(item, bytes);
        const kept = async (patch: Partial<QueueItem> & { state: 'waiting' | 'unsure' }): Promise<NoteOutcome> => {
          await s.update(item.id, { attempts: 1, ...patch });
          await refresh();
          if (patch.state === 'waiting' && inFront()) void uploader?.kick();
          return { kind: 'queued', id: item.id, state: patch.state };
        };
        try {
          const out = await current.current.withToken((_a, token) =>
            sendOne(token, s, item, { ...payload, clientId: key }, key),
          );
          await s.remove(item.id);
          await refresh();
          if (out.hidden || !out.id) {
            if (out.hidden) addHidden(hiddenName(payload));
            return { kind: 'hidden' };
          }
          return { kind: 'made', id: out.id };
        } catch (err) {
          // The vault said "not yet" under its key: it goes again when it said.
          if (err instanceof NoAnswerError && err.retryInMs !== undefined) {
            return await kept({ state: 'waiting', nextAt: deps.now() + err.retryInMs, lastCode: err.answer?.code ?? null });
          }
          // It went, and no answer came: it may be there. Never sent again unseen.
          if (err instanceof MaybeSentError) return await kept({ state: 'unsure' });
          // It never left, or goes again safely under its key: it waits, and goes by itself.
          if (noConnection(err)) return await kept({ state: 'waiting', lastCode: 'offline' });
          // Refused: nothing kept here — New note says why, and what was typed is still on it.
          await s.remove(item.id);
          await refresh();
          throw err;
        }
      } finally {
        uploader?.unclaim(item.id);
      }
    },
    [who, deps, keepNote, openOnce, refresh, uploader, sendOne, addHidden],
  );

  const changeNote = useCallback(
    async (id: string, payload: NotePayload): Promise<NoteChange> => {
      const item = await theirNote(id);
      if (!store || !item) return 'gone';
      if (item.state === 'sending') return 'sending';
      const had = await store.bytes(id);
      const was = had ? readNote(had) : null;
      // Sent once under its key and not settled: the try it made stays frozen
      // with the key (its count begun again: the person is here), so the next
      // try is the same request, and settles whether the first landed (0.13.1).
      const sent = was?.sent ? { ...was.sent, failed: 0, busy: 0 } : undefined;
      const bytes = noteBytes({ ...payload, clientId: was?.clientId ?? item.key, ...(sent ? { sent } : {}) });
      // Changed: as written now. One that might already be in the vault stays
      // so — Send again sends what it says now — unless its key can still
      // settle it, safely, under the vault's 24 hours; one already in the
      // vault as it first went stays so; one the vault refused is tried again.
      const now = deps.now();
      const settles = item.state === 'unsure' && !!sent && keyLive(sent, now) && takesKeys() !== false;
      const stays = (item.state === 'unsure' && !settles) || item.state === 'arrived';
      // The vault's own Retry-After, given just now, still holds.
      const nextAt = item.state === 'waiting' && VAULT_SAID_WHEN(item.lastCode) && item.nextAt > now ? item.nextAt : 0;
      const out = await store.replaceBytes(id, bytes, {
        size: bytes.byteLength,
        dropped: [],
        ...(stays ? {} : { state: 'waiting' as const, problem: null, attempts: 0, nextAt }),
      });
      await refresh();
      if (out === 'ok' && !stays && inFront()) void uploader?.kick();
      return out === 'ok' ? 'done' : out;
    },
    [store, theirNote, deps, refresh, uploader, takesKeys],
  );

  const removeNote = useCallback(
    async (id: string): Promise<NoteChange> => {
      const item = await theirNote(id);
      if (!store || !item) return 'gone';
      // Refused while a try sends it: deleted now, it could still arrive unseen.
      const out = await store.removeIdle(id);
      await refresh();
      return out === 'ok' ? 'done' : out;
    },
    [store, theirNote, refresh],
  );

  const sendNoteAgain = useCallback(
    async (id: string): Promise<NoteChange> => {
      const item = await theirNote(id);
      if (!store || !item) return 'gone';
      if (item.state === 'sending') return 'sending';
      const p = readNote((await store.bytes(id)) ?? new Uint8Array());
      if (!p) return 'gone';
      // Still within its key's day, to a vault that keeps keys: the same key
      // and the words it first went with, so the vault's answer settles it —
      // in the vault already, or made now, never twice (0.13.1).
      if (p.sent && keyLive(p.sent, deps.now()) && takesKeys() !== false && p.clientId) {
        const again = noteBytes({ ...p, sent: { ...p.sent, failed: 0, busy: 0 } });
        const out = await store.replaceBytes(id, again, {
          state: 'waiting',
          problem: null,
          attempts: 0,
          nextAt: 0,
          size: again.byteLength,
        });
        await refresh();
        if (out === 'ok' && inFront()) void uploader?.kick();
        return out === 'ok' ? 'done' : out;
      }
      // A new note, by its person's choice: a new client id with it, and nothing of the old key's try.
      const key = deps.uuid();
      const { sent: _old, landed: _where, ...words } = p;
      const bytes = noteBytes({ ...words, clientId: key });
      const out = await store.replaceBytes(id, bytes, {
        key,
        state: 'waiting',
        problem: null,
        attempts: 0,
        nextAt: 0,
        size: bytes.byteLength,
      });
      await refresh();
      if (out === 'ok' && inFront()) void uploader?.kick();
      return out === 'ok' ? 'done' : out;
    },
    [store, theirNote, deps, refresh, uploader, takesKeys],
  );

  const holdNote = useCallback((id: string) => uploader?.hold(id), [uploader]);
  // Let go: sent when its time comes (the uploader does nothing while the app is in the background).
  const releaseNote = useCallback((id: string) => void uploader?.release(id), [uploader]);

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
      setSaved({
        unnamed: false,
        reminder: null,
        noExpiry: false,
        renewal: true,
        renews: documentId,
        offline: current.current.offline,
      });
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
      storeOpen: store !== null,
      renew,
      retry,
      others,
      waitingHere,
      removeMany,
      forgetVault,
      pending,
      start,
      morePages,
      cardShown: () => timings.mark('card_shown'),
      save,
      throwAway,
      discard: deps.discard,
      queue,
      notes,
      notesHere,
      saveNewNote,
      writeNote,
      changeNote,
      removeNote,
      sendNoteAgain,
      holdNote,
      releaseNote,
      notesNarrowed,
      dismissNotesNarrowed: () => setNotesNarrowed([]),
      notesHidden,
      sawNotesHidden: () => persistHidden([]),
      dismissNotesHidden: () => {
        hiddenRef.current = [];
        setNotesHidden([]);
        persistHidden([]);
      },
      delivered,
      saved,
      dismissSaved: () => setSaved(null),
      filedWithout,
      dismissFiledWithout: () => setFiledWithout([]),
      remove,
      timings,
    }),
    [
      deps,
      loadCard,
      cardKept,
      cardKey,
      store,
      renew,
      retry,
      others,
      waitingHere,
      removeMany,
      forgetVault,
      pending,
      start,
      morePages,
      save,
      throwAway,
      queue,
      notes,
      notesHere,
      saveNewNote,
      writeNote,
      changeNote,
      removeNote,
      sendNoteAgain,
      holdNote,
      releaseNote,
      notesNarrowed,
      notesHidden,
      persistHidden,
      delivered,
      saved,
      filedWithout,
      remove,
      timings,
    ],
  );
  return <CaptureContext.Provider value={value}>{props.children}</CaptureContext.Provider>;
}
