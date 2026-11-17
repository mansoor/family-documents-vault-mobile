import {
  formatDate,
  parseDateInput,
  SHARE_LIMIT_MAX,
  SHARE_MAX_DAYS,
  SHARE_PASSWORD_MIN,
  shareEndProblem,
  shareQuickPicks,
  zonedParts,
  zonedTime,
  type Share,
  type ShareChangeInput,
  type SharePermission,
  type ShareQuickPick,
} from '@fdv/shared';

/**
 * A link changed after it is made (0.9.0-dev.49, LK; the web's ChangeLink),
 * read as the web reads it: the form it was made with, filled in as it is
 * now, and only what is changed sent. Its end stays as it is until another
 * is chosen — Tonight, Friday 5 pm, In a week, or a day and a time — and
 * never past the latest it may go to from when it was made (`latest_end`).
 * Its PIN or password is kept, taken away, or made new; only whoever made it
 * may change that. Pure, so the rules are tested without drawing the sheet.
 */
export type ChangeEnd = 'keep' | ShareQuickPick['key'] | 'other';
export type SecretChange = 'keep' | 'none' | 'pin' | 'password';

export interface ChangeOptions {
  label: string;
  end: ChangeEnd;
  /** Another day and time, as typed. */
  day: string;
  time: string;
  permission: SharePermission;
  opens: string;
  secret: SecretChange;
  /** A new password made up by the vault, or typed. */
  passwordMode: 'made' | 'typed';
  password: string;
  showTitle: boolean;
}

/** What it asks for now, besides itself: a PIN, a password, or neither. */
export function secretOf(link: Share): 'pin' | 'password' | null {
  const asks = link.protection ?? (link.has_pin ? ['pin'] : []);
  return asks.includes('password') ? 'password' : asks.includes('pin') ? 'pin' : null;
}

/** A clinician's link (H4): to neither a document nor a collection; to view, always. */
export const isEmergencyLink = (link: Share) => link.document_id === null && link.collection_id == null;

/** The form as the link is now. */
export function startChange(link: Share, timezone: string): ChangeOptions {
  const at = zonedParts(new Date(link.expires_at), timezone);
  return {
    label: link.recipient_label ?? '',
    end: 'keep',
    // Another day starts from the day it stops now.
    day: formatDate({ date: at.date, precision: 'day' }),
    time: at.time,
    permission: link.permission ?? 'download',
    opens: link.max_opens != null ? String(link.max_opens) : '',
    secret: 'keep',
    passwordMode: 'made',
    password: '',
    showTitle: link.show_title === true,
  };
}

export interface ChangeContext {
  timezone: string;
  /** The vault's own longest, for a link that does not say its latest end (never past it). */
  maxDays?: number;
  /** Its title on the link's page is offered (H1a, `sensitive_protects`). */
  protects: boolean;
  now?: Date;
}

const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function readChange(link: Share, v: ChangeOptions, ctx: ChangeContext) {
  const now = ctx.now ?? new Date();
  const latest = link.latest_end ? new Date(link.latest_end) : null;
  // The longest is from when it was made (the vault holds it): no pick, nor date, past it.
  const maxDays = latest
    ? Math.max(0, (latest.getTime() - now.getTime()) / 864e5)
    : (ctx.maxDays ?? SHARE_MAX_DAYS);
  const picks = shareQuickPicks(ctx.timezone, now, maxDays);
  const emergency = isEmergencyLink(link);
  const has = secretOf(link);
  const maker = link.mine !== false;

  let endAt: Date | null = null;
  let endProblem: 'day' | 'time' | 'latest' | string | null = null;
  if (v.end === 'other') {
    const day = v.day.trim() ? parseDateInput(v.day) : null;
    const time = v.time.trim();
    if (!day || day.precision !== 'day') endProblem = 'day';
    else if (!TIME.test(time)) endProblem = 'time';
    else {
      const [h = '0', m = '0'] = time.split(':');
      endAt = zonedTime(day.date, `${h.padStart(2, '0')}:${m}`, ctx.timezone);
      endProblem = endAt ? shareEndProblem(endAt, { now, maxDays }) : 'day';
    }
  } else if (v.end !== 'keep') {
    endAt = picks.find((p) => p.key === v.end)?.at ?? null;
    endProblem = endAt ? shareEndProblem(endAt, { now, maxDays }) : 'day';
  }
  // Past its latest: said as the latest it may go to, as the web says it.
  if (endProblem && endProblem.startsWith('A link can last') && latest) endProblem = 'latest';
  // A new end only when its day or time is not the one it has (as the web): the same end chosen
  // again is no change, and asks nothing.
  const was = zonedParts(new Date(link.expires_at), ctx.timezone);
  const at = endAt ? zonedParts(endAt, ctx.timezone) : null;
  const endTouched = v.end !== 'keep' && !(at && at.date === was.date && at.time === was.time);
  if (!endTouched) endProblem = null;

  const typed = v.opens.trim();
  const opens = typed === '' ? null : /^\d+$/.test(typed) ? Number(typed) : NaN;
  const opensProblem =
    opens !== null && (!Number.isInteger(opens) || opens < 1 || opens > SHARE_LIMIT_MAX) ? 'opens' : null;
  const secret: SecretChange = maker ? v.secret : 'keep';
  const passwordProblem =
    secret === 'password' && v.passwordMode === 'typed' && v.password.trim().length < SHARE_PASSWORD_MIN
      ? 'password'
      : null;

  // Only what is changed.
  const body: ShareChangeInput = {};
  const label = v.label.trim() || null;
  if (label !== link.recipient_label) body.recipient_label = label;
  if (endTouched && endAt && !endProblem) body.expires_at = endAt.toISOString();
  if (!emergency && v.permission !== (link.permission ?? 'download')) body.permission = v.permission;
  if (!opensProblem && opens !== (link.max_opens ?? null)) body.max_opens = opens;
  if (ctx.protects && !emergency && v.showTitle !== (link.show_title === true)) body.show_title = v.showTitle;
  if (secret !== 'keep' && !(secret === 'none' && has === null)) {
    body.secret = secret;
    if (secret === 'password' && v.passwordMode === 'typed') body.password = v.password.trim();
  }
  const nothing = Object.keys(body).length === 0;
  const problem = endProblem ?? opensProblem ?? passwordProblem;
  return { picks, latest, endAt, endProblem, opensProblem, passwordProblem, body, nothing, problem, has, maker, emergency };
}
