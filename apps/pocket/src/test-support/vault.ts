import type { FetchLike } from '@fdv/client';
import { createFakeVault } from '@fdv/client/testing';
import type { Capabilities, DocumentView, ReminderView, SearchHit, VersionView } from '@fdv/shared';

/**
 * The client's fake vault, with the capability document the app needs to
 * be able to say what it likes (server version, instance id, setup) and
 * per-origin behaviour: which addresses answer at all.
 */
export const INSTANCE = '0f5a1c2e-9b7d-4e61-8a33-5c2d7e9f1a40';

export function capabilities(over: Partial<Capabilities> = {}): Capabilities {
  return {
    product: 'family-document-vault',
    server_version: '0.4.10',
    api_version: 1,
    min_client_version: '0.0.1',
    edition: 'self_hosted',
    protection_mode: 'standard',
    setup_required: false,
    features: {
      passkeys: true,
      private_mode: false,
      email_ingest: false,
      push: false,
      share_links: true,
      bulk_import: false,
      multi_household: false,
      idempotent_capture: true,
      capture_metadata: true,
      issued_by: true,
      page_previews: true,
      offline_essentials: true,
    },
    limits: { max_upload_bytes: 104_857_600, max_members: null, max_storage_bytes: null },
    deprecations: [],
    branding: { display_name: 'The Test family' },
    instance_id: INSTANCE,
    ...over,
  };
}

export interface TestVault {
  fetch: FetchLike;
  vault: ReturnType<typeof createFakeVault>;
  /** Origins that answer; everything else fails as if nothing were there. */
  reachable: Set<string>;
  caps: Capabilities;
  /** A body that is not the capability document, from this origin. */
  impostor: Map<string, unknown>;
  calls: string[];
  /** What GET /reminders answers; the client's fake has no reminders yet. */
  reminders: ReminderView[];
  /** What GET /reminders?state=upcoming answers (4.12). */
  upcoming: ReminderView[];
  /** What the fake does not do, for the screens of 4.12. */
  library: Library;
  /** Push (4.14): the vault's side of this phone's notifications. */
  push: PushSide;
}

export interface PushSide {
  key: { public_key: string | null; enabled: boolean };
  /** Devices as the vault keeps them, newest last. */
  devices: { id: string; kind: string; endpoint: string; keys: { p256dh: string; auth: string } }[];
  /** Every POST /devices body, in order. */
  posted: { kind?: string; endpoint: string; keys: { p256dh: string; auth: string } }[];
  tests: string[];
  prefs: { daily_push: boolean; daily_email: boolean; weekly_email: boolean };
}

/** The vault's VAPID public key in the tests: 87 characters, as the connector wants. */
export const VAPID = `B${'x'.repeat(86)}`;

/**
 * The vault's documents as 4.12's screens use them, beside the client's
 * fake: one by id (and changed with If-Match, as the real vault: a stale
 * view is refused 409), its versions, its pages and content (behind a
 * step-up where `sensitive` says so, as for an Essential or Only me), the
 * search and its sealed second pass, and reminders put off or done.
 */
export interface Library {
  documents: Map<string, DocumentView>;
  versions: Map<string, VersionView[]>;
  /** Versions whose pages and content ask to confirm it is you. */
  sensitive: Set<string>;
  /** Confirmed: the step-up window is open. */
  verified: boolean;
  /** What a step-up accepted (the password, or a code). */
  stepUps: string[];
  /** Bytes served as a version's content. */
  content: Map<string, Uint8Array>;
  search: (q: string, params: Record<string, string>) => { items: SearchHit[]; sealed: number };
  sealed: SearchHit[];
  snoozed: { id: string; until: string }[];
  acknowledged: string[];
  searches: string[];
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02, 0xff, 0xd9]);
let etags = 0;
export const nextEtag = () => `"e${++etags}"`;

export function testVault(origins: string[] = ['https://vault.test']): TestVault {
  const vault = createFakeVault();
  vault.state.setupRequired = false;
  vault.state.email = 'owner@example.test';
  vault.state.password = 'correct horse battery staple';
  const t: TestVault = {
    vault,
    reachable: new Set(origins),
    caps: capabilities(),
    impostor: new Map(),
    calls: [],
    reminders: [],
    upcoming: [],
    push: {
      key: { public_key: VAPID, enabled: true },
      devices: [],
      posted: [],
      tests: [],
      prefs: { daily_push: true, daily_email: false, weekly_email: true },
    },
    library: {
      documents: new Map(),
      versions: new Map(),
      sensitive: new Set(),
      verified: false,
      stepUps: [],
      content: new Map(),
      search: () => ({ items: [], sealed: 0 }),
      sealed: [],
      snoozed: [],
      acknowledged: [],
      searches: [],
    },
    fetch: async (url, init) => {
      t.calls.push(`${init.method} ${url}`);
      const origin = /^[a-z]+:\/\/[^/]+/i.exec(url)?.[0] ?? '';
      if (!t.reachable.has(origin)) throw new TypeError('Network request failed');
      const path = url.slice(origin.length);
      if (path.startsWith('/api/v1/reminders?'))
        return json({ items: path.includes('state=upcoming') ? t.upcoming : t.reminders });
      const lib = await library(t, path, init);
      if (lib) return lib;
      if (url.endsWith('/api/v1/capabilities')) {
        return json(t.impostor.get(origin) ?? t.caps);
      }
      return vault.fetch(url, init);
    },
  };
  return t;
}

type Reply = Awaited<ReturnType<FetchLike>>;

function failure(status: number, code: string, message: string): Reply {
  const body = { error: { code, message } };
  return {
    ok: false,
    status,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(body)).buffer,
  } as unknown as Reply;
}

function bytes(data: Uint8Array, type: string): Reply {
  return {
    ok: true,
    status: 200,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? type : null) },
    json: async () => {
      throw new SyntaxError('not JSON');
    },
    text: async () => '',
    arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
  } as unknown as Reply;
}

let devices = 0;

/** Push (4.14): the key, the devices (one per address), a test, the preferences. */
async function pushRoutes(
  t: TestVault,
  q: string,
  method: string | undefined,
  body: Record<string, unknown>,
): Promise<Reply | null> {
  const p = t.push;
  if (q === '/api/v1/notifications/push-key' && method === 'GET') return json(p.key);
  if (q === '/api/v1/devices' && method === 'POST') {
    const b = body as unknown as PushSide['posted'][number];
    p.posted.push(b);
    const id = `device-${++devices}`;
    p.devices = [...p.devices.filter((d) => d.endpoint !== b.endpoint), { id, kind: b.kind ?? 'web_push', ...b }];
    return { ...json({ id }), status: 201 } as Reply;
  }
  if (q === '/api/v1/devices' && method === 'DELETE') {
    p.devices = p.devices.filter((d) => d.endpoint !== body.endpoint);
    return { ...json(null), status: 204, text: async () => '' } as Reply;
  }
  const m = /^\/api\/v1\/devices\/([^/]+)\/test$/.exec(q);
  if (m?.[1] && method === 'POST') {
    if (!p.devices.some((d) => d.id === m[1])) return failure(404, 'not_found', 'There is no such device of yours.');
    p.tests.push(m[1]);
    return { ...json({ queued: true }), status: 202 } as Reply;
  }
  if (q === '/api/v1/notifications/preferences') {
    if (method === 'PUT') p.prefs = { ...p.prefs, ...(body as Partial<PushSide['prefs']>) };
    if (method === 'PUT' || method === 'GET') return json(p.prefs);
  }
  return null;
}

/** The library's routes, when the path is one of them; null otherwise. */
async function library(t: TestVault, path: string, init: Parameters<FetchLike>[1]): Promise<Reply | null> {
  const lib = t.library;
  const q = path.split('?')[0] ?? path;
  const params = Object.fromEntries(
    (path.split('?')[1] ?? '')
      .split('&')
      .filter(Boolean)
      .map((kv) => kv.split('=').map((x) => decodeURIComponent(x.replace(/\+/g, ' '))) as [string, string]),
  );
  const body = (typeof init.body === 'string' ? JSON.parse(init.body) : (init.body ?? {})) as Record<string, unknown>;
  const guard = (versionId: string) =>
    lib.sensitive.has(versionId) && !lib.verified
      ? failure(403, 'step_up_required', 'Please confirm it is you to see this document.')
      : null;

  const pushed = await pushRoutes(t, q, init.method, body);
  if (pushed) return pushed;
  if (q === '/api/v1/auth/step-up' && init.method === 'POST') {
    const ok = body.password === t.vault.state.password || body.code === '123456';
    if (!ok) return failure(401, 'invalid_credentials', "That password isn't right.");
    lib.verified = true;
    lib.stepUps.push(String(body.password ?? body.code));
    return json({ verified_at: new Date().toISOString(), expires_in: 300 });
  }
  let m = /^\/api\/v1\/documents\/([^/]+)$/.exec(q);
  if (m?.[1] && lib.documents.has(m[1])) {
    const doc = lib.documents.get(m[1]) as DocumentView;
    if (init.method === 'GET') return json(doc);
    if (init.method === 'PATCH') {
      const ifMatch = Object.entries(init.headers).find(([k]) => k.toLowerCase() === 'if-match')?.[1];
      if (ifMatch && ifMatch !== doc.etag) return failure(409, 'conflict', 'Someone changed this.');
      const next = { ...doc, ...body, etag: nextEtag() } as DocumentView;
      lib.documents.set(doc.id, next);
      return json(next);
    }
  }
  m = /^\/api\/v1\/documents\/([^/]+)\/versions$/.exec(q);
  if (m?.[1] && init.method === 'GET' && lib.documents.has(m[1])) return json({ items: lib.versions.get(m[1]) ?? [] });
  m = /^\/api\/v1\/versions\/([^/]+)\/pages\/(\d+)$/.exec(q);
  if (m?.[1] && [...lib.versions.values()].flat().some((v) => v.id === m?.[1])) {
    const refused = guard(m[1]);
    if (refused) return refused;
    return bytes(JPEG, 'image/jpeg');
  }
  m = /^\/api\/v1\/versions\/([^/]+)\/content$/.exec(q);
  if (m?.[1] && lib.content.has(m[1])) {
    const refused = guard(m[1]);
    if (refused) return refused;
    return bytes(lib.content.get(m[1]) as Uint8Array, 'application/pdf');
  }
  if (q === '/api/v1/search' && init.method === 'GET') {
    lib.searches.push(params.q ?? '');
    const r = lib.search(params.q ?? '', params);
    return json({
      items: r.items,
      sealed_pending: r.sealed ? { count: r.sealed, token: 'sealed-handle' } : { count: 0 },
    });
  }
  if (q === '/api/v1/search/sealed' && init.method === 'GET') {
    return json({ items: lib.sealed, searched: Math.max(lib.sealed.length, 2) });
  }
  m = /^\/api\/v1\/reminders\/([^/]+)\/(snooze|acknowledge)$/.exec(q);
  if (m?.[1] && init.method === 'POST') {
    const id = m[1];
    const r = [...t.reminders, ...t.upcoming].find((x) => x.id === id);
    if (!r) return failure(404, 'not_found', 'No such reminder.');
    t.reminders = t.reminders.filter((x) => x.id !== id);
    t.upcoming = t.upcoming.filter((x) => x.id !== id);
    if (m[2] === 'snooze') lib.snoozed.push({ id, until: String(body.until) });
    else lib.acknowledged.push(id);
    return json({ ...r, status: m[2] === 'snooze' ? 'snoozed' : 'acknowledged' });
  }
  return null;
}

function json(body: unknown): Awaited<ReturnType<FetchLike>> {
  return {
    ok: true,
    status: 200,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(body)).buffer,
  } as unknown as Awaited<ReturnType<FetchLike>>;
}
