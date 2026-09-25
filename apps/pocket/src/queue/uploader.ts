import { ApiRequestError, isSessionOver, retryDelay } from '@fdv/client';
import type { CaptureResult, UploadStatus } from '@fdv/shared';
import type { QueueItem } from './item';
import type { QueueStore } from './store';

/**
 * Sends the queue to the vault, one capture at a time, oldest first, while
 * the app is in the foreground. It never gives up by itself: anything that
 * trying again could fix is tried again — the vault's Retry-After when it
 * gives one, growing waits with jitter when it does not — and anything it
 * could not (too big, a kind of file the vault does not keep, details it
 * refuses) waits for a person, with the vault's reason.
 *
 * Every try carries the item's one idempotency key, and a try whose
 * answer never arrived — the connection dropped, the app was closed —
 * asks the vault what became of it (GET /uploads/{key}) before sending
 * again. However it goes, one scan makes one document, and only ever as
 * the person who made it, to the vault it was made for.
 */

export type UploadEvent = { kind: 'sent'; item: QueueItem; documentId: string } | { kind: 'changed' };

export interface Owner {
  origin: string;
  account: string;
}

export interface UploaderDeps {
  store: QueueStore;
  /** Sends one capture as its owner; throws what the client throws, or NotThisAccountError. */
  send(item: QueueItem, bytes: Uint8Array): Promise<CaptureResult>;
  /** What became of an upload, asked as its owner; a 404 when the vault never finished one with this key. */
  status(item: QueueItem): Promise<UploadStatus>;
  /** The vault and account signed in now: only their items are sent. */
  who(): Owner | null;
  now(): number;
  random?(): number;
  /** Runs `fn` after `ms`; returns a cancel. */
  schedule?(ms: number, fn: () => void): () => void;
  onEvent?(event: UploadEvent): void;
}

/**
 * The session changed under a send: somebody else is signed in now, or
 * another vault. Nothing was sent; the item waits for its own person.
 */
export class NotThisAccountError extends Error {
  constructor() {
    super('Signed in as someone else now.');
    this.name = 'NotThisAccountError';
  }
}

export const sameOwner = (who: Owner | null, item: Pick<QueueItem, 'origin' | 'account'>) =>
  who !== null && who.origin === item.origin && who.account === item.account;

/** The vault's refusals that no retry can change. */
const FINAL = new Set([400, 403, 404, 410, 413, 415, 422]);
/** How long to wait while the vault is still busy with an earlier try. */
const IN_PROGRESS_MS = 5_000;

export class Uploader {
  private draining: Promise<void> | null = null;
  private again = false;
  private cancelTimer: (() => void) | null = null;
  private stopped = false;
  /**
   * Items waiting only because of the phone's side — no connection, not
   * signed in, not the approved vault or not on Wi-Fi — which are worth
   * trying the moment that changes rather than after their backoff.
   */
  private readonly phoneSide = new Set<string>();

  constructor(private readonly deps: UploaderDeps) {}

  /**
   * Look at the queue now: after a Save, or when the vault's Retry-After
   * is up. `fresh` (online again, back in front, signed in) also retries
   * at once what was waiting only for the phone. Does nothing while
   * stopped: only resume() starts it again.
   */
  kick(opts: { fresh?: boolean } = {}): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (opts.fresh) this.freshen = true;
    if (this.draining) {
      this.again = true;
      return this.draining;
    }
    this.draining = (async () => {
      try {
        do {
          this.again = false;
          if (this.freshen) {
            this.freshen = false;
            await this.retryPhoneSide();
          }
          await this.drainOnce();
        } while (this.again && !this.stopped);
      } finally {
        this.draining = null;
        this.plan();
      }
    })();
    return this.draining;
  }

  private freshen = false;

  /** Back in the foreground: sending may start again. */
  resume(): Promise<void> {
    this.stopped = false;
    return this.kick({ fresh: true });
  }

  /** In the background: nothing more is started, and no timer is left waiting. */
  stop(): void {
    this.stopped = true;
    this.cancelTimer?.();
    this.cancelTimer = null;
  }

  private async retryPhoneSide(): Promise<void> {
    if (this.phoneSide.size === 0) return;
    for (const item of await this.mine()) {
      if (this.phoneSide.has(item.id) && item.state === 'waiting' && item.nextAt > this.deps.now()) {
        await this.deps.store.update(item.id, { nextAt: 0 });
      }
    }
  }

  /** Every item due now, once each, in order — each checked against who is signed in when its turn comes. */
  private async drainOnce(): Promise<void> {
    const due = (await this.mine()).filter((i) => i.state !== 'needs_you' && i.nextAt <= this.deps.now());
    for (const item of due) {
      if (this.stopped || !sameOwner(this.deps.who(), item)) return;
      await this.attempt(item);
    }
  }

  private async mine(): Promise<QueueItem[]> {
    const who = this.deps.who();
    if (!who) return [];
    return (await this.deps.store.list()).filter((i) => sameOwner(who, i));
  }

  /** A timer for the next item that is waiting for its time. */
  private plan(): void {
    this.cancelTimer?.();
    this.cancelTimer = null;
    if (this.stopped) return;
    void this.mine().then((items) => {
      if (this.stopped || this.draining) return;
      const next = Math.min(...items.filter((i) => i.state !== 'needs_you').map((i) => i.nextAt));
      if (!Number.isFinite(next)) return;
      const schedule = this.deps.schedule ?? defaultSchedule;
      this.cancelTimer = schedule(Math.max(0, next - this.deps.now()), () => void this.kick());
    });
  }

  private async attempt(item: QueueItem): Promise<void> {
    const { store } = this.deps;
    const attempts = item.attempts + 1;
    try {
      if (item.askFirst) {
        if (!sameOwner(this.deps.who(), item)) return;
        const status = await this.statusOf(item);
        if (status?.state === 'done') return await this.sent(item, status.document_id);
        if (status?.state === 'in_progress') {
          await this.wait(item, {
            attempts,
            nextAt: this.deps.now() + IN_PROGRESS_MS,
          });
          return;
        }
      }
      const bytes = await store.bytes(item.id);
      if (!bytes) {
        // Nothing left to send: the item cannot be finished, only forgotten.
        await store.remove(item.id);
        this.deps.onEvent?.({ kind: 'changed' });
        return;
      }
      if (!sameOwner(this.deps.who(), item)) return;
      // From here the vault may get it without the phone hearing back: the
      // next try asks first, even if this app is closed halfway.
      await store.update(item.id, {
        state: 'sending',
        attempts,
        askFirst: true,
      });
      this.deps.onEvent?.({ kind: 'changed' });
      const made = await this.deps.send(item, bytes);
      await this.sent(item, made.document_id);
    } catch (err) {
      await this.failed(item, attempts, err);
    }
  }

  /** GET /uploads/{key}; null when the vault has nothing finished under it. */
  private async statusOf(item: QueueItem): Promise<UploadStatus | null> {
    try {
      return await this.deps.status(item);
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 404) return null;
      throw err;
    }
  }

  private async sent(item: QueueItem, documentId: string): Promise<void> {
    this.phoneSide.delete(item.id);
    await this.deps.store.remove(item.id);
    this.deps.onEvent?.({ kind: 'sent', item, documentId });
  }

  private async wait(item: QueueItem, patch: Partial<QueueItem>): Promise<void> {
    await this.deps.store.update(item.id, { state: 'waiting', ...patch });
    this.deps.onEvent?.({ kind: 'changed' });
  }

  private async failed(item: QueueItem, attempts: number, err: unknown): Promise<void> {
    const random = this.deps.random ?? Math.random;
    const later = (e: unknown) => this.deps.now() + retryDelay(e, attempts, random);
    if (err instanceof NotThisAccountError) {
      // Nothing was sent: the item stays exactly as it was, for its own person.
      await this.deps.store.update(item.id, { state: 'waiting' });
      this.deps.onEvent?.({ kind: 'changed' });
      return;
    }
    if (err instanceof ApiRequestError) {
      if (isSessionOver(err) || err.status === 401) {
        // Signed out: the item waits for whoever signs in next as this account.
        this.phoneSide.add(item.id);
        return this.wait(item, { attempts, nextAt: later(err), lastCode: 'signed_out' });
      }
      this.phoneSide.delete(item.id);
      if (err.status === 409 && err.code === 'upload_in_progress') {
        const ms = (err.retryAfterSeconds ?? IN_PROGRESS_MS / 1000) * 1000;
        return this.wait(item, {
          attempts,
          askFirst: true,
          nextAt: this.deps.now() + ms,
          lastCode: err.code,
        });
      }
      if (FINAL.has(err.status) || (err.status === 409 && !err.retriable)) {
        await this.deps.store.update(item.id, {
          state: 'needs_you',
          attempts,
          problem: {
            status: err.status,
            code: err.code,
            message: err.message || null,
          },
        });
        this.deps.onEvent?.({ kind: 'changed' });
        return;
      }
      // 408, 429, 5xx and the like: the vault is there and will take it later.
      return this.wait(item, { attempts, nextAt: later(err), lastCode: err.code });
    }
    // No answer at all, or nothing sent (not the approved vault, not on
    // Wi-Fi): try again later, asking first — or as soon as that changes.
    this.phoneSide.add(item.id);
    return this.wait(item, { attempts, nextAt: later(err), lastCode: 'offline' });
  }
}

function defaultSchedule(ms: number, fn: () => void): () => void {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
}
