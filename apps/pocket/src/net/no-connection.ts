import { NetworkError } from '@fdv/client';

/**
 * Whether a failure is the phone's connection, and nothing else: no answer
 * from the vault (the client's NetworkError — offline, or too slow to
 * answer), or nothing sent because the phone may not send here and now
 * (state/vault.tsx: something other than the vault answering at its
 * address, an http vault off Wi-Fi), or a fetch that failed on the network
 * before the client could say so. Only these are waited out quietly, to go
 * by themselves when the connection comes back.
 *
 * Anything else — a ReferenceError, a TypeError that is not a fetch's, a
 * phone that cannot read its own queue — is a fault, never "no
 * connection": waiting for a connection would wait forever, as every scan
 * did on 0.3.2, when the shared code wanted a `crypto` Hermes did not
 * have and the queue said "will go by itself".
 */
export function noConnection(err: unknown): boolean {
  if (err instanceof NetworkError) return true;
  if (!(err instanceof Error)) return false;
  // By name, as errors/words.ts does: the queue need not load the vault's state.
  if (PHONE_REFUSED.has(err.name)) return true;
  // An aborted or timed-out fetch (a DOMException on the web, an Error elsewhere).
  if (err.name === 'AbortError' || err.name === 'TimeoutError') return true;
  // A fetch that found no network: React Native's, the browsers', OkHttp's and Node's words for it.
  return err.name === 'TypeError' && FETCH_FAILED.test(err.message);
}

const PHONE_REFUSED: ReadonlySet<string> = new Set(['StrangerError', 'WifiOnlyError']);

const FETCH_FAILED =
  /network request failed|failed to fetch|fetch failed|networkerror|load failed|network connection was lost|internet connection|unable to resolve host|failed to connect|connection (?:refused|reset|abort)|timed? ?out|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT/i;
