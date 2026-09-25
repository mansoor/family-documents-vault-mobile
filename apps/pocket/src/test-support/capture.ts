import { createApi, createHttp, type Api, type FetchLike, type ResponseLike } from '@fdv/client';
import { createFakeVault } from '@fdv/client/testing';
import type { Tokens } from '@fdv/shared';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { QueueItem } from '../queue/item';
import type { UploaderDeps } from '../queue/uploader';

/** The scanner's pages, as the tests hand them over: real JPEGs from the PDF tests. */
export const jpeg = (name: 'letter-with-exif.jpg' | 'card.jpg') =>
  new Uint8Array(readFileSync(join(__dirname, '..', 'pdf', '__fixtures__', name)));

export function reply(status: number, body: unknown, headers: Record<string, string> = {}): ResponseLike {
  const text = JSON.stringify(body);
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status < 400,
    status,
    headers: {
      get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : (lower[h.toLowerCase()] ?? null)),
    },
    json: async () => JSON.parse(text) as unknown,
    text: async () => text,
    arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer,
  };
}

/** What the vault does with each capture request, in order; then it behaves. */
export type Turn = 'ok' | 'lost' | 'offline' | { status: number; code: string; message?: string; retryAfter?: number };

export interface CaptureVault {
  vault: ReturnType<typeof createFakeVault>;
  api: Api;
  token: string;
  /** Scripted answers to POST /capture. */
  turns: Turn[];
  calls: string[];
  deps(store: UploaderDeps['store'], over?: Partial<UploaderDeps>): UploaderDeps;
}

/**
 * The client's fake vault, signed in, with POST /capture answering as the
 * test says: a lost answer (the vault made it, the phone never heard), no
 * connection at all, or a refusal with the vault's code and Retry-After.
 */
export async function captureVault(origin = 'https://vault.test'): Promise<CaptureVault> {
  const vault = createFakeVault();
  vault.state.setupRequired = false;
  vault.state.email = 'owner@example.test';
  vault.state.password = 'correct horse battery staple';
  const cv = {
    vault,
    turns: [] as Turn[],
    calls: [] as string[],
  } as unknown as CaptureVault;
  const fetch: FetchLike = async (url, init) => {
    const path = url.slice(origin.length).split('?')[0] ?? '';
    cv.calls.push(`${init.method} ${path}`);
    if (path === '/api/v1/capture') {
      const turn = cv.turns.shift() ?? 'ok';
      if (turn === 'offline') throw new TypeError('Network request failed');
      if (turn === 'lost') {
        await vault.fetch(url, init);
        throw new TypeError('Network request failed');
      }
      if (turn !== 'ok') {
        return reply(
          turn.status,
          {
            error: {
              code: turn.code,
              message: turn.message ?? 'No.',
              retriable: turn.status >= 500 || turn.status === 429,
            },
          },
          turn.retryAfter === undefined ? {} : { 'retry-after': String(turn.retryAfter) },
        );
      }
    }
    return vault.fetch(url, init);
  };
  cv.api = createApi(createHttp({ baseUrl: origin, fetch }));
  const t = (await cv.api.signIn('owner@example.test', 'correct horse battery staple')) as Tokens;
  cv.token = t.access_token;
  cv.deps = (store, over = {}) => ({
    store,
    send: (item: QueueItem, bytes: Uint8Array) =>
      cv.api.capture(
        cv.token,
        {
          file: {
            kind: 'bytes',
            filename: item.filename,
            contentType: item.mime,
            bytes,
          },
          ...(item.metadata ? { metadata: item.metadata } : {}),
        },
        item.key,
      ),
    status: (item: QueueItem) => cv.api.uploadStatus(cv.token, item.key),
    who: () => ({ origin, account: 'fake-member' }),
    now: () => 0,
    random: () => 0.5,
    schedule: () => () => undefined,
    ...over,
  });
  return cv;
}
