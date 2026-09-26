import type { CaptureMetadata } from '@fdv/shared';

/**
 * One capture on its way to the vault. It is made at Save or Skip, with
 * its bytes, and it is all the phone keeps of the scan: the scanner's own
 * files are deleted as soon as it exists.
 *
 * - waiting: not sent yet, or to be tried again from `nextAt`.
 * - sending: a try is under way. One left over from a closed app is sent
 *   again, asking the vault first what became of it.
 * - needs_you: the vault refused it, for a reason trying again cannot fix.
 *
 * Once the vault has it (201), the item, its bytes and its key are gone.
 */
export type QueueState = 'waiting' | 'sending' | 'needs_you';

export interface QueueProblem {
  /** The HTTP status, or 0 for a refusal the phone made itself. */
  status: number;
  code: string;
  /** The vault's own words, when it gave any. */
  message: string | null;
}

/**
 * What an item makes: a new document (POST /capture), or a new version of
 * one already in the vault — a renewed passport, a new policy year (POST
 * /documents/{target}/versions), which also resolves its reminders.
 */
export type QueueKind = 'capture' | 'version';

export interface QueueItem {
  id: string;
  kind: QueueKind;
  /** For a version: the document it renews. */
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
  /** The card's answers; null after Skip. */
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
