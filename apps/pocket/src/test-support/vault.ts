import type { FetchLike } from '@fdv/client';
import { createFakeVault } from '@fdv/client/testing';
import type { Capabilities, ReminderView } from '@fdv/shared';

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
}

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
    fetch: async (url, init) => {
      t.calls.push(`${init.method} ${url}`);
      const origin = /^[a-z]+:\/\/[^/]+/i.exec(url)?.[0] ?? '';
      if (!t.reachable.has(origin)) throw new TypeError('Network request failed');
      const path = url.slice(origin.length);
      if (path.startsWith('/api/v1/reminders?')) return json({ items: t.reminders });
      if (url.endsWith('/api/v1/capabilities')) {
        return json(t.impostor.get(origin) ?? t.caps);
      }
      return vault.fetch(url, init);
    },
  };
  return t;
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
