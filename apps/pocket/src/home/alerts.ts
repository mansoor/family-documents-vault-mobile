import type { ReminderView } from '@fdv/shared';
import { readPrefs, writePrefs } from '../platform/prefs';

/**
 * Home's alerts (R4; the owner, 10 Nov 2026: "informative, but dismissible,
 * mutable for N days"). Each is something to do — a reminder that is due,
 * documents with no name, files waiting in the Inbox — and each can be
 * hidden on this phone: for a day, a week, 30 days, or until it changes.
 * Pure, so the rules are tested without drawing Home.
 */

export type AlertKind = 'reminder' | 'unnamed' | 'inbox';

export interface HomeAlert {
  kind: AlertKind;
  /** Which alert it is, the same from one day to the next. */
  key: string;
  /**
   * What it says, as far as hiding goes: hidden "until it changes", it
   * comes back when this does. A reminder's words count down each day
   * ("in 26 days", "in 25 days"), so they are not part of it; its date
   * and its state are.
   */
  sig: string;
  reminder?: ReminderView;
  count?: number;
}

/** How long an alert is hidden: days, or until what it says changes. */
export type HideFor = 1 | 7 | 30 | 'change';
export const HIDE_CHOICES: readonly HideFor[] = [1, 7, 30, 'change'];

/** What this phone keeps of the alerts hidden: until when (null: until it changes), and what it said then. */
export type Hidden = Record<string, { until: number | null; sig: string }>;

const DAY = 24 * 60 * 60 * 1000;

export function reminderAlert(r: ReminderView): HomeAlert {
  return { kind: 'reminder', key: `reminder:${r.id}`, sig: `${r.fire_at}|${r.status}|${r.snoozed_until ?? ''}`, reminder: r };
}

export function countAlert(kind: 'unnamed' | 'inbox', count: number): HomeAlert {
  return { kind, key: kind, sig: String(count), count };
}

/**
 * Whether an alert shows: not while it is hidden. Hidden for days, it comes
 * back when they are over, or sooner if what it says changes; hidden until
 * it changes, when it does.
 */
export function shows(alert: HomeAlert, hidden: Hidden, now: number): boolean {
  const h = hidden[alert.key];
  if (!h || h.sig !== alert.sig) return true;
  return h.until !== null && now >= h.until;
}

export function hide(hidden: Hidden, alert: HomeAlert, by: HideFor, now: number): Hidden {
  return { ...hidden, [alert.key]: { until: by === 'change' ? null : now + by * DAY, sig: alert.sig } };
}

export function unhide(hidden: Hidden, alert: HomeAlert): Hidden {
  const next = { ...hidden };
  delete next[alert.key];
  return next;
}

/** Only what may still be hidden is kept: an alert that has gone is let go of. */
export function prune(hidden: Hidden, alerts: readonly HomeAlert[], now: number): Hidden {
  const keys = new Set(alerts.map((a) => a.key));
  return Object.fromEntries(
    Object.entries(hidden).filter(([key, h]) => keys.has(key) && (h.until === null || now < h.until)),
  );
}

/** The person's hidden alerts, on this phone: one set per vault and person. */
const prefsName = (who: string) => `homeHidden.${who}`;
export const readHidden = (who: string): Hidden => readPrefs<Hidden>(prefsName(who), {});
export const writeHidden = (who: string, hidden: Hidden): void => writePrefs(prefsName(who), hidden);
