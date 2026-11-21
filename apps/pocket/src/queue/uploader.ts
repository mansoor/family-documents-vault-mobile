import { ApiRequestError, isSessionOver, retryDelay } from '@fdv/client';
import type { CaptureResult, UploadStatus } from '@fdv/shared';
import { log } from '../log';
import { noConnection } from '../net/no-connection';
import { sessionHeld } from '../update/held';
import { startable, type QueueItem } from './item';
import { ArrivedEarlierError, MaybeSentError, NoAnswerError } from './note-send';
import type { QueueStore } from './store';

/**
 * Sends the queue to the vault, one capture at a time, oldest first, while
 * the app is in the foreground. It never gives up by itself: anything that
 * trying again could fix is tried again — the vault's Retry-After when it
 * gives one, growing waits with jitter when it does not — and anything it
 * could not (too big, a kind of file the vault does not keep, a person no
 * longer in the family) waits for a person, with the vault's reason. A
 * detail the vault no longer takes is left out, and said, rather than
 * leaving the scan unfiled. Only a missing connection is waited out
 * quietly: a failure that is neither the vault's answer nor the network
 * (net/no-connection.ts) is the app's own, and waits for a person too.
 *
 * Every try carries the item's one idempotency key, and a try whose
 * answer never arrived — the connection dropped, the app was closed —
 * asks the vault what became of it (GET /uploads/{key}) before sending
 * again. However it goes, one scan makes one document, and only ever as
 * the person who made it, to the vault it was made for.
 */

/** Sent: the document it made, or null for an Inbox item (I5), which is not a document yet. */
export type UploadEvent = { kind: 'sent'; item: QueueItem; documentId: string | null } | { kind: 'changed' };

export interface Owner {
  origin: string;
  account: string;
}

export interface UploaderDeps {
  store: QueueStore;
  /**
   * The whole app is held back (0.20.0): the app to be updated, or two-step
   * sign-in to set up first. Nothing is tried meanwhile — a try could only be
   * refused for it — and nothing is planned; kicked again once it is not.
   */
  heldBack?: () => boolean;
  /**
   * Sends one capture as its owner; throws what the client throws, or
   * NotThisAccountError. An Inbox item makes no document: null.
   */
  send(item: QueueItem, bytes: Uint8Array): Promise<Pick<CaptureResult, 'document_id'> | { document_id: null }>;
  /** What became of an upload, asked as its owner; a 404 when the vault never finished one with this key. */
  status(item: QueueItem): Promise<UploadStatus>;
  /** The vault and account signed in now: only their items are sent. */
  who(): Owner | null;
  now(): number;
  random?(): number;
  /** Runs `fn` after `ms`; returns a cancel. */
  schedule?(ms: number, fn: () => void): () => void;
  onEvent?(event: UploadEvent): void;
  /**
   * A refusal no retry could change, before it waits for a person: the item
   * put right where it can be — a note asked for Adults only by somebody who
   * may no longer choose it goes as Only me, never wider (0.13.0). True when
   * it was, and is to go again at once.
   */
  amend?(item: QueueItem, err: ApiRequestError): Promise<boolean>;
  /**
   * Whether a note cut off while sending (the app closed) may simply go
   * again: only when the try it was cut off in went under its
   * Idempotency-Key, which its bytes say (0.13.1). Otherwise it might
   * already be there, for its person to decide.
   */
  resumable?(item: QueueItem): Promise<boolean>;
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
  /** Items being changed by a person (a note opened to edit, 0.13.0): not started until let go. */
  private readonly held = new Set<string>();
  /** Items a try is sending now, in this app: a note said to be 'sending' and not among them was cut off (S8). */
  private readonly inFlight = new Set<string>();

  constructor(private readonly deps: UploaderDeps) {}

  /**
   * Look at the queue now: after a Save, or when the vault's Retry-After
   * is up. `fresh` (online again, back in front, signed in) also retries
   * at once what was waiting only for the phone. Does nothing while
   * stopped: only resume() starts it again.
   */
  kick(opts: { fresh?: boolean } = {}): Promise<void> {
    if (this.stopped || this.deps.heldBack?.()) return Promise.resolve();
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

  /**
   * A note New note is sending itself, now (0.13.1): in the queue first, so
   * an app killed mid-Save keeps it, and never taken for one cut off.
   */
  claim(id: string): void {
    this.inFlight.add(id);
  }

  unclaim(id: string): void {
    this.inFlight.delete(id);
  }

  /** Not sent while a person changes it; one already on its way is left to arrive. */
  hold(id: string): void {
    this.held.add(id);
  }

  /** Let go: sent as soon as its time comes. */
  release(id: string): Promise<void> {
    this.held.delete(id);
    return this.kick();
  }

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
    await this.recoverNotes();
    const due = (await this.mine()).filter((i) => startable(i) && i.nextAt <= this.deps.now());
    for (const item of due) {
      if (this.stopped || !sameOwner(this.deps.who(), item)) return;
      if (this.held.has(item.id) || this.inFlight.has(item.id)) continue;
      await this.attempt(item);
    }
  }

  /**
   * A note left 'sending' with no try under way — the app closed, or was
   * killed, while it went — may be in the vault, or not: said so, for its
   * person to decide (0.13.0, S8), never stuck and never sent again unseen.
   */
  private async recoverNotes(): Promise<void> {
    let changed = false;
    for (const i of await this.mine()) {
      if (i.kind === 'note' && i.state === 'sending' && !this.inFlight.has(i.id)) {
        await this.deps.store.update(
          i.id,
          (await this.deps.resumable?.(i)) ? { state: 'waiting', nextAt: 0 } : { state: 'unsure' },
        );
        changed = true;
      }
    }
    if (changed) this.deps.onEvent?.({ kind: 'changed' });
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
    if (this.stopped || this.deps.heldBack?.()) return;
    void this.mine().then((items) => {
      if (this.stopped || this.draining) return;
      const next = Math.min(
        ...items.filter((i) => startable(i) && !this.held.has(i.id)).map((i) => i.nextAt),
      );
      if (!Number.isFinite(next)) return;
      const schedule = this.deps.schedule ?? defaultSchedule;
      this.cancelTimer = schedule(Math.max(0, next - this.deps.now()), () => void this.kick());
    });
  }

  private async attempt(item: QueueItem): Promise<void> {
    if (item.kind === 'note') return this.attemptNote(item);
    const { store } = this.deps;
    const attempts = item.attempts + 1;
    try {
      // An Inbox item is not asked about: sent again to its batch under its
      // key, the vault answers with the item the first try made (I1).
      if (item.askFirst && item.kind !== 'inbox') {
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

  /**
   * A note (0.13.0): 'sending' first, before anything goes over the network,
   * so from then on it can't be changed or deleted (the store refuses both
   * while it is) — and its words are read only after that, so what goes is
   * exactly what its person last saved. Deleted before that: nothing is sent.
   */
  private async attemptNote(item: QueueItem): Promise<void> {
    const { store } = this.deps;
    const attempts = item.attempts + 1;
    if (!sameOwner(this.deps.who(), item)) return;
    this.inFlight.add(item.id);
    try {
      await store.update(item.id, { state: 'sending', attempts });
      this.deps.onEvent?.({ kind: 'changed' });
      const bytes = await store.bytes(item.id);
      if (!bytes) {
        this.deps.onEvent?.({ kind: 'changed' });
        return;
      }
      const made = await this.deps.send(item, bytes);
      await this.sent(item, made.document_id);
    } catch (err) {
      await this.failed(item, attempts, err);
    } finally {
      this.inFlight.delete(item.id);
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

  private async sent(item: QueueItem, documentId: string | null): Promise<void> {
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
    if (err instanceof ArrivedEarlierError) {
      // In the vault as it first went; the person's change waits for them (0.13.1).
      this.phoneSide.delete(item.id);
      await this.deps.store.update(item.id, {
        state: 'arrived',
        attempts,
        problem: err.code ? { status: err.code === 'created_not_visible' ? 404 : 422, code: err.code, message: null } : null,
      });
      this.deps.onEvent?.({ kind: 'changed' });
      return;
    }
    if (err instanceof NoAnswerError && err.retryInMs !== undefined) {
      // The vault answered "not yet" to a try under its key: again, under it, when it said.
      this.phoneSide.delete(item.id);
      return this.wait(item, { attempts, nextAt: this.deps.now() + err.retryInMs, lastCode: err.answer?.code ?? null });
    }
    if (err instanceof MaybeSentError) {
      // It went, or may have, and no answer came: never sent again by itself.
      this.phoneSide.delete(item.id);
      await this.deps.store.update(item.id, { state: 'unsure', attempts, problem: null });
      this.deps.onEvent?.({ kind: 'changed' });
      return;
    }
    if (err instanceof NotThisAccountError) {
      // Nothing was sent: the item stays exactly as it was, for its own person.
      await this.deps.store.update(item.id, { state: 'waiting' });
      this.deps.onEvent?.({ kind: 'changed' });
      return;
    }
    if (err instanceof ApiRequestError) {
      if (sessionHeld(err)) {
        // The app to be updated, or two-step sign-in to set up first (0.20.0):
        // nothing wrong with this one. It waits, and goes once that is put right.
        this.phoneSide.delete(item.id);
        return this.wait(item, { attempts, nextAt: later(err), lastCode: err.code });
      }
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
      if (err.status === 422 && err.code === 'invalid_extra' && Object.keys(item.metadata?.extra ?? {}).length > 0) {
        return this.withoutDetails(item, attempts, err.detail);
      }
      if (FINAL.has(err.status) || (err.status === 409 && !err.retriable)) {
        if (this.deps.amend && (await this.deps.amend(item, err))) {
          this.again = true;
          this.deps.onEvent?.({ kind: 'changed' });
          return;
        }
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
    if (noConnection(err)) {
      // No answer at all, or nothing sent (not the approved vault, not on
      // Wi-Fi): try again later, asking first — or as soon as that changes.
      this.phoneSide.add(item.id);
      return this.wait(item, { attempts, nextAt: later(err), lastCode: 'offline' });
    }
    // Neither the vault's answer nor the connection: the app's own fault
    // (0.3.2's missing `crypto` was one). Trying again by itself would only
    // fail the same way, forever and out of sight, so it waits for a
    // person, said plainly, and what went wrong is logged — the error's
    // kind, never the scan's details or the vault's words.
    this.phoneSide.delete(item.id);
    log.error('queue.send_failed', faultFields(err));
    await this.deps.store.update(item.id, {
      state: 'needs_you',
      attempts,
      problem: { status: 0, code: 'send_failed', message: null },
    });
    this.deps.onEvent?.({ kind: 'changed' });
  }

  /**
   * The vault no longer takes one of the scan's details (422
   * invalid_extra): its kind lost the field, or the answer, while the scan
   * waited on the phone. A scan is never lost for a detail — none is needed
   * to file one — so the detail it names, or every one when it names none,
   * is left out and remembered, to be said by its name, and the scan goes
   * again straight away under the same key: a refusal claims nothing.
   */
  private async withoutDetails(item: QueueItem, attempts: number, named: string | undefined): Promise<void> {
    const { extra = {}, ...rest } = item.metadata ?? {};
    const keys = Object.keys(extra);
    const gone = named !== undefined && keys.includes(named) ? [named] : keys;
    const left = Object.fromEntries(Object.entries(extra).filter(([k]) => !gone.includes(k)));
    await this.deps.store.update(item.id, {
      state: 'waiting',
      attempts,
      nextAt: 0,
      lastCode: 'invalid_extra',
      metadata: Object.keys(left).length > 0 ? { ...rest, extra: left } : rest,
      dropped: [...(item.dropped ?? []), ...gone],
    });
    this.again = true;
    this.deps.onEvent?.({ kind: 'changed' });
  }
}

/**
 * What is logged of a fault: the error's kind, and a ReferenceError's own
 * words, which name only the code's missing piece ("Property 'crypto'
 * doesn't exist"). Any other error's words may quote what it was handling
 * — a title, the vault's answer — so they are never logged.
 */
function faultFields(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) return { kind: typeof err };
  return err.name === 'ReferenceError' ? { kind: err.name, missing: err.message } : { kind: err.name };
}

function defaultSchedule(ms: number, fn: () => void): () => void {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
}
