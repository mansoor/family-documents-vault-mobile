import {
  autoTitle,
  can,
  checkCaptureMetadata,
  effectiveVisibility,
  parseDateInput,
  type CaptureMetadata,
  type CaptureProblem,
  type DocumentTypeView,
  type Role,
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

export type FieldErrors = Partial<Record<'issued' | 'expires', string>>;

export const DATE_HINT = 'A date, a month (March 2031) or a year';

/**
 * Save: every answer given, as the vault takes it — or what is wrong with
 * them, in the vault's own words, before anything is kept.
 */
export function toMetadata(
  d: Draft,
  h: Household,
): {
  metadata: CaptureMetadata;
  fields: FieldErrors;
  problem: CaptureProblem | null;
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
  const m: CaptureMetadata = {};
  if (d.typeKey) m.type_key = d.typeKey;
  if (d.ownerId) m.owner_member_id = d.ownerId;
  m.visibility = visibilityOf(d, h);
  m.is_essential = essentialOf(d, h);
  const title = text(d.title) ?? suggestedTitle(d, h);
  if (title) m.title = title;
  const issued = date(d.issued, 'issued');
  if (issued) m.issued = issued;
  const expires = type?.expiry_driver ? date(d.expires, 'expires') : undefined;
  if (expires) m.expires = expires;
  const identifier = text(d.identifier);
  if (identifier) m.identifier = identifier;
  const issuedBy = h.issuedBy ? text(d.issuedBy) : undefined;
  if (issuedBy) m.issued_by = issuedBy.replace(/\s+/g, ' ');
  const location = text(d.location);
  if (location) m.physical_location = location;
  const problem = checkCaptureMetadata(m, {
    me: h.me,
    members: h.members,
    types: h.types,
  });
  return { metadata: m, fields, problem };
}
