import { formatDate, type DateValue, type DocumentInput, type DocumentView } from '@fdv/shared';
import {
  CARD_CORE,
  coreAsk,
  ownFields,
  toMetadata,
  typeOf,
  type Draft,
  type FieldErrors,
  type Household,
} from '../capture/draft';
import type { CaptureSource } from '../queue/commit';

/**
 * Edit details (P8): a document's details on the capture card's own rules
 * (capture/draft.ts), so the phone checks exactly what the card checks and
 * the vault refuses nothing the card would have let through. Pure, so the
 * rules are tested without drawing the screen.
 *
 * Who can see it and Essential are changed on the document's page, not
 * here: the edit sends neither. A field the person empties is sent as null,
 * so it is taken away; a field the kind does not show is not sent at all.
 */

/** An edit has no pages of its own: the card's rules never look at them. */
const NO_PAGES = { kind: 'pages', pages: [] } as unknown as CaptureSource;

/** A date as the card's field holds it, read back by parseDateInput: "14 Mar 2031", "Mar 2031", "2031". */
export const dateText = (v: DateValue | null | undefined): string => (v ? formatDate(v) : '');

/** One of the kind's own details as the card holds it: words, a choice, or a yes/no. */
function detailText(value: unknown): string | boolean {
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && 'date' in (value as object)) return dateText(value as DateValue);
  return String(value);
}

/** The card, filled from the document as the vault has it. */
export function draftOf(doc: DocumentView): Draft {
  return {
    source: NO_PAGES,
    typeKey: doc.type_key ?? null,
    ownerId: doc.owner_member_id ?? null,
    household: doc.household_owned === true,
    sensitive: doc.sensitive ?? null,
    visibility: doc.visibility,
    essential: doc.is_essential,
    title: doc.title ?? '',
    issuedBy: doc.issued_by ?? '',
    identifier: doc.identifier ?? '',
    issued: dateText(doc.issued),
    expires: dateText(doc.expires),
    location: doc.physical_location ?? '',
    details: Object.fromEntries(Object.entries(doc.extra ?? {}).map(([k, v]) => [k, detailText(v)])),
  };
}

/**
 * Save: what PATCH /documents/{id} is sent, or what is wrong first, in the
 * card's words. `confirm` (a vault with `version_details`, and only for
 * this whole card) says the newest version's details are now confirmed.
 * `sensitiveWas` is the document's own Sensitive as it was opened: the
 * choice is sent only when it changed (a vault with `sensitive_documents`),
 * as the web's edit does, so an edit never puts back what was there.
 */
export function editBody(
  d: Draft,
  h: Household,
  opts: { confirm: boolean; sensitiveWas?: boolean | null },
): { body: DocumentInput | null; fields: FieldErrors; problem: string | null; missing: string[] } {
  // Sensitive is checked only when changed: a teen's paper already marked No is theirs to keep so.
  const sensitiveChanged = h.sensitive === true && opts.sensitiveWas !== undefined && d.sensitive !== opts.sensitiveWas;
  const { metadata: m, fields, problem, missing } = toMetadata(sensitiveChanged ? d : { ...d, sensitive: null }, h);
  if (Object.keys(fields).length > 0 || problem || missing.length > 0) {
    return { body: null, fields, problem: problem?.message ?? null, missing };
  }
  const type = typeOf(d, h);
  const body: DocumentInput = {
    type_key: m.type_key ?? null,
    owner_member_id: m.owner_member_id ?? null,
    title: m.title ?? null,
    // The household's, or not (Not sure yet, or a person's): said either way where the vault keeps it.
    ...(h.householdOwner ? { household_owned: !m.owner_member_id && d.household } : {}),
  };
  for (const key of CARD_CORE) {
    if (!coreAsk(type, key, h).shown) continue;
    Object.assign(body, { [key]: (m as Record<string, unknown>)[key] ?? null });
  }
  const own = ownFields(type, h);
  if (own.length > 0) {
    body.extra = Object.fromEntries(own.map((f) => [f.key, m.extra?.[f.key] ?? null]));
  }
  if (sensitiveChanged) body.sensitive = d.sensitive;
  if (opts.confirm) body.confirm_details = true;
  return { body, fields, problem: null, missing };
}
