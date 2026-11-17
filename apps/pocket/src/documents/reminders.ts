import { REVIEW_NOTE, type ReminderView } from '@fdv/shared';

/**
 * What a reminder row says (5.31, the vault's 0.5.15): the date it is
 * about, in its kind's words — "Due date: 10 Oct, in 7 days" — or, from a
 * vault that does not say (older than 0.5.15, or a reminder somebody set
 * themselves), when it falls due: "In 12 days · 2 Oct", "Due today". Never
 * "Overdue by 3 days" above a bill whose due date is still ahead. A yearly
 * review says so first.
 */
export function reminderHeadline(r: Pick<ReminderView, 'about' | 'label' | 'review'>): string {
  // A yearly review (H3) says it is one, as every reminder list and digest says it: "Yearly review · Due today".
  if (r.review === true) return `${REVIEW_NOTE} · ${r.label}`;
  return r.about ?? r.label;
}

/**
 * Whether "Scan the new one" fits: a reminder about an expiry (`source`
 * 'expires'), or one that says nothing of its date — an older vault's,
 * where every reminder made from a kind is about Expires, or one somebody
 * set themselves. Not one about a due date or an MOT: a bill is paid, not
 * replaced.
 */
export function offersNewScan(r: Pick<ReminderView, 'source' | 'review'>): boolean {
  // A yearly review (H3) is read again, not replaced: Done brings the next one.
  if (r.review === true) return false;
  return r.source === undefined || r.source === null || r.source === 'expires';
}

/**
 * The health kinds' reminders (the vault's 0.9.0-dev.46, H3) need nothing of
 * their own here: a prescription's Next refill, a vaccination record's Next
 * dose due and an insurance card's Expires come with their date in the
 * kind's words (`about`, "Next refill: 3 Dec, in 7 days"), and only one about
 * an expiry offers Scan the new one. A yearly review of an advance directive,
 * a healthcare proxy or a HIPAA authorization is somebody's own reminder
 * (`manual`, `review: true`): Done brings the next a year on, and removing it
 * turns the review off.
 */
export const isReview = (r: Pick<ReminderView, 'review'>): boolean => r.review === true;
