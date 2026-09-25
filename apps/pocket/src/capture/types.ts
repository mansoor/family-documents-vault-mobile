import type { DocumentTypeView } from '@fdv/shared';

/** What most families file first, for a vault with little in it yet. */
const STARTERS = [
  'passport',
  'drivers_licence',
  'bank_statement',
  'utility_bill',
  'insurance_policy',
  'birth_certificate',
  'medical_record',
  'tax_return',
];

/** How many types are chips; the rest are behind More…. */
export const TYPE_CHIPS = 6;

/**
 * The card's type chips: the kinds the household has filed most (from the
 * documents the phone has seen), then the usual first ones; everything
 * else, alphabetically, behind More…. "Something else" is never a chip.
 */
export function rankTypes(
  types: readonly DocumentTypeView[],
  filed: readonly (string | null | undefined)[],
  chips = TYPE_CHIPS,
): { top: DocumentTypeView[]; rest: DocumentTypeView[] } {
  const counts = new Map<string, number>();
  for (const k of filed) if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  const starter = (k: string) => {
    const i = STARTERS.indexOf(k);
    return i < 0 ? STARTERS.length : i;
  };
  const byLabel = (a: DocumentTypeView, b: DocumentTypeView) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0);
  const ranked = types
    .filter((t) => t.key !== 'other' && (counts.has(t.key) || STARTERS.includes(t.key)))
    .sort(
      (a, b) => (counts.get(b.key) ?? 0) - (counts.get(a.key) ?? 0) || starter(a.key) - starter(b.key) || byLabel(a, b),
    );
  const top = ranked.slice(0, chips);
  const shown = new Set(top.map((t) => t.key));
  return { top, rest: types.filter((t) => !shown.has(t.key)).sort(byLabel) };
}

/** More…'s search: every word typed, anywhere in the name. */
export function matchTypes(types: readonly DocumentTypeView[], query: string): DocumentTypeView[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return types.filter((t) => words.every((w) => t.label.toLowerCase().includes(w)));
}
