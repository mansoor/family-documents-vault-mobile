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

export interface QueueItem {
  id: string;
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
}
