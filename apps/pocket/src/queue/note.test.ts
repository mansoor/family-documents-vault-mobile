import { ApiRequestError, AppUpdateRequired, createHttp, type FetchLike } from '@fdv/client';
import { noConnection } from '../net/no-connection';
import { respond } from '../test-support/render';
import { noteBody, noteBytes, noteItem, readNote, sameBody, type KeyedTry, type NotePayload } from './note';
import {
  CreatedNotVisibleError,
  departure,
  idempotentCreate,
  KEY_SAFE_MS,
  keyLive,
  KeyReusedError,
  MAX_WAIT_MS,
  MaybeSentError,
  nextTry,
  NoAnswerError,
  NotSentError,
  postNote,
  refusedOutright,
  watched,
  type Departure,
  type NoteSending,
} from './note-send';

const payload: NotePayload = { title: 'Gate code', notes: 'The blue door.', visibility: 'private', clientId: 'c-1' };

describe('a note written offline, in the queue (0.13.0)', () => {
  it('is its bytes: what it says, who can see it and its client id, read back as written', () => {
    expect(readNote(noteBytes(payload))).toEqual(payload);
    expect(readNote(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(readNote(new TextEncoder().encode('null'))).toBeNull();
  });

  it('who can see it, unknown or missing, is Only me: never wider than was chosen', () => {
    const read = (json: string) => readNote(new TextEncoder().encode(json));
    expect(read('{"title":" ","notes":"x","visibility":"everyone"}')).toEqual({ title: null, notes: 'x', visibility: 'private' });
    expect(read('{"notes":"x"}')?.visibility).toBe('private');
    expect(read('{"notes":"x","visibility":"adults"}')?.visibility).toBe('adults');
  });

  it('waits to go, or waits for its person when it may already be in the vault; never asked about', () => {
    const base = { id: 'q', key: 'k', origin: 'https://vault.test', account: 'me', now: 1, size: 3 };
    expect(noteItem({ ...base, state: 'waiting' })).toEqual(
      expect.objectContaining({ kind: 'note', state: 'waiting', askFirst: false, metadata: null, key: 'k' }),
    );
    expect(noteItem({ ...base, state: 'unsure' }).state).toBe('unsure');
  });
});

describe('did it leave the phone? (never guessing it did not)', () => {
  it('never left: no name for the address, refused, unreachable, TLS refused, no network', () => {
    for (const words of [
      'Unable to resolve host "vault.example": No address associated with hostname',
      'getaddrinfo ENOTFOUND vault.example',
      'connect ECONNREFUSED 10.0.0.2:443',
      'Failed to connect to vault.example/10.0.0.2:443',
      'net::ERR_NAME_NOT_RESOLVED',
      'Network is unreachable',
      'SSL handshake aborted',
      'java.security.cert.CertPathValidatorException: Trust anchor for certification path not found.',
      'The Internet connection appears to be offline.',
    ]) {
      expect([words, departure(new TypeError(words), false)]).toEqual([words, 'never_left']);
    }
  });

  it('might have arrived: anything that can’t be told apart — and a timeout, always', () => {
    for (const words of [
      'Network request failed',
      'Failed to fetch',
      'Load failed',
      'fetch failed',
      'socket hang up',
      'Connection reset',
      // An SSL read that failed mid-answer: the request may well have gone.
      'javax.net.ssl.SSLException: Read error: ssl=0x7a: I/O error during system call, Connection reset by peer',
      'SSL_ERROR_SYSCALL',
    ]) {
      expect([words, departure(new TypeError(words), false)]).toEqual([words, 'maybe']);
    }
    // Given up on in time: it may have gone, whatever it says.
    expect(departure(new TypeError('Failed to connect'), true)).toBe('maybe');
  });

  it('a watched fetch says when it starts and how it ended', async () => {
    const seen: Departure[] = [];
    const ok: FetchLike = async () => respond(200, {});
    await watched(ok, (d) => seen.push(d))('https://v/x', { method: 'GET', headers: {} });
    const down: FetchLike = async () => {
      throw new TypeError('Unable to resolve host "v"');
    };
    await expect(watched(down, (d) => seen.push(d))('https://v/x', { method: 'GET', headers: {} })).rejects.toThrow();
    expect(seen).toEqual(['started', 'answered', 'started', 'never_left']);
  });
});

describe('postNote', () => {
  const KEYS = { features: { idempotent_create: true } };
  const NO_KEYS = { features: {} };
  /** A vault behind `fetch`; `caps` is what its capability document said just before (null: no answer). */
  const sending = (
    fetch: FetchLike,
    over: { caps?: { features: object } | null; prepare?: NoteSending['prepare'] } = {},
  ) => {
    const posted: { headers: Record<string, string>; body: unknown }[] = [];
    const spy: FetchLike = async (url, init) => {
      posted.push({ headers: init.headers, body: JSON.parse(String(init.body)) });
      return fetch(url, init);
    };
    const s: NoteSending = {
      http: (watch: (d: Departure) => void) => createHttp({ baseUrl: 'https://v', fetch: watched(spy, watch) }),
      answers: async () => (over.caps === undefined ? NO_KEYS : over.caps),
      token: 'tk',
      owner: 'me',
      key: 'c-1',
      ...(over.prepare ? { prepare: over.prepare } : {}),
    };
    return { posted, s };
  };
  const vaultSays =
    (status: number, code: string, retryAfter?: string): FetchLike =>
    async () =>
      respond(status, { error: { code, message: `The vault says ${code}.` } }, retryAfter ? { 'retry-after': retryAfter } : {});

  it('made: the new note, as its writer’s, with nothing of the key for a vault that keeps none', async () => {
    const { s, posted } = sending(async () => respond(201, { id: 'n1', etag: 'e1' }));
    expect(await postNote(payload, s)).toEqual({ id: 'n1', etag: 'e1', keyed: false });
    expect(posted[0]?.body).toEqual({
      type_key: 'note',
      title: 'Gate code',
      notes: 'The blue door.',
      visibility: 'private',
      owner_member_id: 'me',
    });
    expect(posted[0]?.headers['idempotency-key']).toBeUndefined();
  });

  it('the vault not answering just before: never sent, never tried — and never taken for one that keeps no key', async () => {
    let asked = false;
    const { s, posted } = sending(async () => respond(201, { id: 'n1' }), {
      caps: null,
      prepare: async () => {
        asked = true;
        return {};
      },
    });
    await expect(postNote(payload, s)).rejects.toBeInstanceOf(NotSentError);
    expect(posted).toEqual([]);
    expect(asked).toBe(false);
  });

  it('the key is decided by what the vault says in this try’s own look', async () => {
    const seen: boolean[] = [];
    const prepare = async (keyed: boolean) => {
      seen.push(keyed);
      return {};
    };
    const keyed = sending(async () => respond(201, { id: 'n1' }), { caps: KEYS, prepare });
    expect((await postNote(payload, keyed.s)).keyed).toBe(true);
    expect(keyed.posted[0]?.headers['idempotency-key']).toBe('c-1');
    const plain = sending(async () => respond(201, { id: 'n2' }), { caps: NO_KEYS, prepare });
    expect((await postNote(payload, plain.s)).keyed).toBe(false);
    expect(plain.posted[0]?.headers['idempotency-key']).toBeUndefined();
    expect(seen).toEqual([true, false]);
  });

  it('prepare may refuse the try: nothing goes', async () => {
    const { s, posted } = sending(async () => respond(201, { id: 'n1' }), {
      prepare: async () => {
        throw new MaybeSentError();
      },
    });
    await expect(postNote(payload, s)).rejects.toBeInstanceOf(MaybeSentError);
    expect(posted).toEqual([]);
  });

  it('the POST failed before it left: not sent; with no answer after it left, or a 5xx: might have arrived', async () => {
    const refused = sending(async () => {
      throw new TypeError('connect ECONNREFUSED');
    });
    await expect(postNote(payload, refused.s)).rejects.toBeInstanceOf(NotSentError);
    const lost = sending(async () => {
      throw new TypeError('Network request failed');
    });
    await expect(postNote(payload, lost.s)).rejects.toBeInstanceOf(MaybeSentError);
    for (const status of [500, 502, 503, 504]) {
      const gateway = sending(async () => respond(status, {}));
      await expect(postNote(payload, gateway.s)).rejects.toBeInstanceOf(MaybeSentError);
    }
  });

  it('a refusal is the vault’s, said as it is', async () => {
    const { s } = sending(async () => respond(403, { error: { code: 'forbidden', message: 'No.' } }));
    await expect(postNote(payload, s)).rejects.toEqual(expect.any(ApiRequestError));
  });

  it('under the key (0.9.0-dev.45): the body prepare gives goes, never what the note says now; prepared before anything goes', async () => {
    const order: string[] = [];
    const frozen = noteBody({ title: 'Gate code', notes: 'The red door.', visibility: 'private' }, 'me');
    const { s, posted } = sending(
      async () => {
        order.push('post');
        return respond(201, { id: 'n1' });
      },
      {
        caps: KEYS,
        prepare: async () => {
          order.push('frozen');
          return { body: frozen };
        },
      },
    );
    expect((await postNote(payload, s)).id).toBe('n1');
    expect(order).toEqual(['frozen', 'post']);
    expect(posted[0]?.body).toEqual(frozen);
    expect(posted[0]?.headers['idempotency-key']).toBe('c-1');
  });

  it('under the key: still being made (409), busy (503 busy_try_again) and any 5xx are no answer yet, never a refusal', async () => {
    for (const [status, code] of [
      [409, 'idempotency_in_progress'],
      [503, 'busy_try_again'],
      [500, 'internal'],
      [502, 'http_error'],
      [504, 'http_error'],
    ] as const) {
      const { s } = sending(vaultSays(status, code, '2'), { caps: KEYS });
      const err = await postNote(payload, s).catch((e: unknown) => e);
      expect([status, err]).toEqual([status, expect.any(NoAnswerError)]);
      expect((err as NoAnswerError).answer?.code).toBe(code);
      expect((err as NoAnswerError).answer?.retryAfterSeconds).toBe(2);
    }
    const lost = sending(
      async () => {
        throw new TypeError('Network request failed');
      },
      { caps: KEYS },
    );
    await expect(postNote(payload, lost.s)).rejects.toBeInstanceOf(NoAnswerError);
    expect(noConnection(new NoAnswerError())).toBe(true);
    expect(noConnection(new NotSentError())).toBe(true);
    expect(noConnection(new MaybeSentError())).toBe(false);
  });

  it('under the key: made and no longer theirs to see (404 created_not_visible); the key kept for other words (422)', async () => {
    const gone = sending(vaultSays(404, 'created_not_visible'), { caps: KEYS });
    await expect(postNote(payload, gone.s)).rejects.toBeInstanceOf(CreatedNotVisibleError);
    const reused = sending(vaultSays(422, 'idempotency_key_reused'), { caps: KEYS });
    await expect(postNote(payload, reused.s)).rejects.toBeInstanceOf(KeyReusedError);
    // Any other refusal is the vault's, as it says it.
    const refused = sending(vaultSays(403, 'forbidden'), { caps: KEYS });
    await expect(postNote(payload, refused.s)).rejects.toEqual(expect.objectContaining({ status: 403, code: 'forbidden' }));
    const notFound = sending(vaultSays(404, 'not_found'), { caps: KEYS });
    await expect(postNote(payload, notFound.s)).rejects.toEqual(expect.objectContaining({ status: 404, code: 'not_found' }));
  });

  it('a vault that keeps no key: as 0.13.0 — no header, a 409 a refusal and a 5xx might have arrived', async () => {
    const conflict = sending(vaultSays(409, 'idempotency_in_progress'));
    await expect(postNote(payload, conflict.s)).rejects.toEqual(expect.any(ApiRequestError));
    expect(conflict.posted[0]?.headers['idempotency-key']).toBeUndefined();
    expect(conflict.posted[0]?.body).toEqual(noteBody(payload, 'me'));
    const busyNow = sending(vaultSays(503, 'busy_try_again'));
    await expect(postNote(payload, busyNow.s)).rejects.toBeInstanceOf(MaybeSentError);
    expect(idempotentCreate({ features: { idempotent_create: true } })).toBe(true);
    expect(idempotentCreate({ features: {} })).toBe(false);
    expect(idempotentCreate(null)).toBe(false);
  });

  it('refused outright: any 4xx but signed out, a timeout, still being made, too many tries, and the key’s own answers', () => {
    const e = (status: number, code: string) => new ApiRequestError(status, code, 'x');
    for (const [status, code] of [
      [400, 'validation_failed'],
      [403, 'forbidden'],
      [404, 'not_found'],
      [410, 'gone'],
      [413, 'payload_too_large'],
      [415, 'unsupported_media_type'],
      [422, 'validation_failed'],
    ] as const) {
      expect([status, refusedOutright(e(status, code))]).toEqual([status, true]);
    }
    for (const [status, code] of [
      [401, 'session_ended'],
      [408, 'request_timeout'],
      [409, 'idempotency_in_progress'],
      [429, 'rate_limited'],
      [404, 'created_not_visible'],
      [422, 'idempotency_key_reused'],
      [500, 'internal'],
      // The app to be updated, or two-step sign-in to set up first (0.20.0): about the app, never the note.
      [403, 'two_step_setup_required'],
    ] as const) {
      expect([status, code, refusedOutright(e(status, code))]).toEqual([status, code, false]);
    }
    expect(refusedOutright(new AppUpdateRequired('Update the app.', '0.21.0'))).toBe(false);
  });
});

describe('a try under the key, and the next (0.13.1)', () => {
  const at = 1_000_000;
  const first: KeyedTry = { body: noteBody(payload, 'me'), firstAt: at, failed: 0, busy: 0 };
  const answer = (status: number, code: string, retryAfterSeconds?: number) =>
    new ApiRequestError(status, code, 'x', undefined, retryAfterSeconds === undefined ? {} : { retryAfterSeconds });

  it('is kept with the note, in its bytes, and read back as it went — with where it landed', () => {
    const p: NotePayload = { ...payload, sent: first, landed: { id: 'n1', etag: 'e1', visibility: 'private' } };
    expect(readNote(noteBytes(p))).toEqual(p);
    // Not one: left out, never guessed at.
    const odd = new TextEncoder().encode(JSON.stringify({ ...payload, sent: { body: { title: 1 }, firstAt: 'x' } }));
    expect(readNote(odd)).toEqual(payload);
    expect(sameBody(first.body, noteBody({ ...payload, title: '  Gate code ' }, 'me'))).toBe(true);
    expect(sameBody(first.body, noteBody({ ...payload, notes: 'The red door.' }, 'me'))).toBe(false);
  });

  it('still being made, or busy: after the vault’s Retry-After, twice as long each time, at most 5 minutes apart', () => {
    let t = first;
    const waits: (number | null)[] = [];
    for (let i = 0; i < 10; i += 1) {
      const next = nextTry(t, answer(409, 'idempotency_in_progress', 2), at);
      waits.push(next.inMs);
      t = next.tried;
    }
    expect(waits).toEqual([2000, 4000, 8000, 16000, 32000, 64000, 128000, 256000, MAX_WAIT_MS, MAX_WAIT_MS]);
    expect(nextTry(first, answer(503, 'busy_try_again', 1), at).inMs).toBe(1000);
  });

  it('a 5xx, a gateway’s too: tried again for as long as the vault keeps the key — bounded by its day, not a count', () => {
    let t = first;
    let clock = at;
    let tries = 0;
    for (;;) {
      const next = nextTry(t, answer(502, 'http_error'), clock);
      tries += 1;
      t = next.tried;
      if (next.inMs === null) break;
      clock += next.inMs;
    }
    expect(clock - at).toBeLessThanOrEqual(KEY_SAFE_MS);
    expect(clock - at).toBeGreaterThan(KEY_SAFE_MS - MAX_WAIT_MS);
    expect(tries).toBeGreaterThan(200);
    expect(t.failed).toBe(tries);
  });

  it('never more than 23 hours after the first try, nor with the clock put back before it', () => {
    expect(keyLive(first, at + KEY_SAFE_MS)).toBe(true);
    expect(keyLive(first, at + KEY_SAFE_MS + 1)).toBe(false);
    expect(keyLive(first, at - 1)).toBe(false);
    expect(nextTry(first, answer(500, 'internal'), at + KEY_SAFE_MS - 1000).inMs).toBeNull();
    expect(nextTry(first, answer(500, 'internal'), at + KEY_SAFE_MS - 3000).inMs).toBe(2000);
  });
});
