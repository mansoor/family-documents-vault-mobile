import type { Visibility } from '@fdv/shared';
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
}

/** What a note's bytes are, so nothing mistakes them for a file. */
export const NOTE_MIME = 'application/vnd.fdv.note+json';

export function noteBytes(p: NotePayload): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      title: p.title,
      notes: p.notes,
      visibility: p.visibility,
      ...(p.clientId ? { clientId: p.clientId } : {}),
    }),
  );
}

/**
 * A note's bytes read back; null when they can't be (the note is then shown
 * as one that couldn't be read, to be deleted, never dropped unseen). Who
 * can see it, unknown or missing, is Only me: never wider than was chosen.
 */
export function readNote(bytes: Uint8Array): NotePayload | null {
  try {
    const v = JSON.parse(new TextDecoder().decode(bytes)) as Partial<NotePayload> | null;
    if (!v || typeof v !== 'object') return null;
    const visibility: Visibility =
      v.visibility === 'household' || v.visibility === 'adults' || v.visibility === 'private' ? v.visibility : 'private';
    return {
      title: typeof v.title === 'string' && v.title.trim() ? v.title : null,
      notes: typeof v.notes === 'string' && v.notes.trim() ? v.notes : null,
      visibility,
      ...(typeof v.clientId === 'string' ? { clientId: v.clientId } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * A new note, ready for the queue: 'waiting' to go, or 'unsure' — a try
 * went out from New note and its answer was lost, so it may be in the vault
 * already, and is never sent again without the person.
 */
export function noteItem(p: {
  id: string;
  key: string;
  origin: string;
  account: string;
  now: number;
  size: number;
  state: Extract<QueueState, 'waiting' | 'unsure'>;
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
    nextAt: 0,
    // A note is never asked about (the vault has nothing to ask): an unsure one waits for its person.
    askFirst: false,
    problem: null,
    lastCode: null,
  };
}
