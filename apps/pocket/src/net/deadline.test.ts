import { NetworkError, type FetchLike, type ResponseLike } from '@fdv/client';
import { isDownload, routeDownloads, withStallGuard } from './deadline';

/** A body that gives `chunks`, then — when `stall` — nothing more, ever, until it is cancelled. */
function body(chunks: Uint8Array[], stall: boolean) {
  let i = 0;
  let cancelled: (() => void) | null = null;
  return {
    getReader: () => ({
      read: () => {
        if (i < chunks.length) return Promise.resolve({ done: false, value: chunks[i++] });
        if (!stall) return Promise.resolve({ done: true });
        return new Promise<{ done: boolean }>((resolve) => {
          cancelled = () => resolve({ done: true });
        });
      },
      cancel: async () => cancelled?.(),
    }),
  };
}

/** A clock the test moves: what is due runs when it is moved past. */
function clock() {
  let now = 0;
  const due = new Map<number, { at: number; fn: () => void }>();
  let n = 0;
  return {
    schedule: (ms: number, fn: () => void) => {
      const id = ++n;
      due.set(id, { at: now + ms, fn });
      return () => void due.delete(id);
    },
    advance: (ms: number) => {
      now += ms;
      for (const [id, d] of [...due]) {
        if (d.at <= now) {
          due.delete(id);
          d.fn();
        }
      }
    },
  };
}

const answer = (b: ReturnType<typeof body>): ResponseLike & { body: unknown } => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  json: async () => ({}),
  text: async () => '',
  arrayBuffer: async () => new ArrayBuffer(0),
  body: b,
});

describe('a download watched as it comes (0.13.0)', () => {
  it('arrives whole however long it takes, while bytes keep coming', async () => {
    const c = clock();
    const send: FetchLike = async () => answer(body([new Uint8Array([1, 2]), new Uint8Array([3])], false));
    const res = await withStallGuard(send, { stallMs: 30_000, schedule: c.schedule })('https://v/x', {
      method: 'GET',
      headers: { accept: '*/*' },
    });
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('given up once nothing has come for the stall time: no answer, said as a timeout, and the request ended', async () => {
    const c = clock();
    let signal: AbortSignal | undefined;
    const send: FetchLike = async (_url, init) => {
      signal = init.signal as AbortSignal;
      return answer(body([new Uint8Array([1])], true));
    };
    const res = await withStallGuard(send, { stallMs: 30_000, schedule: c.schedule })('https://v/x', {
      method: 'GET',
      headers: { accept: '*/*' },
    });
    const reading = res.arrayBuffer();
    // Let the first chunk be read before the clock moves.
    await Promise.resolve();
    await Promise.resolve();
    c.advance(29_000);
    expect(signal?.aborted).toBe(false);
    c.advance(1_000);
    await expect(reading).rejects.toEqual(new NetworkError('timeout'));
    expect(signal?.aborted).toBe(true);
  });

  it('the client giving up before an answer ends the request too; once the answer is in, it stops listening', async () => {
    const outer = new AbortController();
    const listening = { added: 0, removed: 0 };
    const signal = {
      get aborted() {
        return outer.signal.aborted;
      },
      addEventListener: (type: 'abort', fn: () => void) => {
        listening.added += 1;
        outer.signal.addEventListener(type, fn);
      },
      removeEventListener: (type: 'abort', fn: () => void) => {
        listening.removed += 1;
        outer.signal.removeEventListener(type, fn);
      },
    };
    let inner: AbortSignal | undefined;
    const waits: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        inner = init.signal as AbortSignal;
        inner.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })));
      });
    const going = withStallGuard(waits)('https://v/x', { method: 'GET', headers: { accept: '*/*' }, signal });
    outer.abort();
    await expect(going).rejects.toThrow('Aborted');
    expect(inner?.aborted).toBe(true);
    expect(listening).toEqual({ added: 1, removed: 1 });

    // Answered: let go at once, the bytes' own buffer given back whole.
    const answered = { added: 0, removed: 0 };
    const quiet = {
      aborted: false,
      addEventListener: () => void (answered.added += 1),
      removeEventListener: () => void (answered.removed += 1),
    };
    const one = new Uint8Array([4, 5]);
    const res = await withStallGuard(async () => answer(body([one], false)))('https://v/x', {
      method: 'GET',
      headers: { accept: '*/*' },
      signal: quiet,
    });
    expect(answered).toEqual({ added: 1, removed: 1 });
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(one);
  });

  it('a fetch with no body to read as it comes (a phone’s own, with it all already) is read as before', async () => {
    const plain: ResponseLike = {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ a: 1 }),
      text: async () => '',
      arrayBuffer: async () => new ArrayBuffer(0),
    };
    const res = await withStallGuard(async () => plain)('https://v/x', { method: 'GET', headers: {} });
    expect(await res.json()).toEqual({ a: 1 });
  });

  it('files go by the download fetch, JSON by the ordinary one', async () => {
    const seen: string[] = [];
    const json: FetchLike = async (url) => (seen.push(`json ${url}`), answer(body([], false)));
    const file: FetchLike = async (url) => (seen.push(`file ${url}`), answer(body([], false)));
    const route = routeDownloads(json, file);
    await route('/a', { method: 'GET', headers: { accept: 'application/json' } });
    await route('/b', { method: 'GET', headers: { accept: '*/*' } });
    expect(seen).toEqual(['json /a', 'file /b']);
    expect(isDownload({ headers: { accept: '*/*' } })).toBe(true);
  });
});
