import type { CaptureMetadata } from '@fdv/shared';

/**
 * One capture on its way to the vault. It is made at Save or Skip, with
 * its bytes, and it is all the phone keeps of the scan: the scanner's own
 * files are deleted as soon as it exists.
 *
 * - waiting: not sent yet, or to be tried again from `nextAt`.
 * - sending: a try is under way. One left over from a closed app is sent
 *   again, asking the vault first what became of it.
 * - needs_you: the vault refused it, for a reason trying again cannot fix;
 *   or the phone could not send it, for a reason that is not the
 *   connection (`send_failed`), and it waits for a person to try again.
 *
 * - unsure (a note written offline only, 0.13.0): a try went out and no
 *   answer came back, so it may already be in the vault — to a vault that
 *   takes no Idempotency-Key for a new note; or to one that does, more than
 *   23 hours after its first try (the vault keeps a key 24), or after the
 *   vault failed it too many times (0.13.1). The phone never sends it again
 *   by itself, and never guesses: the person looks in Notes, then Sends
 *   again or Deletes.
 * - arrived (a note only, 0.13.1): the vault has it as it first went, under
 *   its key, and the person changed it since: their change waits for them,
 *   to be sent as a new note or discarded.
 *
 * Once the vault has it (201), the item, its bytes and its key are gone.
 */
export type QueueState = 'waiting' | 'sending' | 'needs_you' | 'unsure' | 'arrived';

/** Waiting for its time: the only items the uploader starts. */
export const startable = (i: Pick<QueueItem, 'state'>) => i.state === 'waiting' || i.state === 'sending';

export interface QueueProblem {
  /** The HTTP status, or 0 for a refusal the phone made itself. */
  status: number;
  code: string;
  /** The vault's own words, when it gave any. */
  message: string | null;
}

/**
 * The phone could not send it, and not for want of a connection: the
 * app's own fault, which trying by itself again would only repeat. Never
 * the vault's refusal — the vault said nothing.
 */
export const sendFailed = (problem: QueueProblem | null): boolean =>
  problem !== null && problem.status === 0 && problem.code === 'send_failed';

/**
 * What an item makes: a new document (POST /capture), or a new version of
 * one already in the vault — a renewed passport, a new policy year (POST
 * /documents/{target}/versions), which also resolves its reminders — or an
 * item in the person's Inbox (I5, `features.batches`): a scan sent with
 * "Send to my Inbox", one file of the day's batch (POST
 * /batches/{target}/items), read by the vault and finished on the web.
 *
 * Or a new note written while the vault could not be reached (0.13.0): its
 * title, words and who can see it are the item's bytes (queue/note.ts), kept
 * in the same encrypted queue as a scan, and sent as POST /documents.
 */
export type QueueKind = 'capture' | 'version' | 'inbox' | 'note';

export interface QueueItem {
  id: string;
  kind: QueueKind;
  /**
   * For a version: the document it renews. For an Inbox item: the batch it
   * was sent to, chosen at its first try — never when it was saved, so a
   * scan kept offline goes into the batch of the day it is sent — and kept,
   * so a try made again goes to the same batch under the same key (the
   * vault's Idempotency-Key is a batch's own). Null until then.
   */
  target: string | null;
  /**
   * The upload's idempotency key: made once, at Save, and sent with every
   * try, so a retry can never make a second document.
   */
  key: string;
  /** Which vault it is for, and whose it is: never sent anywhere else, or as anyone else. */
  origin: string;
  account: string;
  createdAt: number;
  state: QueueState;
  /** The card's answers; null after Skip, and for an Inbox item. */
  metadata: CaptureMetadata | null;
  filename: string;
  mime: string;
  size: number;
  attempts: number;
  /** Not before this (ms since the epoch). */
  nextAt: number;
  /**
   * The last try may have reached the vault without the answer reaching
   * the phone: ask the vault what became of it before sending again.
   */
  askFirst: boolean;
  problem: QueueProblem | null;
  /**
   * Why the last try did not go, while it waits to try again: 'offline',
   * or the vault's code ('storage_unreachable', 'rate_limited'…). Null
   * before the first try.
   */
  lastCode: string | null;
  /**
   * The card's names for the type's own details it sent, by field key
   * (0.2.1): what becomes of one is said by its name, never by its key.
   */
  labels?: Record<string, string>;
  /**
   * The details left out so the scan could be filed, by field key: the
   * vault no longer took them — the kind lost the field, or the answer,
   * while the scan waited on the phone (0.2.1).
   */
  dropped?: string[];
}

/** A scan filed, or to be filed, without some of its details: its kind no longer took them. */
export interface FiledWithout {
  title: string | null;
  /** Those details as the card named them; null when a name was not kept. */
  names: string[] | null;
}

/** What an item left out, in words to say — never its keys; null when it left nothing out. */
export function filedWithout(item: Pick<QueueItem, 'metadata' | 'labels' | 'dropped'>): FiledWithout | null {
  const dropped = [...new Set(item.dropped ?? [])];
  if (dropped.length === 0) return null;
  const names = dropped.map((key) => item.labels?.[key] ?? null);
  return {
    title: item.metadata?.title ?? null,
    names: names.every((n): n is string => typeof n === 'string' && n.trim() !== '') ? names : null,
  };
}
