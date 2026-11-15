import { NetworkError, type FetchLike, type ResponseLike } from '@fdv/client';

/**
 * How long the phone waits for the vault (0.13.0: the owner, somewhere the
 * vault could not be reached, found screens that seemed stuck).
 *
 * - An ordinary request — a list, a document, a save — is given up after
 *   REQUEST_TIMEOUT_MS with no answer: the client's own AbortController
 *   (createHttp's `timeoutMs`). On a phone its fetch answers once the whole
 *   body is in, so that is the whole request.
 * - A download (a file, a page, a picture: the client's `raw`, which asks
 *   for any type) is given the same time to start answering, and then only
 *   gives up when no bytes have come for STALL_MS: a large file on a slow
 *   line still arrives, and one that stopped coming does not hang (stalled).
 * - An upload's body goes in one piece (expo/fetch reads it whole before
 *   sending, and says nothing as it goes), so no progress can be seen: it is
 *   given STALL_MS, plus as long as its bytes take at the slowest uplink worth
 *   waiting for (state/vault.tsx, withSizedTimeout).
 */
export const REQUEST_TIMEOUT_MS = 15_000;
export const STALL_MS = 30_000;

/** A request for a file, not for JSON: the client's `raw` asks for any type. */
export const isDownload = (init: { headers: Record<string, string> }) => init.headers.accept === '*/*';

/** JSON by one fetch, files by another (state/vault.tsx: expo/fetch, whose bodies come as they arrive). */
export function routeDownloads(json: FetchLike, download: FetchLike): FetchLike {
  return (url, init) => (isDownload(init) ? download(url, init) : json(url, init));
}

interface Reader {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
  cancel(reason?: unknown): Promise<void>;
}
interface Streamed {
  body?: { getReader(): Reader } | null;
}
interface Abortable {
  aborted: boolean;
  addEventListener?: (type: 'abort', fn: () => void) => void;
  removeEventListener?: (type: 'abort', fn: () => void) => void;
}

type Schedule = (ms: number, fn: () => void) => () => void;
const defaultSchedule: Schedule = (ms, fn) => {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
};

/**
 * A fetch whose answer's body is read with a watch on it: STALL_MS with no
 * new bytes and the request is ended, as no answer (NetworkError 'timeout').
 * Where the platform gives no body to read as it comes (a phone's own fetch
 * has it all already), the body is read as before.
 */
export function withStallGuard(send: FetchLike, opts: { stallMs?: number; schedule?: Schedule } = {}): FetchLike {
  const stallMs = opts.stallMs ?? STALL_MS;
  const schedule = opts.schedule ?? defaultSchedule;
  return async (url, init) => {
    const controller = new AbortController();
    // The client's own timer (no answer at all) still ends it — until the
    // answer comes, when the client lets its timer go, and so does this.
    const outer = init.signal as Abortable | undefined;
    const forward = () => controller.abort();
    if (outer?.aborted) controller.abort();
    outer?.addEventListener?.('abort', forward);
    let res: ResponseLike;
    try {
      res = await send(url, { ...init, signal: controller.signal });
    } finally {
      outer?.removeEventListener?.('abort', forward);
    }
    const stream = (res as ResponseLike & Streamed).body;
    if (!stream || typeof stream.getReader !== 'function') return res;
    let read: Promise<Uint8Array> | null = null;
    const bytes = () => {
      read ??= readWatched(stream.getReader(), stallMs, schedule, () => controller.abort());
      return read;
    };
    return {
      ok: res.ok,
      status: res.status,
      headers: res.headers,
      arrayBuffer: async () => {
        const b = await bytes();
        // The bytes' own buffer when it is just them; a copy of just them otherwise.
        if (b.byteOffset === 0 && b.byteLength === b.buffer.byteLength) return b.buffer as ArrayBuffer;
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
      },
      text: async () => new TextDecoder().decode(await bytes()),
      json: async () => JSON.parse(new TextDecoder().decode(await bytes())) as unknown,
    };
  };
}

async function readWatched(reader: Reader, stallMs: number, schedule: Schedule, abort: () => void): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  let stalled = false;
  let cancel: () => void = () => undefined;
  const watch = () => {
    cancel();
    cancel = schedule(stallMs, () => {
      stalled = true;
      abort();
      void reader.cancel().catch(() => undefined);
    });
  };
  watch();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (stalled) throw new NetworkError('timeout');
      if (done) break;
      if (value) {
        chunks.push(value);
        size += value.byteLength;
      }
      watch();
    }
  } catch (err) {
    if (stalled || err instanceof NetworkError) throw new NetworkError('timeout');
    throw new NetworkError('offline');
  } finally {
    cancel();
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}
