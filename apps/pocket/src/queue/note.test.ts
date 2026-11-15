import { ApiRequestError, createHttp, type FetchLike } from '@fdv/client';
import { noConnection } from '../net/no-connection';
import { respond } from '../test-support/render';
import { noteBytes, noteItem, readNote, type NotePayload } from './note';
import {
  departure,
  idempotentCreate,
  MaybeSentError,
  NoAnswerError,
  NotSentError,
  postNote,
  watched,
  type Departure,
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
    for (const words of ['Network request failed', 'Failed to fetch', 'Load failed', 'fetch failed', 'socket hang up', 'Connection reset']) {
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
  /** A vault behind `fetch`; `answers` is whether its capability document came back just before. */
  const sending = (fetch: FetchLike, over: { answers?: boolean; idempotent?: boolean } = {}) => {
    const posted: { headers: Record<string, string>; body: unknown }[] = [];
    const spy: FetchLike = async (url, init) => {
      posted.push({ headers: init.headers, body: JSON.parse(String(init.body)) });
      return fetch(url, init);
    };
    return {
      posted,
      s: {
        http: (watch: (d: Departure) => void) => createHttp({ baseUrl: 'https://v', fetch: watched(spy, watch) }),
        answers: async () => over.answers ?? true,
        token: 'tk',
        owner: 'me',
        key: 'c-1',
        idempotent: over.idempotent ?? false,
      },
    };
  };

  it('made: the new note’s id, as its writer’s, with nothing of the key for a vault that takes none', async () => {
    const { s, posted } = sending(async () => respond(201, { id: 'n1' }));
    expect(await postNote(payload, s)).toBe('n1');
    expect(posted[0]?.body).toEqual({
      type_key: 'note',
      title: 'Gate code',
      notes: 'The blue door.',
      visibility: 'private',
      owner_member_id: 'me',
    });
    expect(posted[0]?.headers['idempotency-key']).toBeUndefined();
  });

  it('the vault not answering just before: never sent, never tried', async () => {
    const { s, posted } = sending(async () => respond(201, { id: 'n1' }), { answers: false });
    await expect(postNote(payload, s)).rejects.toBeInstanceOf(NotSentError);
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

  it('a vault that takes the key (features.idempotent_create): sent under it, and a lost answer is simply no answer', async () => {
    const lost = sending(
      async () => {
        throw new TypeError('Network request failed');
      },
      { idempotent: true },
    );
    await expect(postNote(payload, lost.s)).rejects.toBeInstanceOf(NoAnswerError);
    expect(noConnection(new NoAnswerError())).toBe(true);
    expect(noConnection(new NotSentError())).toBe(true);
    expect(noConnection(new MaybeSentError())).toBe(false);
    expect(lost.posted[0]?.headers['idempotency-key']).toBe('c-1');
    expect(idempotentCreate({ features: { idempotent_create: true } })).toBe(true);
    expect(idempotentCreate({ features: {} })).toBe(false);
    expect(idempotentCreate(null)).toBe(false);
  });
});
