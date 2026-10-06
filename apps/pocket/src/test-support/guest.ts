import { createApi, createHttp, SessionCore } from '@fdv/client';
import type { AccessGrant } from '@fdv/shared';
import { installationId, SecureTokenStore } from '../session/store';
import type { TestVault } from './vault';

/**
 * Somebody limited (5.33) and somebody from outside the family (5.34), as
 * the client's fake keeps them: limits by member id, and a guest with a
 * sign-in of their own whose access ends at `end`.
 */

export const GUEST = { id: 'guest-jane', name: 'Jane Smith', email: 'jane@example.test', password: 'jane horse battery' };

/** What an owner gives a viewer: nobody's documents but those named, unless said. */
export function grant(over: Partial<AccessGrant> = {}) {
  return {
    people: [],
    types: [],
    collections: [],
    include_adults_only: false,
    include_no_person_docs: false,
    expires_at: null,
    limits_people: (over.people?.length ?? 0) > 0,
    limits_types: (over.types?.length ?? 0) > 0,
    reconfirm_since: null,
    private_confirmed: false,
    updated_at: '2026-10-01T00:00:00Z',
    ...over,
  };
}

/** A guest of the family's — a viewer, always limited — whose access ends at `end`. */
export function addGuest(t: TestVault, end: string, limits: Partial<AccessGrant> = { people: ['fake-member'] }) {
  t.vault.state.members.push({
    id: GUEST.id,
    display_name: GUEST.name,
    role: 'viewer',
    is_me: false,
    kind: 'guest',
    access_expires_at: end,
  });
  t.vault.state.signIns.push({ member_id: GUEST.id, email: GUEST.email, password: GUEST.password });
  t.vault.state.restrictions.set(GUEST.id, grant(limits));
}

/** Their access ends now: it ended a minute ago. */
export function endGuest(t: TestVault) {
  const m = t.vault.state.members.find((x) => x.id === GUEST.id);
  if (m) m.access_expires_at = new Date(Date.now() - 60_000).toISOString();
}

/** The phone's session is this person's, as the app keeps one after signing in. */
export async function signedInAs(t: TestVault, email: string, password: string, origin = 'https://vault.test') {
  const api = createApi(createHttp({ baseUrl: origin, fetch: t.fetch, installationId: await installationId() }));
  const tokens = await api.signIn(email, password);
  if ('mfa_required' in tokens) throw new Error('no second step here');
  await new SessionCore({ refresh: (r) => api.refresh(r) }, new SecureTokenStore()).accept(tokens);
}
