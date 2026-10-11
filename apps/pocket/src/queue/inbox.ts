import { ApiRequestError, type Api } from '@fdv/client';
import type { QueueItem } from './item';
import type { QueueStore } from './store';

/**
 * "Send to my Inbox" (I5): a scan goes up as one file of a batch of the
 * person's own (Phase 6, I1), to be read and suggested for by the vault and
 * finished on the web. Nothing of it is shown on the phone afterwards.
 *
 * One batch a day on each phone — "From my phone, 10 Oct" — made by the
 * first scan sent that day and used by the rest. Which one is kept beside
 * the card's choices (`card|origin|member|batch`), so it goes with them: a
 * vault left, or a session ended because the person is gone from it.
 *
 * Each scan keeps its own Idempotency-Key, and the batch it was first sent
 * to (`target`): a try made again after its answer was lost goes to that
 * batch under that key, and the vault answers with the item the first try
 * made. A batch that takes no more — it has ended (409 `batch_ended`), it
 * is full (422 `batch_full`) or it was removed (404) — is forgotten, and a
 * new one is made for the scan, once: the vault refuses those before it
 * keeps a byte, so nothing is in the old one twice.
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

/** A batch that takes no more files: a new one is made for the scan. */
export const batchTakesNoMore = (err: unknown): boolean =>
  err instanceof ApiRequestError &&
  ((err.status === 409 && err.code === 'batch_ended') ||
    (err.status === 422 && err.code === 'batch_full') ||
    (err.status === 404 && err.code === 'not_found'));

/**
 * The file arrived before, and its person has removed it on the web since
 * (409 `already_decided`): there is nothing left to send.
 */
const removedSince = (err: unknown): boolean =>
  err instanceof ApiRequestError && err.status === 409 && err.code === 'already_decided';

export interface InboxDeps {
  api: Api;
  token: string;
  store: QueueStore;
  now: () => number;
  /** A new batch's name, for the day it is made: "From my phone, 10 Oct". */
  name: (at: number) => string;
}

/** The scan, as one file into the day's batch; throws what the client throws. */
export async function sendToInbox(item: QueueItem, bytes: Uint8Array, deps: InboxDeps): Promise<void> {
  const { api, token, store } = deps;
  const key = dayBatchKey(item);
  const file = { kind: 'bytes' as const, filename: item.filename, contentType: item.mime, bytes };

  const made = async (): Promise<string> => {
    const at = deps.now();
    const batch = await api.createBatch(token, { name: deps.name(at) });
    await store.cache(key, { id: batch.id, day: phoneDay(at) } satisfies DayBatch);
    return batch.id;
  };
  const today = async (): Promise<string> => {
    const kept = await store.cached<DayBatch>(key);
    return kept && kept.day === phoneDay(deps.now()) ? kept.id : made();
  };
  /** Chosen for this scan, and kept before anything is sent: its retries go there. */
  const choose = async (batch: string) => {
    await store.update(item.id, { target: batch });
    return batch;
  };

  const first = item.target ?? (await choose(await today()));
  try {
    await api.addBatchItem(token, first, file, item.key);
  } catch (err) {
    if (removedSince(err)) return;
    if (!batchTakesNoMore(err)) throw err;
    // That batch takes no more: forgotten, if it is still the day's, and a new one for this scan.
    const kept = await store.cached<DayBatch>(key);
    if (kept?.id === first) await store.forgetCached(key);
    await api.addBatchItem(token, await choose(await made()), file, item.key);
  }
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
