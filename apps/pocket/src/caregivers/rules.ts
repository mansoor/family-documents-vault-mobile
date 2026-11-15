import {
  mayGiveCare,
  mayNameOwnCaregiver,
  type Capabilities,
  type CaregiverGrantView,
  type Role,
} from '@fdv/shared';
import type { TFunction } from 'i18next';

/**
 * Caregivers and turning 18 on the phone (app 0.12.0; the vault's
 * 0.9.0-dev.43, H1b of the health plan; the owner's decisions of 14 Nov
 * 2026), by the web's rules (apps/web/src/caregivers.tsx). Pure, so the
 * rules are tested without drawing a screen.
 *
 * A person names a caregiver, who then reads that person's Medical papers,
 * their Only me ones included, and changes none of them. The vault and the
 * database decide who may do what; the phone only draws what would not be
 * refused. An older vault (no `features.caregivers`) is shown nothing new.
 */

/** The vault has caregivers at all. */
export const caregiversOn = (caps: Capabilities | null | undefined): boolean => caps?.features.caregivers === true;

/**
 * More -> Caregivers, as the web's Settings offers it: whoever may name
 * their own caregiver or be one — owners, adults and teens. A viewer, and
 * so a guest, has none.
 */
export const caregiversOffered = (caps: Capabilities | null | undefined, role: Role | null | undefined): boolean =>
  caregiversOn(caps) && (mayNameOwnCaregiver(role) || mayGiveCare(role));

/**
 * A paper the person sees only as somebody's caregiver (`caregiver: true`):
 * read, its pages looked at and a copy saved — nothing changed, shared,
 * collected or kept on the phone.
 */
export const isCaregiverPaper = (doc: { caregiver?: true | undefined } | null | undefined): boolean =>
  doc?.caregiver === true;

/** "Ahmed's", or "your" for the person themselves. */
const whose = (mine: boolean, name: string, t: TFunction) => (mine ? t('caregivers.your') : t('caregivers.theirs', { name }));

/** What a grant gives, on its line: "Can see your medical papers, Only me ones included." */
export function grantWords(g: CaregiverGrantView, mine: boolean, name: string, t: TFunction): string {
  if (g.confirmed) return t('caregivers.grantKept', { whose: whose(mine, name, t) });
  const by = g.granted_by_name ?? t('caregivers.anOwner');
  return mine ? t('caregivers.grantNamedMine', { by }) : t('caregivers.grantNamedTheirs', { by, name });
}

/** The button that ends a grant, by who is reading: Stop seeing them for its caregiver, Revoke otherwise. */
export const endLabel = (g: CaregiverGrantView, t: TFunction): string =>
  g.may_give_up ? t('caregivers.giveUp') : t('caregivers.revoke');

/**
 * The question asked before a grant ends (every destructive action is
 * confirmed on the phone, R2): giving it up as the caregiver, or revoking
 * it as the person (or an owner, for somebody without a sign-in).
 */
export function endWords(
  g: CaregiverGrantView,
  mine: boolean,
  name: string,
  t: TFunction,
): { title: string; words: string; confirm: string; done: string } {
  // The person reading is the caregiver (an owner may be one, of somebody they could also revoke for): giving it up.
  if (g.may_give_up) {
    return {
      title: t('caregivers.giveUpTitle', { name: g.person_name }),
      words: t('caregivers.giveUpWords', { name: g.person_name }),
      confirm: t('caregivers.giveUp'),
      done: t('caregivers.givenUp', { name: g.person_name }),
    };
  }
  const w = whose(mine, name, t);
  return {
    title: t('caregivers.revokeTitle', { who: g.caregiver_name, whose: w }),
    // One not kept yet never reached the Only me papers: it ends what the family sees through it.
    words: t(g.confirmed ? 'caregivers.revokeWords' : 'caregivers.revokeWordsUnkept', { who: g.caregiver_name, whose: w }),
    confirm: t('caregivers.revoke'),
    done: t('caregivers.revoked', { who: g.caregiver_name, whose: w }),
  };
}
