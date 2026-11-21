import type { FetchLike, ResponseLike } from '@fdv/client';

/**
 * How long a 429 asks to wait, when the Retry-After header can't be read
 * (0.20.0). A browser shows a page from another origin only the headers the
 * server lists as exposed, so the web build may get a 429 with no
 * Retry-After at all; the vault says the same in its envelope too, as
 * `error.retry_after` (seconds). Only a 429 without the header is read here,
 * once, and handed on with the header filled in and its body intact.
 */
export function withRetryAfterFromBody(send: FetchLike): FetchLike {
  return async (url, init) => {
    const res = await send(url, init);
    if (res.status !== 429 || res.headers.get('retry-after') !== null) return res;
    let text = '';
    try {
      text = await res.text();
    } catch {
      return res;
    }
    let seconds: number | null = null;
    try {
      const body = JSON.parse(text) as { error?: { retry_after?: unknown } };
      const said = body.error?.retry_after;
      if (typeof said === 'number' && Number.isFinite(said) && said >= 0) seconds = Math.ceil(said);
    } catch {
      // Not the vault's envelope: no wait to read from it.
    }
    const out: ResponseLike = {
      ok: res.ok,
      status: res.status,
      headers: {
        get: (name) =>
          name.toLowerCase() === 'retry-after' && seconds !== null ? String(seconds) : res.headers.get(name),
      },
      json: async () => JSON.parse(text) as unknown,
      text: async () => text,
      arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer,
    };
    return out;
  };
}
