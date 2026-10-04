import {
  formatDate,
  IDENTITY_FIELDS,
  IDENTITY_ID_LABELS,
  IDENTITY_LISTS,
  type IdentityAudience,
  type IdentityIdKind,
  type IdentityList,
  type IdentityPart,
  type IdentityPartView,
  type IdentityView,
} from '@fdv/shared';
import type { TFunction } from 'i18next';

/**
 * A person's identity details as the card shows them (5.31, the web's
 * 5.27 card): in sections, in the catalogue's order, each part's rows
 * together. What the vault masked — every ID's number, every hidden
 * field's value — comes without its value (`masked` names it): its row has
 * no value until a reveal shows it.
 *
 * Another person's Only me part is never shown, whatever an answer holds:
 * the vault sends it to nobody but the person (A33), and the phone shows it
 * to nobody but them.
 */

export interface IdentityRow {
  /** `given_name`, `ids.p1`: what a reveal asks for. */
  key: string;
  part: IdentityPart;
  label: string;
  /** Null for a masked value: shown only once revealed. */
  value: string | null;
  /** What a masked value is called in a sentence ("passport number"); only for one masked. */
  secretLabel?: string;
  /** Who issued it, when; said under the value. */
  more: string[];
  order: number;
}

export interface IdentitySection {
  key: string;
  title: string;
  rows: IdentityRow[];
}

const SECTIONS = ['name', 'birth', 'contact', 'work', 'ids', 'other'] as const;

/** "United Kingdom" for GB, where the phone has the names; the code itself where it has none. */
export function countryName(code: string): string {
  try {
    const names = new Intl.DisplayNames(['en-GB'], { type: 'region' });
    return names.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const capitalised = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const day = (iso: string) => formatDate({ date: iso, precision: 'day' });

/** What an ID's number is called, in a sentence: "passport number", "NHS number". */
export function idNumberLabel(e: { kind: IdentityIdKind; label?: string | null }): string {
  const named = e.label?.trim();
  if (named) return /number$/i.test(named) ? named : `${named} number`;
  const kind = IDENTITY_ID_LABELS[e.kind] ?? 'ID';
  const word = kind.charAt(0).toLowerCase() + kind.slice(1);
  return /number$/.test(word) ? word : `${word} number`;
}

/** "Home email", "Work phone", "Address": what it is, with what it is for. */
function contactLabel(label: string, noun: string): string {
  if (!label) return capitalised(noun);
  return label.toLowerCase().includes(noun) ? label : `${label} ${noun}`;
}

/** One entry of a list, as a row; null when it holds nothing to show. */
function entryRow(
  list: IdentityList,
  e: Record<string, unknown>,
  isMasked: boolean,
  t: TFunction,
): Omit<IdentityRow, 'part' | 'order'> | null {
  const key = `${list}.${String(e.id)}`;
  switch (list) {
    case 'emails':
    case 'phones': {
      if (!text(e.value)) return null;
      const noun = t(list === 'emails' ? 'identity.email' : 'identity.phone');
      return { key, label: contactLabel(text(e.label), noun), value: text(e.value), more: [] };
    }
    case 'addresses': {
      const lines = [
        text(e.line1),
        text(e.line2),
        text(e.line3),
        [text(e.city), text(e.region), text(e.postal_code)].filter(Boolean).join(', '),
        text(e.country) ? countryName(text(e.country)) : '',
      ].filter(Boolean);
      if (lines.length === 0) return null;
      return { key, label: contactLabel(text(e.label), t('identity.address')), value: lines.join('\n'), more: [] };
    }
    case 'ids': {
      const kind = (e.kind as IdentityIdKind) ?? 'other';
      const more = [
        text(e.issuer) ? t('identity.issuedBy', { who: text(e.issuer) }) : '',
        text(e.issued_on) ? t('identity.issuedOn', { date: day(text(e.issued_on)) }) : '',
        text(e.expires_on) ? t('identity.expiresOn', { date: day(text(e.expires_on)) }) : '',
      ].filter(Boolean);
      const number = text(e.number);
      if (!isMasked && !number && more.length === 0) return null;
      const named = text(e.label);
      const kindWord = IDENTITY_ID_LABELS[kind] ?? IDENTITY_ID_LABELS.other;
      return {
        key,
        label: named ? `${kindWord}: ${named}` : kindWord,
        value: isMasked ? null : number || t('identity.noNumber'),
        ...(isMasked ? { secretLabel: idNumberLabel({ kind, label: named || null }) } : {}),
        more,
      };
    }
    case 'custom': {
      if (!isMasked && !text(e.value)) return null;
      const label = text(e.label);
      return {
        key,
        label: label || t('identity.detail'),
        value: isMasked ? null : text(e.value),
        ...(isMasked ? { secretLabel: label || t('identity.detail').toLowerCase() } : {}),
        more: [],
      };
    }
  }
}

/** A part's rows for one section, in the catalogue's order. */
function rowsOf(pv: IdentityPartView, part: IdentityPart, section: string, t: TFunction): IdentityRow[] {
  const f = pv.fields;
  const masked = new Set(pv.masked);
  const rows: IdentityRow[] = [];
  IDENTITY_FIELDS.forEach((field, i) => {
    if (field.section !== section) return;
    const order = i * 2 + (part === 'only_me' ? 1 : 0);
    const key = field.key;
    if (key === 'nationalities') {
      if (f.nationalities?.length) {
        rows.push({ key, part, label: field.label, value: f.nationalities.map(countryName).join(', '), more: [], order });
      }
      return;
    }
    if ((IDENTITY_LISTS as readonly string[]).includes(key)) {
      const list = key as IdentityList;
      for (const e of (f[list] ?? []) as unknown as Record<string, unknown>[]) {
        const row = entryRow(list, e, masked.has(`${list}.${String(e.id)}`), t);
        if (row) rows.push({ ...row, part, order });
      }
      return;
    }
    const v = f[key as Exclude<keyof typeof f, IdentityList | 'nationalities'>];
    if (typeof v !== 'string' || v.trim() === '') return;
    const shown =
      key === 'country_of_birth' ? countryName(v) : key === 'sex' ? t(`identity.sex_${v}`, { defaultValue: v }) : v;
    rows.push({ key, part, label: field.label, value: shown, more: [], order });
  });
  return rows;
}

/**
 * The card's sections, with what each holds. The Only me part only for the
 * person themselves (`self`): another person's is never shown, even if an
 * answer carried it.
 */
export function identitySections(view: IdentityView, self: boolean, t: TFunction): IdentitySection[] {
  const parts: [IdentityPart, IdentityPartView | null][] = [
    ['shared', view.shared],
    ['only_me', self ? view.only_me : null],
  ];
  return SECTIONS.map((key) => ({
    key,
    title: t(`identity.section_${key}`),
    rows: parts.flatMap(([part, pv]) => (pv ? rowsOf(pv, part, key, t) : [])).sort((a, b) => a.order - b.order),
  })).filter((s) => s.rows.length > 0);
}

/** Who sees these details besides the person, in a sentence (A34). */
export function seenByWords(audience: IdentityAudience | string, self: boolean, t: TFunction): string {
  const who = audience === 'adults' || audience === 'family' ? audience : 'owners_and_self';
  return t(self ? `identity.seenBySelf_${who}` : `identity.seenBy_${who}`);
}
