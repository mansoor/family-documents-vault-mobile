import { ApiRequestError, type FetchLike, type Http } from '@fdv/client';
import { NOTE_KIND, type DocumentView } from '@fdv/shared';
import type { NotePayload } from './note';

/**
 * Sending a note written on this phone (0.13.0), and telling — when no
 * answer comes — whether it ever left. The vault's POST /documents takes no
 * idempotency key yet, so a note that may have arrived is never sent again
 * without its person: the phone does not guess.
 *
 * - **Never left** (NotSentError): the vault did not answer just before
 *   (the capability document, asked first), or the POST failed before it
 *   could be sent — no name for the address, the connection refused, a
 *   certificate refused, no network — or was never started. Tried again by
 *   itself, as a scan is.
 * - **Might have arrived** (MaybeSentError): the POST went, or may have,
 *   and no answer came — given up on in time, the connection lost, a
 *   failure the platform can't name ("Network request failed"), or a 5xx
 *   (a proxy's 502/503/504 among them). The person decides.
 *
 * A vault that says `features.idempotent_create` gets the note's client id
 * as its Idempotency-Key, and then "might have arrived" is simply sent again.
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
 * it waits as if offline and goes again by itself, under the same key.
 */
export class NoAnswerError extends Error {
  constructor() {
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

export type Departure = 'started' | 'answered' | 'never_left' | 'maybe';

/**
 * A failed fetch's own words that mean the request never left the phone:
 * the address not found, the connection refused or unreachable, TLS
 * refused, no network. Anything else — React Native's "Network request
 * failed", a reset, an abort — can't be told apart, and may have arrived.
 */
const NEVER_LEFT =
  /unable to resolve host|ENOTFOUND|EAI_AGAIN|getaddrinfo|name not resolved|ERR_NAME_NOT_RESOLVED|ECONNREFUSED|connection refused|ERR_CONNECTION_REFUSED|failed to connect|could not connect|EHOSTUNREACH|ENETUNREACH|network is unreachable|no route to host|SSL|TLS|certificate|CERT_|handshake|trust anchor|internet connection appears to be offline|not connected to the internet/i;

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
  /** Whether the vault answers now (its capability document: nothing secret). */
  answers: () => Promise<boolean>;
  token: string;
  /** Whose note it is: the person who wrote it. */
  owner: string;
  /** Its client id: the Idempotency-Key, where the vault takes one. */
  key: string;
  idempotent: boolean;
}

/** POST /documents for a note; the new note's id, or why not (NotSentError, MaybeSentError, the vault's refusal). */
export async function postNote(p: NotePayload, s: NoteSending): Promise<string> {
  if (!(await s.answers())) throw new NotSentError();
  let left: Departure | null = null;
  const http = s.http((d) => {
    left = d;
  });
  if (!http) throw new NotSentError();
  try {
    const made = await http.request<DocumentView>('/api/v1/documents', {
      method: 'POST',
      token: s.token,
      body: {
        type_key: NOTE_KIND,
        title: p.title?.trim() || null,
        notes: p.notes?.trim() || null,
        visibility: p.visibility,
        owner_member_id: s.owner,
      },
      ...(s.idempotent ? { headers: { 'idempotency-key': s.key } } : {}),
    });
    return made.id;
  } catch (err) {
    if (err instanceof ApiRequestError) {
      // The vault, or something in front of it, answered: a refusal is the
      // vault's to say; a 5xx may have come after the note was made.
      if (err.status < 500) throw err;
      if (s.idempotent) throw new NoAnswerError();
      throw new MaybeSentError();
    }
    const where = left as Departure | null;
    if (where === null || where === 'never_left') throw new NotSentError();
    // Under its Idempotency-Key it is safe to send again: no answer, and it waits as if offline.
    if (s.idempotent) throw new NoAnswerError();
    throw new MaybeSentError();
  }
}

/** Whether the vault takes a new note's Idempotency-Key (a later vault; not yet). */
export function idempotentCreate(caps: { features: object } | null | undefined): boolean {
  return (caps?.features as Record<string, unknown> | undefined)?.idempotent_create === true;
}
