import {
  defaultShareEnd,
  parseDateInput,
  SHARE_LIMIT_MAX,
  shareEndProblem,
  shareQuickPicks,
  zonedTime,
  type ShareInput,
  type SharePermission,
  type ShareQuickPick,
} from '@fdv/shared';

/**
 * A link's options on the phone (the owner's ask of 11 Nov 2026: sharing
 * from the phone, one sheet for a document, a note or a collection), read
 * as the web reads them (Share.tsx's readLinkOptions): whom it is for, when
 * it stops — Tonight, Friday 5 pm, In a week, or a day and a time on the
 * family's clock — whether they may download or only view, how often it
 * opens, and a PIN or a password the vault makes up. Pure, so the rules are
 * tested without drawing the sheet.
 */
export type EndChoice = ShareQuickPick['key'] | 'other';
export type Protection = 'none' | 'pin' | 'password' | 'text';

export interface ShareOptions {
  label: string;
  /** Which end; null until chosen, which is In a week where the vault allows it. */
  end: EndChoice | null;
  /** Another day and time, as typed: "14 Nov 2026" and "17:00". */
  day: string;
  time: string;
  permission: SharePermission;
  opens: string;
  protection: Protection;
  /** The recipient's mobile number, for a code by text (SMS4): as typed. */
  phone: string;
}

export const NO_SHARE_OPTIONS: ShareOptions = {
  label: '',
  end: null,
  day: '',
  time: '17:00',
  permission: 'download',
  opens: '',
  protection: 'none',
  phone: '',
};

export interface ShareContext {
  timezone: string;
  /** The longest a link may last: the vault's, or a following collection link's 30 days. */
  maxDays: number;
  /** Its pages can be drawn, so it can go to view only. */
  viewable: boolean;
  /** A note's link is read on the page: never a download. */
  note: boolean;
  /** The vault takes an end, View and a limit (5.18, `features.share_options`). */
  options: boolean;
  /** The vault makes up a password (5.20, `features.share_second_factor`). */
  passwords: boolean;
  /** The vault texts a link's code (0.9.0-dev.33, `features.sms_codes`) and its texts are set up. */
  texts?: boolean;
  now?: Date;
}

const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function readShareOptions(v: ShareOptions, ctx: ShareContext) {
  const now = ctx.now ?? new Date();
  const picks = shareQuickPicks(ctx.timezone, now, ctx.maxDays);
  const fallback = defaultShareEnd(ctx.timezone, now, ctx.maxDays);
  const end: EndChoice = v.end ?? (picks.some((p) => p.key === 'week') ? 'week' : 'other');
  let endAt: Date | null = null;
  let endProblem: string | null = null;
  if (end === 'other') {
    const day = v.day.trim() ? parseDateInput(v.day) : { date: fallback.date, precision: 'day' as const };
    const time = v.time.trim() || fallback.time;
    if (!day || day.precision !== 'day') endProblem = 'day';
    else if (!TIME.test(time)) endProblem = 'time';
    else {
      const [h = '0', m = '0'] = time.split(':');
      endAt = zonedTime(day.date, `${h.padStart(2, '0')}:${m}`, ctx.timezone);
      endProblem = endAt ? shareEndProblem(endAt, { now, maxDays: ctx.maxDays }) : 'day';
    }
  } else {
    endAt = picks.find((p) => p.key === end)?.at ?? null;
    endProblem = endAt ? shareEndProblem(endAt, { now, maxDays: ctx.maxDays }) : 'day';
  }
  // Read as typed: "5e" is not a number, and a limit typed wrong is never no limit.
  const typed = v.opens.trim();
  const opens = typed === '' ? null : /^\d+$/.test(typed) ? Number(typed) : NaN;
  const opensProblem =
    opens !== null && (!Number.isInteger(opens) || opens < 1 || opens > SHARE_LIMIT_MAX) ? 'opens' : null;
  const password = ctx.passwords && v.protection === 'password';
  // A code by text needs the number it goes to: one that is not even a number is said here, the rest by the vault.
  const text = ctx.texts === true && v.protection === 'text';
  const phoneProblem = text && v.phone.replace(/[^0-9]/g, '').length < 6 ? 'phone' : null;
  const permission: SharePermission = ctx.note ? 'view' : ctx.viewable ? v.permission : 'download';

  let body: ShareInput | null = null;
  if (endAt && !endProblem && !opensProblem && !phoneProblem) {
    body = {
      ...(v.label.trim() ? { recipient_label: v.label.trim() } : {}),
      // An older vault takes days only: the end, rounded up to a whole day.
      ...(ctx.options
        ? {
            expires_at: endAt.toISOString(),
            permission,
            ...(opens !== null ? { max_opens: opens } : {}),
          }
        : { expires_in_days: Math.max(1, Math.ceil((endAt.getTime() - now.getTime()) / 864e5)) }),
      with_pin: v.protection === 'pin',
      ...(password ? { with_password: true } : {}),
      ...(text ? { second_factor: 'sms' as const, recipient_phone: v.phone.trim() } : {}),
    };
  }
  return { picks, end, endAt, endProblem, opensProblem, phoneProblem, body, fallback };
}
