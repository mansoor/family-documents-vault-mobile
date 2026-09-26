import { formatDate, type DateValue, type TypeField } from '@fdv/shared';

/**
 * A type's own details on a document's page (0.2.1): each field the type
 * asks for that has a value, under the type's name for it, in the type's
 * order, written as a person would read it.
 */
export function detailFacts(
  fields: readonly Pick<TypeField, 'key' | 'label' | 'kind'>[] | undefined,
  extra: Record<string, unknown> | null | undefined,
  words: { yes: string; no: string },
): [string, string][] {
  const out: [string, string][] = [];
  for (const f of fields ?? []) {
    const text = detailText(f.kind, extra?.[f.key], words);
    if (text) out.push([f.label, text]);
  }
  return out;
}

/** One detail as words: "14 Mar 2031", "Yes", "12.50"; null for no value, or one it cannot read. */
export function detailText(kind: string, value: unknown, words: { yes: string; no: string }): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value ? words.yes : words.no;
  if (typeof value === 'number') return kind === 'money' ? value.toFixed(2) : String(value);
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && typeof (value as DateValue).date === 'string') {
    try {
      return formatDate(value as DateValue);
    } catch {
      return null;
    }
  }
  return null;
}
