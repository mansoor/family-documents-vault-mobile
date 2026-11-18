import { ACTIVITY_KINDS, localToday, parseDateInput, type ActivityKind, type ActivityLine } from '@fdv/shared';

/**
 * The Activity list's filters (app 0.17.0), as the web's Activity page
 * reads them: who did it, what sort of thing happened, and between which
 * days on the household's calendar. They only leave out some of the lines
 * the vault gave: which lines anybody is given is the vault's to say.
 * Pure, so the rules are tested without drawing the screen.
 */

/** Who the filter asks for that is not one of the family the reader is given. */
export const ELSE = 'else';

export interface ActivityFilters {
  /** A member's id, or `else`; empty for everybody. */
  who: string;
  /** What sort of thing (R4); empty for everything. */
  kind: ActivityKind | '';
  /** Days, YYYY-MM-DD, on the household's calendar; empty for any. */
  from: string;
  to: string;
}

export const NO_ACTIVITY_FILTERS: ActivityFilters = { who: '', kind: '', from: '', to: '' };

/** The kinds, in the web's order and words. */
export const KINDS = ACTIVITY_KINDS;

/** How many filters are on: for the button's badge. */
export function filtersOn(f: ActivityFilters): number {
  return [f.who, f.kind, f.from, f.to].filter(Boolean).length;
}

/** The day a moment falls on, on the household's calendar, as the times are said. */
export function dayOf(iso: string, zone: string): string {
  return localToday(zone, new Date(iso));
}

/** Whether a line is one the filters keep. */
export function matches(
  l: ActivityLine,
  f: ActivityFilters,
  family: readonly { id: string }[],
  zone: string,
): boolean {
  if (f.who) {
    const id = l.actor_member_id ?? null;
    const known = id !== null && family.some((m) => m.id === id);
    if (f.who === ELSE ? known : id !== f.who) return false;
  }
  if (f.kind && l.kind !== f.kind) return false;
  const day = f.from || f.to ? dayOf(l.at, zone) : '';
  if (f.from && day < f.from) return false;
  if (f.to && day > f.to) return false;
  return true;
}

/**
 * A day as typed ("14 Mar 2031", "Mar 2031", "2031"): its first day, or its
 * last for To; null for nothing typed, 'bad' for what is not a date.
 */
export function typedDay(text: string, end: boolean): string | null | 'bad' {
  if (!text.trim()) return null;
  const v = parseDateInput(text);
  if (!v) return 'bad';
  if (v.precision === 'day') return v.date;
  const [y, m] = v.date.split('-');
  if (v.precision === 'year') return end ? `${y}-12-31` : `${y}-01-01`;
  if (!end) return `${y}-${m}-01`;
  const last = new Date(Date.UTC(Number(y), Number(m), 0)).getUTCDate();
  return `${y}-${m}-${String(last).padStart(2, '0')}`;
}

/** Which words an empty list says: the catalogue's key, or null for the one-document words the vault's library has. */
export function emptyKey(
  filtered: boolean,
  older: boolean,
  oneDocument: boolean,
):
  | 'activity.nothingYet'
  | 'activity.nothingInStretch'
  | 'activity.nothingMatches'
  | 'activity.nothingLoadedMatches'
  | null {
  // An empty page with older ones behind it is not "nothing yet".
  if (!filtered) return oneDocument ? null : older ? 'activity.nothingInStretch' : 'activity.nothingYet';
  return older ? 'activity.nothingLoadedMatches' : 'activity.nothingMatches';
}
