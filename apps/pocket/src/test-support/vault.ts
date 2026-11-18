import type { FetchLike } from '@fdv/client';
import { createFakeVault } from '@fdv/client/testing';
import type {
  Capabilities,
  CollectionSharePreview,
  DetailSuggestions,
  DocumentView,
  ReminderView,
  SearchHit,
  SessionRow,
  Share,
  StopSharing,
  VersionView,
} from '@fdv/shared';

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

/**
 * The capability document of a vault of 0.5.19 (the pin before 5.31), as
 * its features said: kinds' details, collections, reminder dates, photos —
 * and no identity details, locks or files sent to look at.
 */
export function caps0519(): Capabilities {
  return capabilities({
    server_version: '0.5.19',
    features: {
      ...capabilities().features,
      push: true,
      unified_push: true,
      custom_types: true,
      collections: true,
      reminder_dates: true,
      member_photos: true,
    },
  });
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
  /** Signed-in devices (4.15): this phone, and a laptop. */
  sessions: SessionRow[];
  /**
   * The second factors of the account signed in, as GET /me says them
   * (`totp_enabled`, `has_passkey`): the client's fake says none.
   */
  factors: { totp: boolean; passkey: boolean };
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
  /**
   * Confirmed with a code, not the password: what the vault asks for
   * another person's identity numbers (`open_identity`, 5.26).
   */
  factorVerified: boolean;
  /** What a step-up accepted (the password, or a code). */
  stepUps: string[];
  /** Bytes served as a version's content. */
  content: Map<string, Uint8Array>;
  search: (q: string, params: Record<string, string>) => { items: SearchHit[]; sealed: number };
  sealed: SearchHit[];
  snoozed: { id: string; until: string }[];
  acknowledged: string[];
  searches: string[];
  /**
   * Whether each captured document is an Essential. Those are the client's
   * fake's, which keeps no Essential and answers 501 for a field it does not
   * keep: the test vault keeps it, and passes the rest of an edit on.
   */
  essential: Map<string, boolean>;
  /**
   * What a document's pages read (P2): GET /documents/{id}/suggestions
   * answers it, "unavailable" when unset; asked this many times.
   */
  suggestions: Map<string, DetailSuggestions>;
  asked: string[];
  /**
   * A new version's details used (POST /documents/{id}/renewal), each
   * body in order, and the document as it was, for Undo while it is open.
   */
  renewals: Record<string, unknown>[];
  undoable: Map<string, DocumentView>;
  /**
   * Who can see it (P8): each POST /documents/{id}/visibility, in order;
   * a document here has share links of the person's own, so a change to
   * Only me without `own_links` is asked about first (409
   * links_choice_needed), Keep offered when `keep` says.
   */
  visibilityChanges: { id: string; visibility: string; own_links?: string }[];
  ownLinks: Map<string, { links: number; keep: boolean }>;
  /** The collections each document is in (GET /documents/{id}/collections). */
  collections: Map<string, { id: string; name: string }[]>;
  /** Moved to the Trash (DELETE /documents/{id}), in order. */
  trashed: string[];
  /**
   * The person's own sign-in, changed from the phone (12 Nov 2026): two-step
   * sign-in on or not, each password change asked, and each forgotten
   * password's address.
   */
  account: {
    totp: boolean;
    changes: Record<string, unknown>[];
    forgot: string[];
    required?: boolean;
    /** Where a step-up's code can be texted (`StepUpState.text_to`, SMS3), masked: GET /auth/step-up says it. */
    stepUpTextTo?: string;
  };
  /**
   * Links outside the family (sharing from the phone): GET /shares lists
   * them; each one made is kept with what the phone sent for it.
   */
  shares: Share[];
  shareBodies: { to: string; body: Record<string, unknown> }[];
  /** What each link made here was handed over with, to show its maker again (0.9.0-dev.30). */
  shareSecrets: Map<string, { link_token: string; link_url: string; pin?: string; password?: string }>;
  /** Whether Only me documents may be shared (GET /household/sharing); null: an older vault, which says nothing. */
  onlyMeShareable: boolean | null;
  /** What a collection's share sheet offers (GET /collections/{id}/share-preview), by collection. */
  sharePreviews: Map<string, CollectionSharePreview>;
  /**
   * Email the link (0.9.0-dev.39): whether the vault can email links (a link
   * made here is then `emailable`), each one emailed, whether it asks to
   * confirm it is them first (past 15 minutes), and a refusal to give instead.
   */
  emailLinks: boolean;
  emailed: { id: string; to: string; message?: string }[];
  emailStepUp: boolean;
  emailRefusal: { status: number; code: string; message: string; retryAfter?: number } | null;
  /**
   * What Sensitive protects (0.9.0-dev.41, H1a): what is refused `409
   * sensitive_confirm` without `confirm_sensitive: true`, with the vault's
   * question — a document's or a collection's link (`share:<id>`), putting
   * documents in a collection (`items:<id>`), a paused link turned back on
   * (`resume:<id>`) — and each of those sent with the flag, in order.
   */
  asksSensitive: Map<string, string>;
  confirmedSensitive: string[];
  /** How many live links still give a document an edit makes sensitive (`sensitive_still_shared`). */
  stillShared: Map<string, number>;
  /** Each POST /documents/{id}/stop-sharing, and what it answers. */
  stopped: string[];
  stopSharing: StopSharing;
  /**
   * Papers the person sees only as somebody's caregiver (0.9.0-dev.43, H1b):
   * the client's fake keeps grants but not the reading exception, so the
   * fake's own documents with these ids are answered — listed or one by one
   * — with `caregiver: true` and Only me, as the vault answers a caregiver.
   */
  caregiver: Set<string>;
  /**
   * A link changed (0.9.0-dev.49, LK): each PATCH /shares/{id}, with its
   * If-Match, in order; whether the vault asks to confirm it is them first
   * (a change that lets it do more) — for a request's PATCH too (0.18.0),
   * which the client's fake makes once that is answered. The vault decides
   * which changes ask; this flag always asks.
   */
  shareChanges: { id: string; body: Record<string, unknown>; ifMatch: string | null }[];
  changeStepUp: boolean;
  /**
   * Downloads as one ZIP (0.9.0-dev.48, DL): the client's fake makes them
   * and their tickets, but keeps no Sensitive mark and asks nobody to
   * confirm. The ids here are Sensitive: a selection, or a collection, with
   * one of them asks to confirm it is them first (`download_sensitive`), as
   * the vault does.
   */
  zipSensitive: Set<string>;
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
    factors: { totp: false, passkey: false },
    reminders: [],
    upcoming: [],
    sessions: [
      {
        id: 'this-phone',
        current: true,
        user_agent: 'FamilyVault/0.1.9',
        ip: null,
        created_at: '2026-09-01T00:00:00Z',
        last_used_at: '2026-09-25T00:00:00Z',
        client: 'app',
        label: 'the app on a Test Phone 1',
        offline: true,
      },
      {
        id: 'laptop',
        current: false,
        user_agent: 'Mozilla/5.0',
        ip: null,
        created_at: '2026-08-01T00:00:00Z',
        last_used_at: '2026-09-20T00:00:00Z',
        client: 'browser',
        label: 'Firefox on a Mac',
        offline: false,
      },
    ],
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
      factorVerified: false,
      stepUps: [],
      content: new Map(),
      search: () => ({ items: [], sealed: 0 }),
      sealed: [],
      snoozed: [],
      acknowledged: [],
      searches: [],
      essential: new Map(),
      suggestions: new Map(),
      asked: [],
      renewals: [],
      undoable: new Map(),
      visibilityChanges: [],
      ownLinks: new Map(),
      collections: new Map(),
      trashed: [],
      account: { totp: false, changes: [], forgot: [] },
      shares: [],
      shareBodies: [],
      shareSecrets: new Map(),
      onlyMeShareable: null,
      sharePreviews: new Map(),
      emailLinks: false,
      emailed: [],
      emailStepUp: false,
      emailRefusal: null,
      asksSensitive: new Map(),
      confirmedSensitive: [],
      stillShared: new Map(),
      stopped: [],
      stopSharing: { ended: 2, left_out: 0, kept: 0 },
      caregiver: new Set(),
      shareChanges: [],
      changeStepUp: false,
      zipSensitive: new Set(),
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
      if (path === '/api/v1/me' && init.method === 'GET') {
        const res = await vault.fetch(url, init);
        if (!res.ok) return res;
        const me = (await res.json()) as Record<string, unknown>;
        return json({ ...me, totp_enabled: t.factors.totp, has_passkey: t.factors.passkey });
      }
      const res = (await captured(t, url, path, init)) ?? (await vault.fetch(url, init));
      return asCaregiver(t, path, init, res);
    },
  };
  return t;
}

/** A caregiver's papers (H1b), as the vault answers them: marked, Only me, with no notes of their person's. */
async function asCaregiver(t: TestVault, path: string, init: Parameters<FetchLike>[1], res: Reply): Promise<Reply> {
  const ids = t.library.caregiver;
  if (ids.size === 0 || init.method !== 'GET' || !res.ok || !/^\/api\/v1\/documents(\/[^/?]+)?(\?|$)/.test(path)) {
    return res;
  }
  const mark = (d: DocumentView): DocumentView =>
    ids.has(d.id)
      ? {
          ...d,
          caregiver: true,
          visibility: 'private',
          notes: null,
          has_notes: false,
          // With a file, as the paper a grant gives: the fake's own say none.
          latest_version_id: d.latest_version_id ?? `${d.id}-v1`,
        }
      : d;
  const body = (await res.json()) as DocumentView | { items: DocumentView[] };
  return json('items' in body ? { ...body, items: body.items.map(mark) } : mark(body));
}

/**
 * A captured document, one by id: the fake's, with whether it is an
 * Essential, which the fake does not keep (it answers 501 for an edit of a
 * field it does not keep, 0.5.11). An edit's other fields are the fake's,
 * with its If-Match check. Null for anything else.
 */
async function captured(
  t: TestVault,
  url: string,
  path: string,
  init: Parameters<FetchLike>[1],
): Promise<Reply | null> {
  const id = /^\/api\/v1\/documents\/([^/?]+)$/.exec(path)?.[1];
  if (!id || (init.method !== 'GET' && init.method !== 'PATCH')) return null;
  if (!t.vault.state.documents.some((d) => d.id === id)) return null;
  let forward = init;
  let essential: boolean | undefined;
  if (init.method === 'PATCH' && typeof init.body === 'string') {
    const { is_essential, ...rest } = JSON.parse(init.body) as Record<string, unknown>;
    if (typeof is_essential === 'boolean') {
      essential = is_essential;
      forward = { ...init, body: JSON.stringify(rest) };
    }
  }
  const res = await t.vault.fetch(url, forward);
  if (!res.ok) return res;
  if (essential !== undefined) t.library.essential.set(id, essential);
  const view = (await res.json()) as DocumentView;
  return json({ ...view, is_essential: t.library.essential.get(id) ?? false });
}

type Reply = Awaited<ReturnType<FetchLike>>;

function failure(status: number, code: string, message: string, action?: string, retryAfter?: number): Reply {
  const body = { error: { code, message, ...(action ? { action } : {}) } };
  const header = (h: string) =>
    h.toLowerCase() === 'content-type'
      ? 'application/json'
      : h.toLowerCase() === 'retry-after' && retryAfter !== undefined
        ? String(retryAfter)
        : null;
  return {
    ok: false,
    status,
    headers: { get: header },
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
  // The profile, as far as the phone reads it: the family's time zone (0.9.0), the fake's.
  if (q === '/api/v1/profile' && init.method === 'GET') {
    return json({ timezone: t.vault.state.timezone, timezone_source: t.vault.state.timezoneSource });
  }
  if (q === '/api/v1/auth/sessions' && init.method === 'GET') return json({ items: t.sessions });
  const s = /^\/api\/v1\/auth\/sessions\/([^/]+)$/.exec(q);
  if (s?.[1] && init.method === 'DELETE') {
    if (!t.sessions.some((x) => x.id === s[1])) return failure(404, 'not_found', 'There is no such session.');
    t.sessions = t.sessions.filter((x) => x.id !== s[1]);
    return { ...json(null), status: 204, text: async () => '' } as Reply;
  }
  if (q === '/api/v1/auth/step-up' && init.method === 'GET' && lib.account.stepUpTextTo) {
    return json({ verified_at: null, expires_in: 0, text_to: lib.account.stepUpTextTo });
  }
  if (q === '/api/v1/auth/step-up' && init.method === 'POST' && body.text_code !== undefined) {
    // A code by text (SMS3): the client's fake keeps the codes it texted, and checks it.
    const res = (await t.vault.fetch(`https://vault.test${path}`, init)) as Reply;
    if (res.status === 200) {
      lib.verified = true;
      lib.stepUps.push(`text:${String(body.text_code)}`);
    }
    return res;
  }
  if (q === '/api/v1/auth/step-up' && init.method === 'POST') {
    const ok = body.password === t.vault.state.password || body.code === '123456';
    if (!ok) return failure(401, 'invalid_credentials', "That password isn't right.");
    lib.verified = true;
    if (body.code !== undefined) lib.factorVerified = true;
    lib.stepUps.push(String(body.password ?? body.code));
    return json({ verified_at: new Date().toISOString(), expires_in: 300 });
  }
  // Two-step sign-in and passwords, as the vault answers them: setting it up asks who it is first.
  const done = () => ({ ...json(null), status: 204, text: async () => '' }) as Reply;
  if (q === '/api/v1/auth/totp/enrol' && init.method === 'POST') {
    if (!lib.verified) return failure(403, 'step_up_required', 'Please confirm it is you.', 'change_sign_in');
    return json({ secret: 'JBSWY3DPEHPK3PXP', otpauth_url: 'otpauth://totp/Family%20Vault:me?secret=JBSWY3DPEHPK3PXP' });
  }
  if (q === '/api/v1/auth/totp/confirm' && init.method === 'POST') {
    if (!lib.verified) return failure(403, 'step_up_required', 'Please confirm it is you.', 'change_sign_in');
    if (body.code !== '123456') return failure(422, 'invalid_code', "That code isn't right.");
    lib.account.totp = true;
    return done();
  }
  if (q === '/api/v1/auth/totp/disable' && init.method === 'POST') {
    if (body.code !== '123456') return failure(422, 'invalid_code', "That code isn't right.");
    lib.account.totp = false;
    return done();
  }
  if (q === '/api/v1/auth/password/change' && init.method === 'POST') {
    if (body.current_password === undefined && !lib.verified) {
      return failure(403, 'step_up_required', 'Please confirm it is you.', 'change_password');
    }
    if (body.current_password !== undefined && body.current_password !== t.vault.state.password) {
      return failure(401, 'invalid_credentials', "That password isn't right.");
    }
    lib.account.changes.push(body);
    return done();
  }
  if (q === '/api/v1/auth/password/forgot' && init.method === 'POST') {
    lib.account.forgot.push(String(body.email));
    return { ...json({ message: 'If that address has a sign-in here, a link is on its way to it.' }), status: 202 } as Reply;
  }
  if (q === '/api/v1/me' && init.method === 'GET' && (lib.account.totp || lib.account.required !== undefined)) {
    const res = await t.vault.fetch(`https://vault.test${path}`, init);
    return json({
      ...((await res.json()) as object),
      totp_enabled: lib.account.totp,
      ...(lib.account.required !== undefined ? { totp_required: lib.account.required } : {}),
    });
  }
  let m = /^\/api\/v1\/documents\/([^/]+)$/.exec(q);
  if (m?.[1] && lib.documents.has(m[1])) {
    const doc = lib.documents.get(m[1]) as DocumentView;
    if (init.method === 'GET') return json(doc);
    if (init.method === 'PATCH') {
      const ifMatch = Object.entries(init.headers).find(([k]) => k.toLowerCase() === 'if-match')?.[1];
      if (ifMatch && ifMatch !== doc.etag) return failure(409, 'conflict', 'Someone changed this.');
      // As the vault since 0.5.3: taking a check away asks who it is first.
      if (doc.is_essential && body.is_essential === false && !lib.verified) {
        return failure(403, 'step_up_required', 'Please confirm it is you to stop keeping this as an Essential.');
      }
      const next = { ...doc, ...body, etag: nextEtag() } as DocumentView;
      lib.documents.set(doc.id, next);
      // Made sensitive while links outside the family still give it (H1a): saved, and said.
      const links = body.sensitive === true ? lib.stillShared.get(doc.id) : undefined;
      return json(links ? { ...next, warnings: [{ code: 'sensitive_still_shared', links }] } : next);
    }
  }
  if (m?.[1] && lib.documents.has(m[1]) && init.method === 'DELETE') {
    lib.trashed.push(m[1]);
    lib.documents.delete(m[1]);
    return { ...json(null), status: 204, text: async () => '' } as Reply;
  }
  // Its sharing ended (H1a): its own links taken back, collections' links made to leave it out.
  const stop = /^\/api\/v1\/documents\/([^/]+)\/stop-sharing$/.exec(q);
  if (stop?.[1] && init.method === 'POST') {
    lib.stopped.push(stop[1]);
    return json(lib.stopSharing);
  }
  // Asked first (H1a): without the flag, the vault's question and nothing done; with it, noted.
  const asksFirst = (what: string): Reply | null => {
    const question = lib.asksSensitive.get(what);
    if (!question) return null;
    if (body.confirm_sensitive !== true) return failure(409, 'sensitive_confirm', question);
    lib.confirmedSensitive.push(what);
    return null;
  };
  m = /^\/api\/v1\/collections\/([^/]+)\/items$/.exec(q);
  if (m?.[1] && init.method === 'POST') {
    const refused = asksFirst(`items:${m[1]}`);
    if (refused) return refused;
    const { confirm_sensitive: _asked, ...rest } = body;
    return t.vault.fetch(`https://vault.test${path}`, { ...init, body: JSON.stringify(rest) });
  }
  m = /^\/api\/v1\/shares\/([^/]+)\/resume$/.exec(q);
  if (m?.[1] && init.method === 'POST') {
    const share = lib.shares.find((x) => x.id === m?.[1]);
    if (!share) return failure(404, 'not_found', 'There is no such link.');
    const refused = asksFirst(`resume:${share.id}`);
    if (refused) return refused;
    share.state = 'active';
    share.paused_reason = null;
    return json(share);
  }
  // Sharing outside the family, as the vault of 0.9.0 answers it: a link
  // made (its token, and a PIN or a password made up, here once), listed,
  // and ended; a collection's always confirms it is you first.
  if (q === '/api/v1/household/sharing' && init.method === 'GET') {
    if (lib.onlyMeShareable === null) return failure(404, 'not_found', 'No such route.');
    return json({ only_me_shareable: lib.onlyMeShareable, can_change: true });
  }
  m = /^\/api\/v1\/collections\/([^/]+)\/share-preview$/.exec(q);
  if (m?.[1] && init.method === 'GET') {
    const preview = lib.sharePreviews.get(m[1]);
    return preview ? json(preview) : failure(404, 'not_found', 'There is no such collection.');
  }
  const shareAt = /^\/api\/v1\/documents\/([^/]+)\/share$/.exec(q) ?? /^\/api\/v1\/collections\/([^/]+)\/shares$/.exec(q);
  if (shareAt?.[1] && init.method === 'POST') {
    const collection = q.startsWith('/api/v1/collections/');
    if (collection && !lib.verified) {
      return failure(403, 'step_up_required', 'Please confirm it is you to share a collection.', 'share_collection');
    }
    const refused = asksFirst(`share:${shareAt[1]}`);
    if (refused) return refused;
    lib.shareBodies.push({ to: shareAt[1], body });
    const n = lib.shares.length + 1;
    const share = {
      id: `share-${n}`,
      document_id: collection ? null : shareAt[1],
      document_title: collection ? null : (lib.documents.get(shareAt[1])?.title ?? null),
      collection_id: collection ? shareAt[1] : null,
      collection_name: collection ? (lib.sharePreviews.get(shareAt[1])?.collection_name ?? null) : null,
      recipient_label: (body.recipient_label as string | undefined) ?? null,
      created_by_name: 'Fake Owner',
      created_at: new Date(Date.now() + n).toISOString(),
      expires_at: (body.expires_at as string | undefined) ?? new Date(Date.now() + 7 * 864e5).toISOString(),
      has_pin: body.with_pin === true,
      open_count: 0,
      last_opened_at: null,
      state: 'active',
      permission: (body.permission as 'view' | 'download' | undefined) ?? 'download',
      max_opens: (body.max_opens as number | undefined) ?? null,
      summary: 'A link',
      revealable: true,
      emailable: lib.emailLinks,
      emailed_to: null,
    } as Share;
    lib.shares.push(share);
    lib.shareSecrets.set(share.id, {
      link_token: `tok-${n}`,
      link_url: `https://share.vault.test/s#tok-${n}`,
      ...(body.with_pin === true ? { pin: '4821' } : {}),
      ...(body.with_password === true ? { password: 'amber-otter-41' } : {}),
    });
    return json({
      share,
      link_token: `tok-${n}`,
      link_url: `https://share.vault.test/s#tok-${n}`,
      ...(body.with_pin === true ? { pin: '4821' } : {}),
      ...(body.with_password === true ? { password: 'amber-otter-41' } : {}),
    });
  }
  if (q === '/api/v1/shares' && init.method === 'GET') return json({ items: lib.shares });
  // A link shown again to its maker (0.9.0-dev.30), after confirming it is them.
  m = /^\/api\/v1\/shares\/([^/]+)\/reveal$/.exec(q);
  if (m?.[1] && init.method === 'POST') {
    const kept = lib.shareSecrets.get(m[1]);
    if (!lib.shares.some((x) => x.id === m?.[1])) return failure(404, 'not_found', 'There is no such link.');
    if (!kept) return failure(409, 'share_not_revealable', 'This link was shown once, as it was made.');
    if (!lib.verified) return failure(403, 'step_up_required', 'Please confirm it is you to see this link again.', 'reveal_share');
    return json(kept);
  }
  // A link emailed by the vault to whom its maker typed (0.9.0-dev.39).
  m = /^\/api\/v1\/shares\/([^/]+)\/email$/.exec(q);
  if (m?.[1] && init.method === 'POST') {
    const id = m[1];
    const share = lib.shares.find((x) => x.id === id);
    if (!share?.emailable) return failure(404, 'not_found', 'There is no such link.');
    const r = lib.emailRefusal;
    if (r) return failure(r.status, r.code, r.message, undefined, r.retryAfter);
    if (lib.emailStepUp && !lib.verified) {
      return failure(403, 'step_up_required', 'Please confirm it is you to email this link.', 'email_share');
    }
    const to = String(body.to);
    lib.emailed.push({ id, to, ...(typeof body.message === 'string' ? { message: body.message } : {}) });
    const masked = `${to.slice(0, 1)}•••${to.slice(to.lastIndexOf('@'))}`;
    share.emailed_to = masked;
    return json({
      sent_to: masked,
      sent_at: new Date().toISOString(),
      sends_left: 3 - lib.emailed.filter((e) => e.id === id).length,
    });
  }
  // Downloads as one ZIP (DL), and their tickets: a Sensitive one among them asks to confirm it is
  // them first; the fake makes the rest.
  const zipAt = /^\/api\/v1\/(?:documents\/download|collections\/([^/]+)\/download)(?:\/ticket)?$/.exec(q);
  if (zipAt && init.method === 'POST' && !lib.verified) {
    const ids = zipAt[1]
      ? (t.vault.state.collections.find((c) => c.id === zipAt[1])?.items ?? []).map((i) => i.document_id)
      : Array.isArray(body.document_ids)
        ? (body.document_ids as unknown[]).map(String)
        : [];
    if (ids.some((id) => lib.zipSensitive.has(id))) {
      return failure(403, 'step_up_required', 'Please confirm it is you to download a sensitive document.', 'download_sensitive');
    }
  }
  // A request changed (LK): the client's fake makes the change but asks nobody to confirm it is them.
  // The vault decides when to ask (a change that lets it do more); with `changeStepUp` this shim
  // always asks first, whatever the change, until the step-up is answered.
  if (/^\/api\/v1\/upload-requests\/[^/]+$/.test(q) && init.method === 'PATCH' && lib.changeStepUp && !lib.verified) {
    return failure(403, 'step_up_required', 'Please confirm it is you to change this request.', 'change_share');
  }
  // A link changed (LK), as the vault of 0.9.0-dev.49 answers it.
  m = /^\/api\/v1\/shares\/([^/]+)$/.exec(q);
  if (m?.[1] && init.method === 'PATCH') {
    const id = m[1];
    const share = lib.shares.find((x) => x.id === id);
    if (!share) return failure(404, 'not_found', 'There is no such link.');
    const ifMatch = Object.entries(init.headers).find(([k]) => k.toLowerCase() === 'if-match')?.[1] ?? null;
    if (ifMatch && share.version !== undefined && ifMatch !== `"${share.version}"`) {
      return failure(409, 'conflict', 'Someone changed this link meanwhile.');
    }
    if (lib.changeStepUp && !lib.verified) {
      return failure(403, 'step_up_required', 'Please confirm it is you to change this link.', 'change_share');
    }
    lib.shareChanges.push({ id, body, ifMatch });
    if ('recipient_label' in body) share.recipient_label = (body.recipient_label as string | null) ?? null;
    if (typeof body.expires_at === 'string') share.expires_at = body.expires_at;
    if (body.permission === 'view' || body.permission === 'download') share.permission = body.permission;
    if ('max_opens' in body) share.max_opens = (body.max_opens as number | null) ?? null;
    if (typeof body.show_title === 'boolean') share.show_title = body.show_title;
    let made: { pin?: string; password?: string } = {};
    if (body.secret === 'none') {
      share.has_pin = false;
      share.protection = [];
    } else if (body.secret === 'pin') {
      share.has_pin = true;
      share.protection = ['pin'];
      made = { pin: '7356' };
    } else if (body.secret === 'password') {
      share.has_pin = false;
      share.protection = ['password'];
      made = typeof body.password === 'string' ? {} : { password: 'cedar-wren-58' };
    }
    const kept = lib.shareSecrets.get(id);
    if (kept && body.secret) {
      const { pin: _p, password: _w, ...rest } = kept;
      lib.shareSecrets.set(id, { ...rest, ...made, ...(typeof body.password === 'string' ? { password: body.password } : {}) });
    }
    share.version = (share.version ?? 1) + 1;
    return json({ share, changed: Object.keys(body), ...made });
  }
  m = /^\/api\/v1\/shares\/([^/]+)$/.exec(q);
  if (m?.[1] && init.method === 'DELETE') {
    const id = m[1];
    const share = lib.shares.find((x) => x.id === id);
    if (!share) return failure(404, 'not_found', 'There is no such link.');
    share.state = 'revoked';
    return { ...json(null), status: 204, text: async () => '' } as Reply;
  }
  // No longer needed, and needed again (0.9.0), on a document the library keeps.
  m = /^\/api\/v1\/documents\/([^/]+)\/no-longer-needed$/.exec(q);
  if (m?.[1] && lib.documents.has(m[1]) && (init.method === 'POST' || init.method === 'DELETE')) {
    const doc = lib.documents.get(m[1]) as DocumentView;
    const next = (
      init.method === 'POST'
        ? {
            ...doc,
            no_longer_needed: {
              at: new Date().toISOString(),
              by_name: 'Fake Owner',
              reason: (body.reason as string | null | undefined) ?? null,
              replaced_by: null,
            },
            status: { value: 'no_longer_needed', label: 'No longer needed' },
          }
        : { ...doc, no_longer_needed: null, status: { value: 'valid', label: '' } }
    ) as DocumentView;
    lib.documents.set(doc.id, { ...next, etag: nextEtag() });
    return json(lib.documents.get(doc.id));
  }
  // Who can see it (P8), as the vault of 0.9.0 answers it.
  m = /^\/api\/v1\/documents\/([^/]+)\/visibility$/.exec(q);
  if (m?.[1] && init.method === 'POST' && lib.documents.has(m[1])) {
    const doc = lib.documents.get(m[1]) as DocumentView;
    const own = lib.ownLinks.get(doc.id);
    if (body.visibility === 'private' && own && body.own_links === undefined) {
      const links = Array.from({ length: own.links }, (_, i) => ({ id: `link-${i}` }));
      const error = {
        code: 'links_choice_needed',
        message: 'You have share links to this document.',
        detail: JSON.stringify({ links, keep_allowed: own.keep, others: 0 }),
      };
      return { ...failure(409, 'links_choice_needed', error.message), json: async () => ({ error }) } as Reply;
    }
    lib.visibilityChanges.push({
      id: doc.id,
      visibility: String(body.visibility),
      ...(typeof body.own_links === 'string' ? { own_links: body.own_links } : {}),
    });
    lib.documents.set(doc.id, { ...doc, visibility: body.visibility as DocumentView['visibility'], etag: nextEtag() });
    const notice =
      body.own_links === 'end' ? { title: 'Links ended', body: 'Your share links to it have ended.' } : null;
    return json({ notice });
  }
  m = /^\/api\/v1\/documents\/([^/]+)\/collections$/.exec(q);
  if (m?.[1] && init.method === 'GET' && lib.documents.has(m[1])) {
    return json({ items: (lib.collections.get(m[1]) ?? []).map((c) => ({ ...c, description: null, mine: true, item_count: 1 })) });
  }
  // A new version's details (P2), as the vault of 0.9.0 answers them.
  m = /^\/api\/v1\/documents\/([^/]+)\/suggestions$/.exec(q);
  if (m?.[1] && init.method === 'GET' && lib.documents.has(m[1])) {
    lib.asked.push(m[1]);
    return json(lib.suggestions.get(m[1]) ?? { state: 'unavailable', version_id: null, proposal: {} });
  }
  m = /^\/api\/v1\/documents\/([^/]+)\/renewal(\/undo)?$/.exec(q);
  if (m?.[1] && init.method === 'POST' && lib.documents.has(m[1])) {
    const doc = lib.documents.get(m[1]) as DocumentView;
    if (m[2]) {
      const before = lib.undoable.get(doc.id);
      if (!before) return failure(409, 'renewal_not_undoable', 'This can no longer be undone.');
      lib.undoable.delete(doc.id);
      const back = { ...before, details_unconfirmed: true, etag: nextEtag() } as DocumentView;
      lib.documents.set(doc.id, back);
      return json(back);
    }
    const ifMatch = Object.entries(init.headers).find(([k]) => k.toLowerCase() === 'if-match')?.[1];
    if (!ifMatch) return failure(428, 'precondition_required', 'Send the document as you last saw it.');
    if (ifMatch !== doc.etag) return failure(409, 'conflict', 'Someone changed this.');
    if (body.version_id !== doc.latest_version_id) return failure(409, 'version_changed', 'Not its newest version.');
    if (lib.undoable.has(doc.id)) return failure(409, 'renewal_undo_open', 'Undo the last one first.');
    lib.renewals.push(body);
    const { version_id: _version, ...fields } = body;
    const next = { ...doc, ...fields, details_unconfirmed: false, etag: nextEtag() } as DocumentView;
    lib.undoable.set(doc.id, doc);
    lib.documents.set(doc.id, next);
    return json({ document: next, undo_until: new Date(Date.now() + 5 * 60_000).toISOString() });
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
  // Identity numbers (5.26), asked for as the vault asks: one's own with any
  // credential (`reveal_identity`); another person's with a code, never the
  // password (`open_identity`), once two-step sign-in is there to ask with —
  // without it the client's fake refuses outright.
  m = /^\/api\/v1\/members\/([^/]+)\/identity\/reveal$/.exec(q);
  if (m?.[1] && init.method === 'POST') {
    const self = decodeURIComponent(m[1]) === 'fake-member';
    if (self && !lib.verified) {
      return failure(403, 'step_up_required', 'Please confirm it is you to see your identity numbers.', 'reveal_identity');
    }
    if (!self && t.vault.state.ownerTwoStep && !lib.factorVerified) {
      return failure(
        403,
        'step_up_required',
        "Please confirm it is you to see another person's identity numbers.",
        'open_identity',
      );
    }
    return null;
  }
  // A reminder somebody sets themselves (0.9.0-dev.27): due when its day has come, else coming up; a yearly review too.
  if (q === '/api/v1/reminders' && init.method === 'POST') {
    const today = new Date().toISOString().slice(0, 10);
    const fire = String(body.fire_at);
    const doc = lib.documents.get(String(body.document_id));
    const made = {
      id: `mine-${t.reminders.length + t.upcoming.length + 1}`,
      document_id: String(body.document_id),
      document_title: doc?.title ?? null,
      kind: 'manual',
      fire_at: fire,
      lead_days: null,
      note: (body.note as string | null | undefined) ?? null,
      recurrence: null,
      status: fire <= today ? 'due' : 'scheduled',
      snoozed_until: null,
      label: fire <= today ? 'Due today' : `In some days · ${fire}`,
      source: null,
      about: null,
      // A yearly review (H3): every year, in the vault's words.
      ...(body.review === true ? { review: true, note: 'Yearly review', recurrence: 'annual' } : {}),
    } as ReminderView;
    if (fire <= today) t.reminders.push(made);
    else t.upcoming.push(made);
    return { ...json(made), status: 201 } as Reply;
  }
  m = /^\/api\/v1\/reminders\/([^/]+)$/.exec(q);
  if (m?.[1] && init.method === 'DELETE') {
    const id = m[1];
    const r = [...t.reminders, ...t.upcoming].find((x) => x.id === id && x.kind === 'manual');
    if (!r) return failure(404, 'not_found', 'Only reminders you set yourself can be removed.');
    t.reminders = t.reminders.filter((x) => x.id !== id);
    t.upcoming = t.upcoming.filter((x) => x.id !== id);
    return { ...json(null), status: 204, text: async () => '' } as Reply;
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

export function json(body: unknown): Awaited<ReturnType<FetchLike>> {
  return {
    ok: true,
    status: 200,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(body)).buffer,
  } as unknown as Awaited<ReturnType<FetchLike>>;
}

/** A JSON answer with its own status and headers. */
function answer(status: number, body: unknown, headers: Record<string, string> = {}): Awaited<ReturnType<FetchLike>> {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'application/json' : (lower[h.toLowerCase()] ?? null)) },
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(body)).buffer,
  } as unknown as Awaited<ReturnType<FetchLike>>;
}

/** A body as the vault fingerprints it: its keys in any order. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
    .join(',')}}`;
}

/**
 * POST /documents's Idempotency-Key as the real vault keeps it
 * (0.9.0-dev.45, documents/create-once.ts) — the order the client's fake
 * does not keep: the request is checked first (its words, who may make it:
 * a refusal keeps no key), then the key, scoped to the household, the
 * account and the person signed in, for 24 hours on the test's own clock.
 * The same key and body again: 201, Idempotent-Replayed. Another body: 422
 * idempotency_key_reused. What it made and the caller can no longer see
 * (`hide`): 404 created_not_visible. Removed for good: the key goes with it.
 */
export function keysAsDev45(t: TestVault, now: () => number = () => Date.now()) {
  const keys = new Map<string, { fingerprint: string; id: string; made: unknown; at: number }>();
  const hidden = new Set<string>();
  const inner = t.fetch;
  t.fetch = async (url, init) => {
    const key = init.headers['idempotency-key'];
    if (init.method !== 'POST' || !url.endsWith('/api/v1/documents') || key === undefined) return inner(url, init);
    const headers = Object.fromEntries(Object.entries(init.headers).filter(([k]) => k !== 'idempotency-key'));
    const auth = (init.headers.authorization ?? '').replace(/^Bearer /, '');
    const session = t.vault.state.sessions.find((s) => s.id === t.vault.state.access.get(auth));
    const member = (session as { memberId?: string } | undefined)?.memberId ?? 'fake-member';
    const scope = `fake-household|account:${member}|${member}|${key}`;
    const fingerprint = canonical(JSON.parse(String(init.body ?? 'null')));
    // Checked as any create is, before the key: refused, it keeps none.
    const res = await inner(url, { ...init, headers });
    if (!res.ok) return res;
    const made = (await res.json()) as { id: string };
    const prior = keys.get(scope);
    const live = prior && now() - prior.at < 24 * 60 * 60 * 1000 && t.vault.state.documents.some((d) => d.id === prior.id);
    if (!prior || !live) {
      keys.set(scope, { fingerprint, id: made.id, made, at: now() });
      return answer(201, made);
    }
    // The key was there: this request makes nothing.
    t.vault.state.documents = t.vault.state.documents.filter((d) => d.id !== made.id);
    if (prior.fingerprint !== fingerprint) {
      return answer(422, {
        error: {
          code: 'idempotency_key_reused',
          message: 'That Idempotency-Key was already used for a different request. Send a new key with a new request.',
          retriable: false,
        },
      });
    }
    if (hidden.has(prior.id)) {
      return answer(
        404,
        { error: { code: 'created_not_visible', message: 'What this Idempotency-Key made is no longer there for you.' } },
        { 'idempotent-replayed': 'true' },
      );
    }
    return answer(201, prior.made, { 'idempotent-replayed': 'true' });
  };
  return {
    /** What a key made, no longer the caller's to see (made Only me by its person). */
    hide: (id: string) => hidden.add(id),
    keys,
  };
}
