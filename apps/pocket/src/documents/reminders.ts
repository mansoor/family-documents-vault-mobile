import type { ReminderView } from '@fdv/shared';

/**
 * What a reminder row says (5.31, the vault's 0.5.15): the date it is
 * about, in its kind's words — "Due date: 10 Oct, in 7 days" — or, from a
 * vault that does not say (older than 0.5.15, or a reminder somebody set
 * themselves), when it falls due: "In 12 days · 2 Oct", "Due today". Never
 * "Overdue by 3 days" above a bill whose due date is still ahead.
 */
export function reminderHeadline(r: Pick<ReminderView, 'about' | 'label'>): string {
  return r.about ?? r.label;
}

/**
 * Whether "Scan the new one" fits: a reminder about an expiry (`source`
 * 'expires'), or one that says nothing of its date — an older vault's,
 * where every reminder made from a kind is about Expires, or one somebody
 * set themselves. Not one about a due date or an MOT: a bill is paid, not
 * replaced.
 */
export function offersNewScan(r: Pick<ReminderView, 'source'>): boolean {
  return r.source === undefined || r.source === null || r.source === 'expires';
}
