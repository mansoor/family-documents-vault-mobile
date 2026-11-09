import { can, inCollectionAudience, type Capabilities, type CollectionView, type Role } from '@fdv/shared';

/**
 * Collections on the phone (P9), by the web's rules (5.14, A17, A18).
 *
 * Offered at all: the vault has them (`features.collections`) and the
 * person makes them (`collection.manage`: owners, adults and teens). A
 * viewer is offered nothing about collections, as on the web.
 */
export function collectionsOffered(caps: Capabilities | null, role: Role | null | undefined): boolean {
  return caps?.features.collections === true && !!role && can(role, 'collection.manage');
}

/**
 * Whether the person may change what is in a collection: its maker, while
 * they are in its audience. The vault decides regardless; this only decides
 * what is drawn.
 */
export function mayChangeCollection(
  role: Role | null | undefined,
  collection: Pick<CollectionView, 'mine' | 'audience'>,
): boolean {
  return !!role && collection.mine && inCollectionAudience(role, collection.audience);
}

/** The collection's audience, as the i18n keys name it ("collections.audience_everyone"). */
export const audienceKey = (audience: string): string =>
  ['everyone', 'adults', 'teens', 'only_me'].includes(audience)
    ? `collections.audience_${audience}`
    : 'collections.audience_some';
