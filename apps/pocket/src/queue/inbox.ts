import { ApiRequestError, type Api } from '@fdv/client';
import { BATCH_MAX_FILES } from '@fdv/shared';
import type { QueueItem } from './item';
import type { QueueStore } from './store';

/**
 * "Send to my Inbox" (I5): a scan goes up as one file of a batch of the
 * person's own (Phase 6, I1), to be read and suggested for by the vault and
 * finished on the web. Nothing of it is shown on the phone afterwards.
 *
 * One batch a day — "From my phone, 10 Oct" — made by the first scan sent
 * that day and used by the rest. Before one is made, the person's own
 * batches are looked at, and an open one with that very name is used (the
 * review round, I5-6): a lost answer to the POST that made it, or another
 * of their phones, never makes a second. Which one is kept beside the
 * card's choices (`card|origin|member|batch`), so it goes with them: a
 * vault left, or a session ended because the person is gone from it.
 *
 * Each scan keeps its own Idempotency-Key, and the batch it was first sent
 * to (`target`, stored before the first try): a try made again after its
 * answer was lost goes to that batch under that key, and the vault answers
 * with the item the first try made.
 *
 * A batch that takes no more — it has ended (409 `batch_ended`) or is full
 * (422 `batch_full`) — gets a new one for the scan, once: the vault refuses
 * those before it looks at the bytes, and after it has answered a replay,
 * so nothing is in the old one twice. A 404 is the batch gone: a new one
 * only when the scan had never been sent anywhere (the day's kept batch was
 * removed). Sent before, to its own batch, a 404 is the person's own doing
 * on the web — they removed it, or filed it — and the scan is done with,
 * quietly, as for 409 `already_decided` (I5-2).
 */

/** The day's batch, as kept: its id, and the day on this phone's calendar it was made for. */
export interface DayBatch {
  id: string;
  day: string;
}

/** Where the day's batch is kept, beside the card's choices for this vault and person. */
export const dayBatchKey = (item: Pick<QueueItem, 'origin' | 'account'>) => `card|${item.origin}|${item.account}|batch`;

/** The day on this phone's calendar: "2026-10-10". */
export function phoneDay(at: number): string {
  const d = new Date(at);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The day as a batch's name says it: "10 Oct". */
export function shortDay(at: number): string {
  const d = new Date(at);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

const isApi = (err: unknown, status: number, code?: string): err is ApiRequestError =>
  err instanceof ApiRequestError && err.status === status && (code === undefined || err.code === code);

/** A batch that takes no more files, whatever was sent before: a new one is made for the scan. */
const takesNoMore = (err: unknown): boolean => isApi(err, 409, 'batch_ended') || isApi(err, 422, 'batch_full');

/** The batch is not there (404). */
const batchGone = (err: unknown): boolean => isApi(err, 404);

/**
 * The file arrived before, and its person has removed or filed it on the
 * web since (409 `already_decided`): there is nothing left to send.
 */
const removedSince = (err: unknown): boolean => isApi(err, 409, 'already_decided');

/**
 * GET or POST /batches answered 404: the vault has no batches (rolled back
 * to before I1). Whoever sends asks what the vault can do, rather than
 * leaving the scan for a person to remove (I5-3).
 */
export class NoBatchesError extends Error {
  constructor() {
    super('The vault has no batches.');
    this.name = 'NoBatchesError';
  }
}

/**
 * What became of a scan sent to the Inbox: in a batch now (`sent`), or
 * already dealt with on the web, so nothing was sent (`gone`).
 */
export type InboxOutcome = 'sent' | 'gone';

export interface InboxDeps {
  api: Api;
  token: string;
  store: QueueStore;
  now: () => number;
  /** A new batch's name, for the day it is made: "From my phone, 10 Oct". */
  name: (at: number) => string;
}

/** The scan, as one file into the day's batch; throws what the client throws, or NoBatchesError. */
export async function sendToInbox(item: QueueItem, bytes: Uint8Array, deps: InboxDeps): Promise<InboxOutcome> {
  const { api, token, store } = deps;
  const key = dayBatchKey(item);
  const file = { kind: 'bytes' as const, filename: item.filename, contentType: item.mime, bytes };

  /** The collection's own routes answering 404: no batches on this vault. */
  const collection = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      if (batchGone(err)) throw new NoBatchesError();
      throw err;
    }
  };
  /** Today's batch: an open one of the person's with today's very name, or a new one. Never `not`. */
  const today = async (not?: string): Promise<string> => {
    const at = deps.now();
    const name = deps.name(at);
    const day = phoneDay(at);
    if (!not) {
      const kept = await store.cached<DayBatch>(key);
      if (kept && kept.day === day) return kept.id;
    }
    const { items } = await collection(() => api.batches(token));
    const open = items.find(
      (b) => b.id !== not && b.name === name && Date.parse(b.ends_at) > deps.now() && b.counts.items < BATCH_MAX_FILES,
    );
    const id = open?.id ?? (await collection(() => api.createBatch(token, { name }))).id;
    await store.cache(key, { id, day } satisfies DayBatch);
    return id;
  };
  /** Chosen for this scan, and kept before anything is sent: its retries go there. */
  const choose = async (batch: string) => {
    await store.update(item.id, { target: batch });
    return batch;
  };

  // Sent before (a try whose answer was lost, or that found no connection): to that batch.
  const sentBefore = item.target !== null;
  const first = item.target ?? (await choose(await today()));
  try {
    await api.addBatchItem(token, first, file, item.key);
    return 'sent';
  } catch (err) {
    if (removedSince(err)) return 'gone';
    if (batchGone(err) && sentBefore) return 'gone';
    if (!takesNoMore(err) && !batchGone(err)) throw err;
  }
  // That batch takes no more, or the day's kept one has gone: forgotten, and another for this scan.
  const kept = await store.cached<DayBatch>(key);
  if (kept?.id === first) await store.forgetCached(key);
  await api.addBatchItem(token, await choose(await today(first)), file, item.key);
  return 'sent';
}

/**
 * The person's own files waiting in their Inbox, from GET /batches — the
 * light list, without levels: each batch counts what is still undecided.
 * Nobody else's batch is ever listed.
 */
export async function waitingInInbox(api: Api, token: string): Promise<number> {
  const { items } = await api.batches(token);
  return items.reduce((n, b) => n + b.counts.waiting, 0);
}
