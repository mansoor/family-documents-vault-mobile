/**
 * When the phone's copies go (4.10), each rule tested both ways:
 *
 *  - The session was ended by the vault — revoked from another device,
 *    its token used twice, the person taken out of the household, or a
 *    token that is no good: every copy, at once.
 *  - It simply expired: the copies stay readable, up to their maximum age,
 *    with a banner asking to sign in so they can be checked.
 *  - Signing out, or changing server: every copy.
 *  - Somebody else signs in on this phone: every copy of the last person's.
 *  - Unchecked for longer than the vault allows: every copy, at the next
 *    unlock.
 *  - No connection is never a reason: nothing is removed for a network error.
 */

export type EndReason = 'expired' | 'revoked' | 'reused' | 'removed' | 'malformed' | string;

/** Whether a session that ended for this reason takes the copies with it. */
export function endWipes(reason: EndReason): boolean {
  return reason !== 'expired';
}

/** Whose copies these are: the vault and the person, as the phone knows them. */
export function ownerKey(origin: string, memberId: string): string {
  return `${origin}|${memberId}`;
}

export const OWNER_KEY = 'owner';
