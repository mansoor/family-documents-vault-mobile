import {
  autoTitle,
  can,
  checkCaptureMetadata,
  effectiveVisibility,
  missingFields,
  parseDateInput,
  type CaptureMetadata,
  type CaptureProblem,
  type DocumentTypeView,
  type RequiredValues,
  type Role,
  type TypeField,
  type Visibility,
} from '@fdv/shared';
import { MAX_PAGES, type CaptureSource, type PageRef } from '../queue/commit';

/**
 * The confirm card's answers, and what they become: the capture's
 * metadata, worked out exactly as the vault will check it. Pure, so the
 * card's rules are tested without drawing it.
 */
export interface Draft {
  source: CaptureSource;
  typeKey: string | null;
  ownerId: string | null;
  /** Null: the type's default, as the vault would choose it. */
  visibility: Visibility | null;
  /** Null: the type's usual. */
  essential: boolean | null;
  /** What was typed; empty means the name is made from the other answers. */
  title: string;
  issuedBy: string;
  identifier: string;
  issued: string;
  expires: string;
  location: string;
  /**
   * The type's own details, by field key, as the card holds them (a vault
   * with custom_types, 0.2.1): what was typed, the answer chosen, or a
   * yes/no.
   */
  details: Record<string, string | boolean>;
}

export interface Me {
  member_id: string;
  role: Role;
}

export interface Household {
  types: DocumentTypeView[];
  members: { id: string; display_name: string }[];
  me: Me;
  /** The vault takes issued_by (0.4.10). */
  issuedBy: boolean;
  /**
   * The vault keeps each type's own details and says which fields it
   * requires (`features.custom_types`, 0.5.11): the card asks for them, and
   * Save waits for the required ones. Without it the card is as in 0.2.0.
   */
  details: boolean;
}

/** The app speaks en-GB: 14/03/2031 is the fourteenth of March. */
export const DATE_ORDER = 'dmy' as const;

export function newDraft(source: CaptureSource, me: Me): Draft {
  return {
    source,
    typeKey: null,
    // A teen's scans are theirs; anyone else says whose it is.
    ownerId: me.role === 'teen' ? me.member_id : null,
    visibility: null,
    essential: null,
    title: '',
    issuedBy: '',
    identifier: '',
    issued: '',
    expires: '',
    location: '',
    details: {},
  };
}

// ---- the page strip, with no dragging: one pointer, one button each ----

function pages(d: Draft): PageRef[] {
  return d.source.kind === 'pages' ? d.source.pages : [];
}

function withPages(d: Draft, next: PageRef[]): Draft {
  return d.source.kind === 'pages' ? { ...d, source: { kind: 'pages', pages: next } } : d;
}

export function moveEarlier(d: Draft, i: number): Draft {
  const p = [...pages(d)];
  if (i <= 0 || i >= p.length) return d;
  [p[i - 1], p[i]] = [p[i] as PageRef, p[i - 1] as PageRef];
  return withPages(d, p);
}

export function moveLater(d: Draft, i: number): Draft {
  return moveEarlier(d, i + 1);
}

/** The page's file comes back so it can be deleted. */
export function removePage(d: Draft, i: number): { draft: Draft; removed: PageRef | null } {
  const p = [...pages(d)];
  if (p.length <= 1 || !p[i]) return { draft: d, removed: null };
  const [removed] = p.splice(i, 1);
  return { draft: withPages(d, p), removed: removed ?? null };
}

export function replacePage(d: Draft, i: number, page: PageRef): { draft: Draft; removed: PageRef | null } {
  const p = [...pages(d)];
  const old = p[i];
  if (!old) return { draft: d, removed: null };
  p[i] = page;
  return { draft: withPages(d, p), removed: old };
}

export function addPages(d: Draft, more: PageRef[]): { draft: Draft; dropped: PageRef[] } {
  const p = pages(d);
  const room = Math.max(0, MAX_PAGES - p.length);
  return {
    draft: withPages(d, [...p, ...more.slice(0, room)]),
    dropped: more.slice(room),
  };
}

export const pagesLeft = (d: Draft) => (d.source.kind === 'pages' ? MAX_PAGES - d.source.pages.length : 0);

// ---- choices ----

export function typeOf(d: Draft, h: Pick<Household, 'types'>): DocumentTypeView | undefined {
  return d.typeKey ? h.types.find((t) => t.key === d.typeKey) : undefined;
}

/** Who can see it, as the vault will decide when nobody chooses. */
export function visibilityOf(d: Draft, h: Household): Visibility {
  return effectiveVisibility(d.visibility ? { visibility: d.visibility } : {}, typeOf(d, h), h.me.role);
}

/** Which of Everyone, Adults only and Only me may be chosen now. */
export function visibilityChoices(d: Draft, h: Household): Record<Visibility, boolean> {
  return {
    household: true,
    adults: can(h.me.role, 'document.see_adults'),
    private: d.ownerId === h.me.member_id,
  };
}

export function chooseType(d: Draft, key: string | null): Draft {
  // The type decides the defaults, so a choice made for another type goes.
  return {
    ...d,
    typeKey: key,
    visibility: null,
    essential: null,
    expires: key === d.typeKey ? d.expires : '',
    // Another type asks for other details.
    details: key === d.typeKey ? d.details : {},
  };
}

export function chooseOwner(d: Draft, ownerId: string | null, h: Household): Draft {
  if (h.me.role === 'teen') return d;
  const next = { ...d, ownerId };
  // Only me is for your own documents: given to someone else, it becomes
  // the closest thing that is not.
  if (visibilityOf(next, h) === 'private' && ownerId !== h.me.member_id) {
    next.visibility = can(h.me.role, 'document.see_adults') ? 'adults' : 'household';
  }
  return next;
}

export function essentialOf(d: Draft, h: Pick<Household, 'types'>): boolean {
  return d.essential ?? typeOf(d, h)?.usually_essential ?? false;
}

/** The name the document gets if nobody types one. */
export function suggestedTitle(d: Draft, h: Household): string | null {
  const type = typeOf(d, h);
  if (!type) return null;
  const owner = h.members.find((m) => m.id === d.ownerId) ?? null;
  const issued = parseDateInput(d.issued, { order: DATE_ORDER }) ?? null;
  return autoTitle(type, owner, {
    issued_by: h.issuedBy ? d.issuedBy.replace(/\s+/g, ' ') : null,
    issued,
  });
}

/**
 * What the card says is wrong with a field, by the field: `issued`,
 * `expires`, or `detail:<key>` for one of the type's own details.
 */
export type FieldErrors = Partial<Record<string, string>>;

/** Where a type's own detail is wrong, in FieldErrors. */
export const detailError = (key: string) => `detail:${key}`;

export const DATE_HINT = 'A date, a month (March 2031) or a year';

/** The fixed fields the card has an input for, in its order. Tags and notes it does not ask. */
export const CARD_CORE = ['issued_by', 'identifier', 'issued', 'expires', 'physical_location'] as const;
export type CardCore = (typeof CARD_CORE)[number];

/** How the card asks for one of the fixed fields: whether, the type's own name for it, and whether Save waits. */
export interface CoreAsk {
  shown: boolean;
  /** The type's name for it ("Passport number"); null is the card's own word. */
  label: string | null;
  required: boolean;
}

/**
 * The fields a type requires, by the vault's own rule (`missingFields` of a
 * document with nothing in it): an expiry for every type that expires, the
 * fixed fields it requires, then its own. None on a vault without
 * custom_types, where the card never waits.
 */
export function requiredKeys(type: DocumentTypeView | undefined, h: Pick<Household, 'details'>): Set<string> {
  return new Set(h.details && type ? missingFields(type, {}).map((m) => m.key) : []);
}

/** How the card asks for a fixed field, for this type (as in 0.2.0 on a vault without custom_types). */
export function coreAsk(
  type: DocumentTypeView | undefined,
  key: CardCore,
  h: Pick<Household, 'details' | 'issuedBy'>,
): CoreAsk {
  const rule = h.details ? type?.core?.[key] : undefined;
  const shown =
    key === 'expires'
      ? Boolean(type?.expiry_driver)
      : (key !== 'issued_by' || h.issuedBy) && rule?.shown !== false;
  return { shown, label: rule?.label ?? null, required: shown && requiredKeys(type, h).has(key) };
}

/** The type's own fields the card asks for, in the type's order: none without custom_types. */
export function ownFields(type: DocumentTypeView | undefined, h: Pick<Household, 'details'>): TypeField[] {
  return h.details && type ? type.fields : [];
}

/**
 * A comma is read only where it groups thousands: 1,234 and 1,234.50. Any
 * other (12,50, 3,5) may be a decimal comma, and is never guessed at: read
 * as thousands it would keep an amount 100 times too big. The web card's
 * rule (apps/web/src/details.tsx, 0.5.11); @fdv/shared has no reader to share.
 */
const THOUSANDS = /^[-+]?\d{1,3}(,\d{3})+(\.\d*)?$/;

/**
 * One of the type's own details as the vault keeps it, from what the card
 * holds: null for no value, or why it cannot be read. A required yes/no
 * left alone says no, as its switch shows, and is sent so.
 */
export function readDetail(
  field: Pick<TypeField, 'kind' | 'required'>,
  raw: string | boolean | undefined,
): { value: unknown } | { message: string } {
  if (field.kind === 'yes_no') return { value: typeof raw === 'boolean' ? raw : field.required ? false : null };
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (text === '') return { value: null };
  switch (field.kind) {
    case 'date': {
      const v = parseDateInput(text, { order: DATE_ORDER });
      return v ? { value: v } : { message: `That isn't a date we can read. ${DATE_HINT}.` };
    }
    case 'year':
      return /^\d{4}$/.test(text) ? { value: Number(text) } : { message: 'That should be a year, such as 2026.' };
    case 'number': {
      const typed = text.replace(/\s/g, '');
      if (typed.includes(',') && !THOUSANDS.test(typed)) return { message: 'Use a point for a decimal, such as 3.5.' };
      // Written out in figures, as the web card takes it: never 0x10 or 1e3.
      const n = typed.replace(/,/g, '');
      return /^[-+]?(\d+\.?\d*|\.\d+)$/.test(n)
        ? { value: Number(n) }
        : { message: 'That should be a number, such as 42.' };
    }
    case 'money': {
      const typed = text.replace(/[£$€\s]/g, '');
      if (typed.includes(',') && !THOUSANDS.test(typed)) return { message: 'Use a point for pence, such as 12.50.' };
      const amount = typed.replace(/,/g, '');
      return /^-?(\d+(\.\d{1,2})?|\.\d{1,2})$/.test(amount)
        ? { value: Number(amount) }
        : { message: 'That should be an amount, such as 12.50.' };
    }
    default:
      // Text, a choice, and a kind this app does not know yet: as written.
      return { value: text };
  }
}

/** "Passport number and Expires"; "A, B and C". */
export function andList(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/**
 * Save: every answer given, as the vault takes it — or what is wrong with
 * them, in the vault's own words, before anything is kept. `missing` is
 * what Save waits for (custom_types): the required fields the card asks
 * for and has no value for, in its order.
 */
export function toMetadata(
  d: Draft,
  h: Household,
): {
  metadata: CaptureMetadata;
  fields: FieldErrors;
  problem: CaptureProblem | null;
  missing: string[];
} {
  const type = typeOf(d, h);
  const fields: FieldErrors = {};
  const date = (raw: string, field: 'issued' | 'expires') => {
    if (raw.trim() === '') return undefined;
    const v = parseDateInput(raw, { order: DATE_ORDER });
    if (!v) fields[field] = `That isn't a date we can read. ${DATE_HINT}.`;
    return v ?? undefined;
  };
  const text = (s: string) => (s.trim() === '' ? undefined : s.trim());
  // A fixed field the type does not show is not sent (custom_types).
  const asks = (key: CardCore) => coreAsk(type, key, h).shown;
  const m: CaptureMetadata = {};
  if (d.typeKey) m.type_key = d.typeKey;
  if (d.ownerId) m.owner_member_id = d.ownerId;
  m.visibility = visibilityOf(d, h);
  m.is_essential = essentialOf(d, h);
  const title = text(d.title) ?? suggestedTitle(d, h);
  if (title) m.title = title;
  const issued = asks('issued') ? date(d.issued, 'issued') : undefined;
  if (issued) m.issued = issued;
  const expires = type?.expiry_driver ? date(d.expires, 'expires') : undefined;
  if (expires) m.expires = expires;
  const identifier = asks('identifier') ? text(d.identifier) : undefined;
  if (identifier) m.identifier = identifier;
  const issuedBy = asks('issued_by') ? text(d.issuedBy) : undefined;
  if (issuedBy) m.issued_by = issuedBy.replace(/\s+/g, ' ');
  const location = asks('physical_location') ? text(d.location) : undefined;
  if (location) m.physical_location = location;
  // The type's own details (custom_types): only those with a value.
  const own = ownFields(type, h);
  const extra: Record<string, unknown> = {};
  for (const f of own) {
    const read = readDetail(f, d.details[f.key]);
    if ('message' in read) fields[detailError(f.key)] = read.message;
    else if (read.value !== null) extra[f.key] = read.value;
  }
  if (Object.keys(extra).length > 0) m.extra = extra;
  let problem = checkCaptureMetadata(m, {
    me: h.me,
    members: h.members,
    types: h.types,
  });
  // A detail the vault would refuse is said on the detail itself.
  if (problem?.field === 'extra' && problem.key && own.some((f) => f.key === problem?.key)) {
    fields[detailError(problem.key)] = problem.message;
    problem = null;
  }
  // What Save waits for: what the vault would find missing, by the same rule, among what the card asks.
  const held: RequiredValues = {
    identifier: m.identifier ?? null,
    issued_by: m.issued_by ?? null,
    issued: m.issued ?? null,
    expires: m.expires ?? null,
    physical_location: m.physical_location ?? null,
    extra,
  };
  const need = new Set(h.details && type ? missingFields(type, held).map((x) => x.key) : []);
  const missing = [...CARD_CORE.filter(asks), ...own.map((f) => f.key)].filter((k) => need.has(k));
  return { metadata: m, fields, problem, missing };
}

/** One of the fixed fields the card has an input for, rather than one of the type's own. */
export const isCardCore = (key: string): key is CardCore => (CARD_CORE as readonly string[]).includes(key);
