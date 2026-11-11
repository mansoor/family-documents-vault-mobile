import { addDays, type DocumentListParams, type StatusValue, type Visibility } from '@fdv/shared';

/**
 * What Documents is narrowed by (R5; the owner's redesign of 10 Nov 2026:
 * "a filter icon next to the text box that opens a slide-out with filter
 * options grouped… one or more criteria"). Pure, so what each vault is
 * asked is tested without drawing the panel.
 *
 * A vault with `document_filters` (0.9.0, V1) takes several of each and the
 * days; an older one, one of each and no days — the panel then chooses one,
 * and has no dates.
 *
 * The owner's tidy-up of 11 Nov 2026: tags too, several, where the vault
 * takes them (`tag_filters`); and Documents without the notes, which have
 * their own tab, where the vault leaves them out (`notes_apart`).
 */

export type DateWhich = 'added' | 'issued' | 'expires';
export type Quick =
  | 'past'
  | 'next30'
  | 'next90'
  | 'thisYear'
  | 'lastYear'
  | 'last7'
  | 'last30'
  | 'last5Years';

export interface DateRange {
  which: DateWhich;
  /** `YYYY-MM-DD`, both included; null for open-ended. */
  from: string | null;
  to: string | null;
  /** Which quick range made it, to say it in words; none when typed. */
  quick?: Quick | undefined;
}

export interface Filters {
  /** People's ids; `none` for nobody's. */
  people: string[];
  /** Kinds, by key. */
  kinds: string[];
  statuses: StatusValue[];
  visibilities: Visibility[];
  /** Tags, any of them, whatever their case (`tag_filters`). */
  tags: string[];
  /** Essentials only: Home's Essentials, See all (the owner's ask of 11 Nov 2026). */
  essential?: boolean;
  date: DateRange | null;
}

export const NO_FILTERS: Filters = { people: [], kinds: [], statuses: [], visibilities: [], tags: [], date: null };

/** What else the vault takes: several tags, and the notes left out. */
export interface Apart {
  tags: boolean;
  notes: boolean;
}

/** The tags and the notes, as the vault takes them; nothing for an older one. */
function apartOf(f: Filters, apart: Apart | undefined): { tag?: string[]; notes?: 'exclude' } {
  return {
    ...(apart?.tags && f.tags.length > 0 ? { tag: f.tags } : {}),
    ...(apart?.notes ? { notes: 'exclude' as const } : {}),
  };
}

/** The quick ranges each date offers, most asked for first. */
export const QUICK: Record<DateWhich, Quick[]> = {
  expires: ['past', 'next30', 'next90', 'thisYear'],
  issued: ['thisYear', 'lastYear', 'last5Years'],
  added: ['last7', 'last30', 'thisYear'],
};

/** A quick range's days, from today on the family's calendar. */
export function quickRange(which: DateWhich, quick: Quick, today: string): DateRange {
  const year = today.slice(0, 4);
  const days = (from: string | null, to: string | null): DateRange => ({ which, from, to, quick });
  switch (quick) {
    case 'past':
      return days(null, addDays(today, -1));
    case 'next30':
      return days(today, addDays(today, 30));
    case 'next90':
      return days(today, addDays(today, 90));
    case 'thisYear':
      return which === 'expires' ? days(today, `${year}-12-31`) : days(`${year}-01-01`, today);
    case 'lastYear': {
      const last = String(Number(year) - 1);
      return days(`${last}-01-01`, `${last}-12-31`);
    }
    case 'last7':
      return days(addDays(today, -7), today);
    case 'last30':
      return days(addDays(today, -30), today);
    case 'last5Years':
      // In days: from 29 February, five years back is no day at all.
      return days(addDays(today, -5 * 365 - 1), today);
  }
}

/** How many kinds of filter are on: the number on the filter button. */
export function countOn(f: Filters): number {
  return (
    (f.people.length > 0 ? 1 : 0) +
    (f.kinds.length > 0 ? 1 : 0) +
    (f.statuses.length > 0 ? 1 : 0) +
    (f.visibilities.length > 0 ? 1 : 0) +
    (f.tags.length > 0 ? 1 : 0) +
    (f.essential ? 1 : 0) +
    (f.date ? 1 : 0)
  );
}

/** Several of one, or just one: on an older vault, a choice replaces the one before. */
export function toggle<T>(chosen: readonly T[], value: T, several: boolean): T[] {
  if (chosen.includes(value)) return chosen.filter((v) => v !== value);
  return several ? [...chosen, value] : [value];
}

/** One filter's values as the vault takes them: comma-separated, or the first on an older vault. */
const asked = (values: readonly string[], several: boolean): string | undefined =>
  values.length === 0 ? undefined : several ? values.join(',') : values[0];

/** The days, where the vault takes them. */
function days(f: Filters): Record<string, string> {
  if (!f.date) return {};
  return {
    ...(f.date.from ? { [`${f.date.which}_from`]: f.date.from } : {}),
    ...(f.date.to ? { [`${f.date.which}_to`]: f.date.to } : {}),
  };
}

export type Sort = 'recent' | 'title' | 'expires';

/**
 * The list's query: the sort as each vault takes it (the Documents table's
 * columns from 0.6.0; the older sorts before), and the filters — several
 * and the days where `several` (V1), one of each otherwise.
 */
export function listQuery(
  f: Filters,
  opts: { sort: Sort; table: boolean; several: boolean; apart?: Apart },
): DocumentListParams {
  const people = asked(f.people, opts.several);
  const kinds = asked(f.kinds, opts.several);
  const statuses = asked(f.statuses, opts.several);
  const visibilities = asked(f.visibilities, opts.several);
  return {
    ...(opts.sort === 'recent'
      ? { sort: 'recent' }
      : opts.table
        ? { sort: opts.sort, direction: 'asc' }
        : { sort: opts.sort === 'title' ? 'alpha' : 'expiring' }),
    ...(people ? { member_id: people } : {}),
    ...(kinds ? { type_key: kinds } : {}),
    // Several statuses or people go as one comma-separated value: the type says one.
    ...(statuses ? { status: statuses as StatusValue } : {}),
    ...(visibilities ? { visibility: visibilities as Visibility } : {}),
    ...(opts.several ? days(f) : {}),
    ...apartOf(f, opts.apart),
    ...(f.essential ? { essential: true } : {}),
  };
}

/**
 * Search's query: on a vault with V1, every filter; on an older one, the
 * one person, and the kind's category for its kind — the nearest an older
 * search narrows by.
 */
export function searchQuery(
  f: Filters,
  opts: { several: boolean; categoryOf: (kind: string) => string | null; apart?: Apart },
): Record<string, string | string[]> {
  if (opts.several) {
    const out: Record<string, string | string[]> = { ...days(f), ...apartOf(f, opts.apart) };
    const people = asked(f.people.filter((p) => p !== 'none'), true);
    if (people) out.member_id = people;
    for (const [name, values] of [
      ['type_key', f.kinds],
      ['status', f.statuses],
      ['visibility', f.visibilities],
    ] as const) {
      const v = asked(values, true);
      if (v) out[name] = v;
    }
    return out;
  }
  const out: Record<string, string> = {};
  const person = f.people.find((p) => p !== 'none');
  if (person) out.member_id = person;
  const category = f.kinds[0] ? opts.categoryOf(f.kinds[0]) : null;
  if (category) out.category = category;
  return out;
}
