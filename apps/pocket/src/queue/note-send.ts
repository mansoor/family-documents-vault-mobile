import { ApiRequestError, type FetchLike, type Http } from '@fdv/client';
import type { DocumentView } from '@fdv/shared';
import { sessionHeld } from '../update/held';
import { noteBody, type KeyedTry, type Landed, type NoteBody, type NotePayload } from './note';

export type { Landed } from './note';

/**
 * Sending a note written on this phone (0.13.0), and telling — when no
 * answer comes — whether it ever left.
 *
 * Every try asks the vault first (its capability document), and what that
 * answer says decides how the note goes (0.13.1): under its Idempotency-Key
 * when it says `features.idempotent_create`, without one when it says
 * nothing of it. No answer, and nothing is sent: the phone never takes a
 * vault it hasn't heard from for one that keeps no key.
 *
 * - **Never left** (NotSentError): the vault did not answer just before, or
 *   the POST failed before it could be sent — no name for the address, the
 *   connection refused, a TLS handshake or a certificate refused, no
 *   network — or was never started. Tried again by itself, as a scan is.
 *
 * A vault that keeps no key (before 0.9.0-dev.45): a note that may have
 * arrived is never sent again without its person.
 *
 * - **Might have arrived** (MaybeSentError): the POST went, or may have,
 *   and no answer came — given up on in time, the connection lost, a
 *   failure the platform can't name ("Network request failed"), or a 5xx
 *   (a proxy's 502/503/504 among them). The person decides.
 *
 * A vault that keeps the key (0.9.0-dev.45) gets the note's client id as
 * its Idempotency-Key, with the body exactly as it first went under it
 * (`KeyedTry`, frozen with the key in the note's encrypted bytes before
 * anything goes), so every try of the key is the same request:
 *
 * - **No answer** (NoAnswerError): lost, a 5xx, or the vault still making
 *   the first try (409 idempotency_in_progress) or busy a moment (503
 *   busy_try_again). Sent again by itself under the same key — after the
 *   vault's Retry-After, longer each time, at most 5 minutes apart — for as
 *   long as the vault keeps the key. Never a refusal.
 * - **Made, and no longer the writer's to see** (CreatedNotVisibleError,
 *   404 created_not_visible): the first try made it. Sent; never again.
 * - **The key kept for other words** (KeyReusedError, 422
 *   idempotency_key_reused): an earlier version is in the vault.
 * - The vault keeps a key 24 hours: no try goes by itself more than 23
 *   hours after the first (or with the phone's clock put back before it).
 *   It is "Might already be in your vault" then, for its person.
 */

/** Nothing reached the vault: the note waits, and goes by itself. */
export class NotSentError extends Error {
  constructor() {
    super('The note was not sent.');
    this.name = 'NotSentError';
  }
}

/**
 * No answer to a note sent under its Idempotency-Key: safe to send again, so
 * it goes again by itself, under the same key — as if offline when nothing
 * came back, or after `retryInMs` when the vault answered "not yet" (a 5xx,
 * 409 idempotency_in_progress, 503 busy_try_again: `answer`).
 */
export class NoAnswerError extends Error {
  constructor(
    readonly answer?: ApiRequestError,
    readonly retryInMs?: number,
  ) {
    super('No answer: the note goes again under its key.');
    this.name = 'NoAnswerError';
  }
}

/** It went, or may have, and no answer came: it may already be in the vault. */
export class MaybeSentError extends Error {
  constructor() {
    super('The note may have reached the vault.');
    this.name = 'MaybeSentError';
  }
}

/** 404 created_not_visible: the first try under the key made the note, and its writer can no longer see it. */
export class CreatedNotVisibleError extends Error {
  constructor() {
    super('The note reached the vault, and is no longer theirs to see.');
    this.name = 'CreatedNotVisibleError';
  }
}

/** 422 idempotency_key_reused: the key made a note with other words. */
export class KeyReusedError extends Error {
  constructor() {
    super('An earlier version of the note is in the vault.');
    this.name = 'KeyReusedError';
  }
}

/**
 * The vault has the note as it first went, and the person changed it since
 * (or the vault kept another version under its key): their change stays on
 * the phone for them — put into that note, sent as a new note, or
 * discarded, as they say. `code`: why, when the vault said; null for a note
 * made as it first went, which `landed` names.
 */
export class ArrivedEarlierError extends Error {
  constructor(
    readonly code: 'created_not_visible' | 'idempotency_key_reused' | null,
    readonly landed: Landed | null = null,
  ) {
    super('The note reached the vault with its earlier words.');
    this.name = 'ArrivedEarlierError';
  }
}

export type Departure = 'started' | 'answered' | 'never_left' | 'maybe';

/**
 * A failed fetch's own words that mean the request never left the phone:
 * the address not found, the connection refused or unreachable, a TLS
 * handshake or a certificate refused, no network. Anything else — React
 * Native's "Network request failed", a reset, an abort, an SSL read that
 * failed mid-answer — can't be told apart, and may have arrived.
 */
const NEVER_LEFT =
  /unable to resolve host|ENOTFOUND|EAI_AGAIN|getaddrinfo|name not resolved|ERR_NAME_NOT_RESOLVED|ECONNREFUSED|connection refused|ERR_CONNECTION_REFUSED|failed to connect|could not connect|EHOSTUNREACH|ENETUNREACH|network is unreachable|no route to host|handshake|certificate|CERT_|trust anchor|internet connection appears to be offline|not connected to the internet/i;

export function departure(err: unknown, aborted: boolean): 'never_left' | 'maybe' {
  if (aborted) return 'maybe';
  const words = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return NEVER_LEFT.test(words) ? 'never_left' : 'maybe';
}

/** A fetch that says when it starts, and — failing — whether the request may have left. */
export function watched(send: FetchLike, watch: (d: Departure) => void): FetchLike {
  return async (url, init) => {
    watch('started');
    try {
      const res = await send(url, init);
      watch('answered');
      return res;
    } catch (err) {
      watch(departure(err, (init.signal as { aborted?: boolean } | undefined)?.aborted === true));
      throw err;
    }
  };
}

export interface NoteSending {
  /** The vault's http, its fetch watched by `watch`. */
  http: (watch: (d: Departure) => void) => Http | null;
  /** The vault's capability document, asked now (nothing secret); null when it did not answer. */
  answers: () => Promise<{ features: object } | null>;
  token: string;
  /** Whose note it is: the person who wrote it. */
  owner: string;
  /** Its client id: the Idempotency-Key, where the vault takes one. */
  key: string;
  /**
   * Once the vault has answered, and before anything goes: told whether this
   * try goes under the key, it may refuse the try (a note sent once under a
   * key never goes without one), and gives the body frozen with the key.
   */
  prepare?: (keyed: boolean) => Promise<{ body?: NoteBody }>;
}

/** What became of a POST /documents for a note: the new note, and whether it went under the key. */
export interface Posted {
  id: string;
  etag: string | null;
  keyed: boolean;
}

/** POST /documents for a note; the new note, or why not (the errors above, or the vault's refusal). */
export async function postNote(p: NotePayload, s: NoteSending): Promise<Posted> {
  const caps = await s.answers();
  if (!caps) throw new NotSentError();
  const keyed = idempotentCreate(caps);
  const how = (await s.prepare?.(keyed)) ?? {};
  let left: Departure | null = null;
  const http = s.http((d) => {
    left = d;
  });
  if (!http) throw new NotSentError();
  try {
    const made = await http.request<DocumentView>('/api/v1/documents', {
      method: 'POST',
      token: s.token,
      body: keyed && how.body ? how.body : noteBody(p, s.owner),
      ...(keyed ? { headers: { 'idempotency-key': s.key } } : {}),
    });
    return { id: made.id, etag: typeof made.etag === 'string' ? made.etag : null, keyed };
  } catch (err) {
    if (err instanceof ApiRequestError) {
      if (keyed) {
        // The vault's answers to a key: made, and no longer theirs to see;
        // the key kept for other words; still being made, or busy, or a
        // 5xx — after which the same key is safe to send again.
        if (err.status === 404 && err.code === 'created_not_visible') throw new CreatedNotVisibleError();
        if (err.status === 422 && err.code === 'idempotency_key_reused') throw new KeyReusedError();
        if (busy(err) || err.status >= 500) throw new NoAnswerError(err);
        throw err;
      }
      // The vault, or something in front of it, answered: a refusal is the
      // vault's to say; a 5xx may have come after the note was made.
      if (err.status < 500) throw err;
      throw new MaybeSentError();
    }
    const where = left as Departure | null;
    if (where === null || where === 'never_left') throw new NotSentError();
    // Under its Idempotency-Key it is safe to send again: no answer, and it waits as if offline.
    if (keyed) throw new NoAnswerError();
    throw new MaybeSentError();
  }
}

/** "Still being made" (409 idempotency_in_progress) or "busy a moment" (503 busy_try_again): never a refusal. */
export const busy = (err: ApiRequestError): boolean =>
  (err.status === 409 && err.code === 'idempotency_in_progress') || (err.status === 503 && err.code === 'busy_try_again');

/**
 * The vault refused the request itself, under its key (dev.45 checks the
 * request, and who may make it, before the key): nothing was made by this
 * try. Not a signed-out answer (401), a timeout (408), "still being made",
 * too many tries (429), or the key's own answers, which say nothing of that.
 */
export function refusedOutright(err: unknown): boolean {
  if (!(err instanceof ApiRequestError) || err.status < 400 || err.status >= 500) return false;
  // The app to be updated, or two-step sign-in to set up first (0.20.0): about the app, not the note.
  if (sessionHeld(err)) return false;
  if (err.status === 401 || err.status === 408 || err.status === 429 || busy(err)) return false;
  if (err.code === 'created_not_visible' || err.code === 'idempotency_key_reused') return false;
  return true;
}

/** The vault keeps a key 24 hours: nothing goes by itself under one more than 23 hours after its first try. */
export const KEY_SAFE_MS = 23 * 60 * 60 * 1000;
/** The longest wait between tries under a key. */
export const MAX_WAIT_MS = 5 * 60 * 1000;

/**
 * Whether a try under this key may still go by itself: within 23 hours of
 * its first — and not with the phone's clock put back before that first
 * try, when the 23 hours can't be told.
 */
export const keyLive = (t: Pick<KeyedTry, 'firstAt'>, now: number): boolean =>
  now >= t.firstAt && now - t.firstAt <= KEY_SAFE_MS;

/**
 * The vault answered a try under the key "not yet" (a 5xx, still being
 * made, busy): safe to send again under it. The try counted, and when to go
 * again — the vault's Retry-After, doubled each time it says so again, at
 * most 5 minutes — or null when the next try would come more than 23 hours
 * after the first.
 */
export function nextTry(t: KeyedTry, answer: ApiRequestError, now: number): { tried: KeyedTry; inMs: number | null } {
  const isBusy = busy(answer);
  const tried: KeyedTry = { ...t, failed: t.failed + (isBusy ? 0 : 1), busy: t.busy + (isBusy ? 1 : 0) };
  const n = isBusy ? tried.busy : tried.failed;
  const base = (answer.retryAfterSeconds ?? (isBusy ? 1 : 2)) * 1000;
  const inMs = Math.min(base * 2 ** Math.min(n - 1, 16), MAX_WAIT_MS);
  return { tried, inMs: keyLive(t, now + inMs) ? inMs : null };
}

/** Whether the vault takes a new note's Idempotency-Key (0.9.0-dev.45). */
export function idempotentCreate(caps: { features: object } | null | undefined): boolean {
  return (caps?.features as Record<string, unknown> | undefined)?.idempotent_create === true;
}
