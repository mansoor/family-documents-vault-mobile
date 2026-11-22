import { formatDate, type ActivityLine } from '@fdv/shared';
import type { TFunction } from 'i18next';
import { dayOf, type ActivityFilters } from '../activity/filters';
import { exactWords } from '../state/family-time';
import { tableHtml, type Foot } from './html';

const day = (d: string) => formatDate({ date: d, precision: 'day' });

/**
 * Whether older lines are still to be loaded before printing (0.21.0): a
 * From day asked for, older lines there, and the oldest loaded not before it.
 */
export function wantsOlder(lines: readonly ActivityLine[], from: string, next: number | null, zone: string): boolean {
  if (!from || next === null) return false;
  const oldest = lines.at(-1);
  return !oldest || dayOf(oldest.at, zone) >= from;
}

/**
 * The activity log, printed (0.21.0): the lines its filters keep, as they
 * are shown, with who, what, which days and which document said above them;
 * and, with older lines not loaded, how far back it goes. Each line's words
 * are the vault's, as the screen shows them: a sensitive document is named
 * there as the vault names it.
 */
export function activityHtml(a: {
  shown: readonly ActivityLine[];
  /** Every line loaded, filtered or not: the oldest says how far back it goes. */
  loaded: readonly ActivityLine[];
  filters: ActivityFilters;
  /** The filters as their chips say them. */
  whoWords: string | null;
  kindWords: string | null;
  /** One document's lines: the chip's words. */
  about: string | null;
  /** Older lines the vault has, not loaded. */
  older: boolean;
  zone: string;
  t: TFunction;
  foot: Foot;
}): string {
  const { t, filters } = a;
  const said = [
    a.about ? t('print.activityAbout', { what: a.about }) : null,
    a.whoWords ? t('print.activityWho', { who: a.whoWords }) : null,
    a.kindWords ? t('print.activityWhat', { what: a.kindWords }) : null,
    filters.from && filters.to
      ? t('print.activityDays', { from: day(filters.from), to: day(filters.to) })
      : filters.from
        ? t('print.activityFrom', { day: day(filters.from) })
        : filters.to
          ? t('print.activityTo', { day: day(filters.to) })
          : null,
  ].filter((x): x is string => !!x);
  if (said.length === 0) said.push(t('print.activityEverything'));
  const oldest = a.loaded.at(-1);
  // Older lines left behind, and the From day (if any) not reached: how far back this goes.
  if (a.older && oldest && !(filters.from && dayOf(oldest.at, a.zone) < filters.from)) {
    said.push(t('print.activityBackTo', { day: day(dayOf(oldest.at, a.zone)) }));
  }
  return tableHtml({
    title: t('print.activityTitle'),
    said,
    columns: [t('print.activityWhen'), t('print.activityWhatHappened')],
    rows: a.shown.map((l) => [exactWords(l.at, a.zone), l.text]),
    none: t('print.activityNone'),
    foot: a.foot,
  });
}
