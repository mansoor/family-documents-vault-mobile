import {
  documentName,
  formatDate,
  NOTE_KIND,
  sensitiveOf,
  whereKeptWords,
  type Capabilities,
  type CoreField,
  type DocumentTypeView,
  type DocumentView,
  type Member,
  type VersionView,
} from '@fdv/shared';
import type { TFunction } from 'i18next';
import { isCaregiverPaper } from '../caregivers/rules';
import { detailFacts } from '../documents/details';
import { latestOf } from '../documents/online';
import type { DetailsSheet } from './document-print';

/**
 * What a document's page says of it, worked out once (app 0.25.0): for its
 * page, and for Print from a ⋯ or a ⋮, which prints exactly what its page
 * would — the same heading, the same sheet of details and the same notice
 * for anything Sensitive.
 */

/** What its page says of a document: its name, whose it is, its line, its facts, Sensitive and where it is kept. */
export interface DocumentWords {
  name: string;
  type: DocumentTypeView | undefined;
  /** Whose: a person, or the household's (0.9.0-dev.32); Not sure yet says nothing (its status does). */
  whose: string | null;
  /** Whose · what kind · who can see it, on one line. */
  subline: string;
  /** Its dates and its kind's own details, under the kind's own names. */
  facts: [string, string][];
  /** Sensitive, all said (0.9.0-dev.34, AIR2): the vault's answer, else the one rule. */
  sensitive: boolean;
  /** Where the original is kept, on a vault that keeps places in cabinets (C3). */
  place: string | null;
}

export function documentWords(
  shown: DocumentView,
  ctx: {
    /** The vault's own answer for it, when there is one: its kind's details come from that alone. */
    doc: DocumentView | null;
    members: readonly Member[];
    types: readonly DocumentTypeView[];
    caps: Pick<Capabilities, 'features'> | null;
    t: TFunction;
  },
): DocumentWords {
  const { t, caps } = ctx;
  const note = shown.type_key === NOTE_KIND;
  // Seen only as its person's caregiver (H1b).
  const caregiver = isCaregiverPaper(shown);
  const owner = ctx.members.find((m) => m.id === shown.owner_member_id);
  // The type's own details, from the vault's answer for this document only:
  // an Only me document's are sealed everywhere else (a list, the offline
  // set, so a kept copy) and opened there for its owner (0.5.8).
  const type = ctx.types.find((x) => x.key === shown.type_key);
  const details = ctx.doc
    ? detailFacts(type?.fields, ctx.doc.extra, { yes: t('document.yes'), no: t('document.no') })
    : [];
  // The fixed details under the kind's own names (H3: an advance directive's Issued is "Signed", an insurance
  // card's Issued by its "Insurer"), and not at all where the kind hides one.
  const core = (key: CoreField, fallback: string): string | null =>
    type?.core?.[key]?.shown === false ? null : type?.core?.[key]?.label?.trim() || fallback;
  const facts = (
    [
      [core('issued_by', type?.issued_by_label?.trim() || t('document.issuedBy')), shown.issued_by ?? null],
      [core('issued', t('document.issued')), shown.issued ? formatDate(shown.issued) : null],
      [core('expires', t('document.expires')), shown.expires ? formatDate(shown.expires) : null],
      ...details,
    ] as [string | null, string | null][]
  ).filter((f): f is [string, string] => !!f[0] && !!f[1]);
  // Whose · what kind · who can see it: what the old page said in three places, on one line.
  const whose = owner?.display_name ?? (shown.household_owned ? t('capture.household') : null);
  // Somebody else's Only me, seen as their caregiver, is never said to be "Only me" (H1b): its mark says whose.
  const subline = [whose, note ? null : type?.label, caregiver ? null : t(`document.visibility_${shown.visibility}`)]
    .filter(Boolean)
    .join(' · ');
  const sensitive =
    caps?.features.sensitive_documents === true && (shown.sensitive_effective ?? sensitiveOf(shown, type));
  // Where the original is: the household's, as its page says it; the vault leaves it out for anybody else.
  const place = caps?.features.original_place === true && !note && !caregiver ? whereKeptWords(shown) : null;
  return { name: documentName(shown, t('document.untitled')), type, whose, subline, facts, sensitive, place };
}

/**
 * Whether a document is printed from its page (0.21.0), and so from its ⋯:
 * for whoever sees it as one of the family (a caregiver saves a copy); a
 * note only once its words are here — or, from a list, once they are
 * given after "Confirm it's you" (`confirm_to_read`), which its page asks
 * as it opens.
 */
export function mayPrint(
  doc: Pick<DocumentView, 'type_key' | 'notes'> & { caregiver?: true | undefined; confirm_to_read?: unknown },
  opts: { asking?: boolean } = {},
): boolean {
  if (isCaregiverPaper(doc)) return false;
  if (doc.type_key !== NOTE_KIND) return true;
  return !!doc.notes || (opts.asking === true && !!doc.confirm_to_read);
}

/** What `PrintDocument` is given for a document, as its page gives it. */
export interface PrintableDocument {
  name: string;
  subline: string | null;
  sheet: DetailsSheet;
  latestId: string | null;
  drawn: boolean;
}

/** A document's print, from what its page has: its words (`documentWords`) and its versions. */
export function printable(
  shown: DocumentView,
  words: DocumentWords,
  versions: readonly VersionView[],
  t: TFunction,
): PrintableDocument {
  const note = shown.type_key === NOTE_KIND;
  const caregiver = isCaregiverPaper(shown);
  const latest = latestOf([...versions]);
  // A health record kept as it is (0.9.0-dev.51, H5): never drawn, so no pages to print.
  const asIs = latest?.stored_as_is === true;
  return {
    name: words.name,
    subline: words.subline || null,
    sheet: {
      kind: note ? null : (words.type?.label ?? null),
      whose: words.whose,
      status: shown.status,
      whoCanSee: caregiver
        ? t('caregivers.whoCanSee', { name: words.whose ?? t('caregivers.someone') })
        : t(`document.visibility_${shown.visibility}`),
      sensitive: words.sensitive,
      place: words.place,
      facts: words.facts,
      noteLabel: words.type?.core?.notes?.label?.trim() || t('document.notes'),
      note: shown.notes_updated_at !== undefined && !caregiver ? (shown.notes ?? null) : null,
    },
    latestId: latest?.id ?? null,
    drawn: !asIs && !!latest,
  };
}
