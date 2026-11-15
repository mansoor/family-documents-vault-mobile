import { NOTE_KIND, type Visibility } from '@fdv/shared';
import type { QueueItem, QueueState } from './item';

/**
 * A new note written while the vault could not be reached (0.13.0), on its
 * way in the queue the scans use: the same encrypted queue.db on the phone,
 * the same uploader, the same rules — only ever sent as the person who wrote
 * it, to the vault it was written for, and gone from the phone once the vault
 * has it.
 *
 * What it says — its title, its words and who can see it — is the item's
 * bytes, as a scan's pages are, never a column of its own; with the client id
 * the phone made for it (`clientId`, the item's key), which goes as its
 * Idempotency-Key to a vault that takes one (`features.idempotent_create`).
 */
export interface NotePayload {
  title: string | null;
  notes: string | null;
  visibility: Visibility;
  /** Made once, when it was written (a UUID); a new one for Send again, which is a new note. */
  clientId?: string;
  /**
   * Sent once under its Idempotency-Key, and not settled yet (0.13.1): the
   * body exactly as it went, frozen with the key. Every try of that key
   * sends this, never what the note says now — a changed body under the
   * same key is refused (422) — so a change made meanwhile waits until the
   * vault has said whether the first try landed.
   */
  sent?: KeyedTry;
  /**
   * The vault has it as it first went, and said where (a 201, 0.13.1): the
   * person's change can be put into that note.
   */
  landed?: Landed;
}

/** Where the note the vault made is, as its 201 said: changes can go into it. */
export interface Landed {
  id: string;
  etag: string | null;
  /** Who can see it there: a change goes into it only when the person kept the same. */
  visibility: Visibility;
}

/** What POST /documents is sent for a note: its writer's, as written. */
export interface NoteBody {
  type_key: string;
  title: string | null;
  notes: string | null;
  visibility: Visibility;
  owner_member_id: string;
}

/** A note's first try under its key (0.13.1): what went, when, and how the vault has answered since. */
export interface KeyedTry {
  body: NoteBody;
  /** When the first try under the key went (ms since the epoch): the vault keeps a key 24 hours. */
  firstAt: number;
  /** The vault's 5xx answers to it so far. */
  failed: number;
  /** "Still being made" (409) or "busy, try again" (503) answers so far. */
  busy: number;
}

export function noteBody(p: Pick<NotePayload, 'title' | 'notes' | 'visibility'>, owner: string): NoteBody {
  return {
    type_key: NOTE_KIND,
    title: p.title?.trim() || null,
    notes: p.notes?.trim() || null,
    visibility: p.visibility,
    owner_member_id: owner,
  };
}

export const sameBody = (a: NoteBody, b: NoteBody): boolean =>
  a.type_key === b.type_key &&
  a.title === b.title &&
  a.notes === b.notes &&
  a.visibility === b.visibility &&
  a.owner_member_id === b.owner_member_id;

/** What a note's bytes are, so nothing mistakes them for a file. */
export const NOTE_MIME = 'application/vnd.fdv.note+json';

export function noteBytes(p: NotePayload): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      title: p.title,
      notes: p.notes,
      visibility: p.visibility,
      ...(p.clientId ? { clientId: p.clientId } : {}),
      ...(p.sent ? { sent: p.sent } : {}),
      ...(p.landed ? { landed: p.landed } : {}),
    }),
  );
}

const VISIBILITIES: readonly string[] = ['household', 'adults', 'private'];

/** A first try read back; null when it isn't one (a later 422 then says the earlier version is there). */
function readTry(v: unknown): KeyedTry | null {
  if (!v || typeof v !== 'object') return null;
  const t = v as Partial<KeyedTry>;
  const b = t.body as Partial<NoteBody> | undefined;
  const text = (x: unknown) => x === null || typeof x === 'string';
  if (
    !b ||
    typeof b.type_key !== 'string' ||
    !text(b.title) ||
    !text(b.notes) ||
    typeof b.visibility !== 'string' ||
    !VISIBILITIES.includes(b.visibility) ||
    typeof b.owner_member_id !== 'string' ||
    typeof t.firstAt !== 'number'
  ) {
    return null;
  }
  return {
    body: {
      type_key: b.type_key,
      title: b.title ?? null,
      notes: b.notes ?? null,
      visibility: b.visibility as Visibility,
      owner_member_id: b.owner_member_id,
    },
    firstAt: t.firstAt,
    failed: typeof t.failed === 'number' ? t.failed : 0,
    busy: typeof t.busy === 'number' ? t.busy : 0,
  };
}

/**
 * A note's bytes read back; null when they can't be (the note is then shown
 * as one that couldn't be read, to be deleted, never dropped unseen). Who
 * can see it, unknown or missing, is Only me: never wider than was chosen.
 */
export function readNote(bytes: Uint8Array): NotePayload | null {
  try {
    const v = JSON.parse(new TextDecoder().decode(bytes)) as
      | (Partial<NotePayload> & { sent?: unknown; landed?: unknown })
      | null;
    if (!v || typeof v !== 'object') return null;
    const sent = readTry(v.sent);
    const l = v.landed as Partial<Landed> | undefined;
    const landed: Landed | null =
      l && typeof l === 'object' && typeof l.id === 'string'
        ? {
            id: l.id,
            etag: typeof l.etag === 'string' ? l.etag : null,
            visibility: VISIBILITIES.includes(String(l.visibility)) ? (l.visibility as Visibility) : 'private',
          }
        : null;
    const visibility: Visibility =
      v.visibility === 'household' || v.visibility === 'adults' || v.visibility === 'private' ? v.visibility : 'private';
    return {
      title: typeof v.title === 'string' && v.title.trim() ? v.title : null,
      notes: typeof v.notes === 'string' && v.notes.trim() ? v.notes : null,
      visibility,
      ...(typeof v.clientId === 'string' ? { clientId: v.clientId } : {}),
      ...(sent ? { sent } : {}),
      ...(landed ? { landed } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * A new note, ready for the queue: 'waiting' to go, or 'unsure' — a try
 * went out from New note and its answer was lost, so it may be in the vault
 * already, and is never sent again without the person (a vault that takes
 * no Idempotency-Key). `nextAt`: not before then (the vault said when).
 */
export function noteItem(p: {
  id: string;
  key: string;
  origin: string;
  account: string;
  now: number;
  size: number;
  state: Extract<QueueState, 'waiting' | 'unsure' | 'sending'>;
  nextAt?: number;
}): QueueItem {
  return {
    id: p.id,
    kind: 'note',
    target: null,
    key: p.key,
    origin: p.origin,
    account: p.account,
    createdAt: p.now,
    state: p.state,
    metadata: null,
    filename: 'note',
    mime: NOTE_MIME,
    size: p.size,
    attempts: 0,
    nextAt: p.nextAt ?? 0,
    // A note is never asked about (the vault has nothing to ask): an unsure one waits for its person.
    askFirst: false,
    problem: null,
    lastCode: null,
  };
}
