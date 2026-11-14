import {
  can,
  collectionPowers,
  type Capabilities,
  type CollectionPowers,
  type CollectionView,
  type Role,
} from '@fdv/shared';

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

/** Nothing at all: no role yet. */
const NO_POWERS: CollectionPowers = {
  maker: false,
  manager: false,
  edit: false,
  change_audience: false,
  delete: false,
  choose_managers: false,
  remove_managers: false,
};

/**
 * What the person may do with a collection now (app 0.10.0, the vault's
 * collection managers): the vault's `my_powers`, where it has managers
 * (`features.collection_managers`). An older vault's answer is read as
 * before: its maker, in its audience, changes it, and deletes it whatever
 * their role now. The vault decides regardless; this only decides what is
 * drawn.
 */
export function powersFor(
  caps: Capabilities | null | undefined,
  role: Role | null | undefined,
  collection: Pick<CollectionView, 'mine' | 'audience' | 'my_powers'>,
): CollectionPowers {
  if (!role) return NO_POWERS;
  const managers = caps?.features.collection_managers === true;
  const { my_powers: _fromVault, ...asBefore } = collection;
  return collectionPowers(role, managers ? collection : asBefore);
}

/**
 * Whether the person may change a collection — its name and words, what is
 * in it, its checklist: its maker in its audience, or a manager they chose.
 */
export function mayChangeCollection(
  caps: Capabilities | null | undefined,
  role: Role | null | undefined,
  collection: Pick<CollectionView, 'mine' | 'audience' | 'my_powers'>,
): boolean {
  return powersFor(caps, role, collection).edit;
}

/**
 * Whether a collection's Managers are shown (app 0.10.0): the vault has
 * them, and tells this person who they are (`managers` is null for a viewer
 * or a guest). Nobody to tell of, and nothing the person may do about it:
 * not shown, as on the web.
 */
export function managersShown(
  caps: Capabilities | null | undefined,
  role: Role | null | undefined,
  collection: Pick<CollectionView, 'mine' | 'audience' | 'my_powers' | 'managers'>,
): boolean {
  if (caps?.features.collection_managers !== true || !collection.managers) return false;
  const powers = powersFor(caps, role, collection);
  return powers.choose_managers || powers.remove_managers || collection.managers.length > 0;
}

/** The collection's audience, as the i18n keys name it ("collections.audience_everyone"). */
export const audienceKey = (audience: string): string =>
  ['everyone', 'adults', 'teens', 'only_me'].includes(audience)
    ? `collections.audience_${audience}`
    : 'collections.audience_some';
