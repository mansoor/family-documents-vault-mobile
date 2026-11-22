import {
  defaultShareEnd,
  formatDate,
  isShareAddress,
  parseDateInput,
  SHARE_MAX_DAYS,
  SHARE_PASSWORD_MAX,
  shareEndProblem,
  shareQuickPicks,
  UPLOAD_PASSWORD_MIN,
  UPLOAD_REQUEST_ITEMS_MAX,
  UPLOAD_REQUEST_MAX_BYTES,
  UPLOAD_REQUEST_MAX_FILES,
  zonedParts,
  zonedTime,
  type ShareQuickPick,
  type UploadAcceptTypes,
  type UploadRequestChangeInput,
  type UploadRequestInput,
  type UploadRequestView,
  type UploadReviewBy,
} from '@fdv/shared';

/**
 * Ask for documents (5.22) on the phone, and a request changed after it is
 * made (0.9.0-dev.49, LK), read as the web's AskForDocuments reads them:
 * what is asked for, whom it is for, when it stops, what protects it, what
 * it takes and who looks at what comes in. Making one sends all of it;
 * changing one sends only what is changed. Pure, so the rules are tested
 * without drawing the form.
 *
 * A four-digit PIN (a vault with `upload_request_pin`), made up by the vault
 * and shown once, as a share link's: never with a password, so choosing one
 * takes the other away.
 */

export const MB = 1024 * 1024;
/** The most a request takes in all, in MB: 200. */
export const ASK_MAX_MB = Math.floor(UPLOAD_REQUEST_MAX_BYTES / MB);
/** Visits a request may be limited to, at most (the web's). */
export const ASK_VISITS_MAX = 1000;

/** When it stops: a quick pick, or a day and a time; for a change, also as it is now. */
export type AskEnd = ShareQuickPick['key'] | 'other';
export type AskChangeEnd = 'keep' | AskEnd;

export interface AskOptions {
  title: string;
  message: string;
  /** The named things to send, in order; empty ones are left out. */
  items: string[];
  label: string;
  /** Whose documents they probably are: a hint for whoever reviews; '' for not sure. */
  person: string;
  /** Null until chosen: In a week, where the vault allows it. */
  end: AskEnd | null;
  /** Another day and time, as typed. */
  day: string;
  time: string;
  /** A four-digit PIN the vault makes up (never with a password). */
  withPin: boolean;
  withPassword: boolean;
  passwordMode: 'made' | 'typed';
  password: string;
  withCode: boolean;
  email: string;
  /** The vault's own refusal of that address, said under it until it is changed. */
  emailRefused: string | null;
  thisDeviceOnly: boolean;
  limitVisits: boolean;
  visits: string;
  maxFiles: string;
  maxMegabytes: string;
  accept: UploadAcceptTypes;
  reviewBy: UploadReviewBy;
  closeAfter: boolean;
}

export const ASK_START: AskOptions = {
  title: '',
  message: '',
  items: [''],
  label: '',
  person: '',
  end: null,
  day: '',
  time: '17:00',
  withPin: false,
  withPassword: false,
  passwordMode: 'made',
  password: '',
  withCode: false,
  email: '',
  emailRefused: null,
  thisDeviceOnly: false,
  limitVisits: false,
  visits: '3',
  maxFiles: String(UPLOAD_REQUEST_MAX_FILES),
  maxMegabytes: String(ASK_MAX_MB),
  accept: 'standard',
  reviewBy: 'me',
  closeAfter: false,
};

/** A form started with things to send already named (a collection's checklist, on the web): up to the most. */
export function askStart(over: { person?: string; title?: string; items?: string[] } = {}): AskOptions {
  const items = (over.items ?? []).filter((i) => i.trim() !== '').slice(0, UPLOAD_REQUEST_ITEMS_MAX);
  return {
    ...ASK_START,
    ...(over.person ? { person: over.person } : {}),
    ...(over.title ? { title: over.title } : {}),
    ...(items.length ? { items } : {}),
  };
}

/** A whole number typed, within its range; null when it is not one. */
export function count(typed: string, min: number, max: number): number | null {
  const t = typed.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= min && n <= max ? n : null;
}

const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** A day and a time as typed, on the family's clock: the moment, or which of them is wrong. */
function typedEnd(
  day: string | { date: string; precision: 'day' },
  time: string,
  timezone: string,
): { at: Date } | { problem: 'day' | 'time' } {
  const d = typeof day !== 'string' ? day : day.trim() ? parseDateInput(day) : null;
  if (!d || d.precision !== 'day') return { problem: 'day' };
  const tm = time.trim();
  if (!TIME.test(tm)) return { problem: 'time' };
  const [h = '0', m = '0'] = tm.split(':');
  const at = zonedTime(d.date, `${h.padStart(2, '0')}:${m}`, timezone);
  return at ? { at } : { problem: 'day' };
}

/**
 * A typed password, checked exactly as typed, as the vault checks it: 8 at
 * least (`password`), 64 at most (`passwordLong`, `SHARE_PASSWORD_MAX`).
 */
export function typedPasswordProblem(password: string): 'password' | 'passwordLong' | null {
  if (password.length < UPLOAD_PASSWORD_MIN) return 'password';
  if (password.length > SHARE_PASSWORD_MAX) return 'passwordLong';
  return null;
}

/** The vault's words about a link's end, said of a request (the web's). */
const ofRequest = (words: string | null) => words?.replace(/^A link /, 'A request ') ?? null;

/** What is wrong with what it takes, and with its visits: the same for making and changing. */
function takes(v: AskOptions) {
  const visits = v.limitVisits ? count(v.visits, 1, ASK_VISITS_MAX) : null;
  const visitsProblem = v.limitVisits && visits === null ? ('visits' as const) : null;
  const maxFiles = count(v.maxFiles, 1, UPLOAD_REQUEST_MAX_FILES);
  const filesProblem = maxFiles === null ? ('files' as const) : null;
  const megabytes = count(v.maxMegabytes, 1, ASK_MAX_MB);
  const sizeProblem = megabytes === null ? ('size' as const) : null;
  return { visits, visitsProblem, maxFiles, filesProblem, megabytes, sizeProblem };
}

export interface AskContext {
  timezone: string;
  /** The longest a request may last (`limits.share_max_days`). */
  maxDays?: number;
  /** The vault can email a code (`email_code_available`). */
  emailCode: boolean;
  /** The vault makes a request's PIN (`features.upload_request_pin`). */
  pins?: boolean;
  now?: Date;
}

/** What a new request's choices come to: the end, what is wrong, and what to send when nothing is. */
export function readAsk(v: AskOptions, ctx: AskContext) {
  const now = ctx.now ?? new Date();
  const maxDays = ctx.maxDays ?? SHARE_MAX_DAYS;
  const picks = shareQuickPicks(ctx.timezone, now, maxDays);
  const fallback = defaultShareEnd(ctx.timezone, now, maxDays);
  const end: AskEnd = v.end ?? (picks.some((p) => p.key === 'week') ? 'week' : 'other');
  let endAt: Date | null = null;
  let endProblem: string | null = null;
  if (end === 'other') {
    // Left empty, the day and time it would stop anyway.
    const day = v.day.trim() ? v.day : { date: fallback.date, precision: 'day' as const };
    const typed = typedEnd(day, v.time.trim() || fallback.time, ctx.timezone);
    if ('problem' in typed) endProblem = typed.problem;
    else endAt = typed.at;
  } else {
    endAt = picks.find((p) => p.key === end)?.at ?? null;
    if (!endAt) endProblem = 'day';
  }
  if (endAt) endProblem = ofRequest(shareEndProblem(endAt, { now, maxDays }));

  const title = v.title.trim();
  const titleProblem = title ? null : ('title' as const);
  const items = v.items.map((i) => i.trim()).filter(Boolean);
  // Exactly as typed, as the vault checks it.
  // A PIN where the vault makes one; never with a password.
  const pin = ctx.pins === true && v.withPin;
  const password = v.withPassword && !pin;
  const passwordProblem = password && v.passwordMode === 'typed' ? typedPasswordProblem(v.password) : null;
  const code = ctx.emailCode && v.withCode;
  const address = v.email.trim();
  const codeProblem = code ? (!isShareAddress(address) ? 'address' : v.emailRefused) : null;
  const k = takes(v);

  const body: UploadRequestInput | null =
    endAt && !endProblem && !titleProblem && !passwordProblem && !codeProblem && !k.visitsProblem && k.maxFiles !== null && k.megabytes !== null
      ? {
          title,
          ...(v.message.trim() ? { message: v.message.trim() } : {}),
          ...(items.length ? { items } : {}),
          ...(v.label.trim() ? { recipient_label: v.label.trim() } : {}),
          ...(code ? { email_code: true, recipient_email: address } : {}),
          expires_at: endAt.toISOString(),
          ...(pin ? { with_pin: true } : {}),
          ...(password ? (v.passwordMode === 'made' ? { with_password: true } : { password: v.password }) : {}),
          ...(v.thisDeviceOnly ? { this_device_only: true } : {}),
          ...(k.visits !== null ? { max_visits: k.visits } : {}),
          max_files: k.maxFiles,
          max_total_bytes: Math.min(k.megabytes * MB, UPLOAD_REQUEST_MAX_BYTES),
          accept_types: v.accept,
          review_by: v.reviewBy,
          ...(v.person ? { suggested_member_id: v.person } : {}),
          ...(v.closeAfter ? { close_after_submit: true } : {}),
        }
      : null;
  const problem =
    titleProblem ?? endProblem ?? passwordProblem ?? codeProblem ?? k.visitsProblem ?? k.filesProblem ?? k.sizeProblem ?? null;
  return { picks, fallback, end, endAt, endProblem, titleProblem, passwordProblem, codeProblem, ...k, body, problem, maxDays };
}

// ------------------------------------------------------------- a change

/** Its PIN or password: kept, taken away, a new PIN (the vault's), or a new password (the vault's, or typed). */
export type RequestSecret = 'keep' | 'none' | 'pin' | 'password';

export interface RequestChangeOptions extends AskOptions {
  changeEnd: AskChangeEnd;
  secret: RequestSecret;
}

/** The form as the request is now. */
export function startRequestChange(r: UploadRequestView, timezone: string): RequestChangeOptions {
  const at = zonedParts(new Date(r.expires_at), timezone);
  return {
    ...ASK_START,
    title: r.title,
    message: r.message ?? '',
    items: r.items.map((i) => i.label),
    label: r.recipient_label ?? '',
    // Another day starts from the day it stops now.
    day: formatDate({ date: at.date, precision: 'day' }),
    time: at.time,
    limitVisits: r.max_visits !== null,
    visits: r.max_visits !== null ? String(r.max_visits) : '3',
    maxFiles: String(r.max_files),
    maxMegabytes: startMegabytes(r),
    accept: r.accept_types,
    reviewBy: r.review_by,
    closeAfter: r.close_after_submit,
    changeEnd: 'keep',
    secret: 'keep',
  };
}

/** Its room in MB as the form starts it: unchanged unless typed anew. */
export const startMegabytes = (r: UploadRequestView) => String(Math.max(1, Math.round(r.max_total_bytes / MB)));

/**
 * A request changed (the web's ChangeRequestForm): its end never past the
 * latest it may go to from when it was made (`latest_end`), and changed only
 * when its day or time is not the one it has; its password changed only by
 * whoever asked; what it asks for, who looks, its emailed code and "this
 * browser only" stay as they were made. Only what is changed is sent.
 */
export function readRequestChange(r: UploadRequestView, v: RequestChangeOptions, ctx: { timezone: string; now?: Date }) {
  const now = ctx.now ?? new Date();
  const latest = r.latest_end ? new Date(r.latest_end) : null;
  const maxDays = latest ? Math.max(0, (latest.getTime() - now.getTime()) / 864e5) : SHARE_MAX_DAYS;
  const picks = shareQuickPicks(ctx.timezone, now, maxDays);

  let endAt: Date | null = null;
  let endProblem: string | null = null;
  if (v.changeEnd === 'other') {
    const typed = typedEnd(v.day, v.time, ctx.timezone);
    if ('problem' in typed) endProblem = typed.problem;
    else endAt = typed.at;
  } else if (v.changeEnd !== 'keep') {
    endAt = picks.find((p) => p.key === v.changeEnd)?.at ?? null;
    if (!endAt) endProblem = 'day';
  }
  if (endAt) endProblem = ofRequest(shareEndProblem(endAt, { now, maxDays }));
  // Past its latest: said as the latest it may go to, as the web says it.
  if (endProblem?.startsWith('A request can last') && latest) endProblem = 'latest';
  const was = zonedParts(new Date(r.expires_at), ctx.timezone);
  const at = endAt ? zonedParts(endAt, ctx.timezone) : null;
  const endTouched = v.changeEnd !== 'keep' && !(at && at.date === was.date && at.time === was.time);
  if (!endTouched) endProblem = null;

  const title = v.title.trim();
  const titleProblem = title ? null : ('title' as const);
  const k = takes(v);
  const maker = r.mine;
  const hasPin = r.protection.includes('pin');
  const has = hasPin || r.protection.includes('password');
  const secret: RequestSecret = maker ? v.secret : 'keep';
  const passwordProblem = secret === 'password' && v.passwordMode === 'typed' ? typedPasswordProblem(v.password) : null;

  const body: UploadRequestChangeInput = {};
  if (!titleProblem && title !== r.title) body.title = title;
  const message = v.message.trim() || null;
  if (message !== r.message) body.message = message;
  const label = v.label.trim() || null;
  if (label !== r.recipient_label) body.recipient_label = label;
  if (endTouched && endAt && !endProblem) body.expires_at = endAt.toISOString();
  if (!k.visitsProblem && k.visits !== r.max_visits) body.max_visits = k.visits;
  if (k.maxFiles !== null && k.maxFiles !== r.max_files) body.max_files = k.maxFiles;
  if (k.megabytes !== null && v.maxMegabytes.trim() !== startMegabytes(r)) {
    body.max_total_bytes = Math.min(k.megabytes * MB, UPLOAD_REQUEST_MAX_BYTES);
  }
  if (v.accept !== r.accept_types) body.accept_types = v.accept;
  if (v.closeAfter !== r.close_after_submit) body.close_after_submit = v.closeAfter;
  if (secret === 'none' && has) body.secret = 'none';
  if (secret === 'pin') body.secret = 'pin';
  if (secret === 'password') {
    body.secret = 'password';
    if (v.passwordMode === 'typed') body.password = v.password;
  }
  const nothing = Object.keys(body).length === 0;
  const problem = titleProblem ?? endProblem ?? k.visitsProblem ?? k.filesProblem ?? k.sizeProblem ?? passwordProblem ?? null;
  return { picks, latest, endAt, endProblem, titleProblem, passwordProblem, ...k, body, nothing, problem, maker, has, hasPin };
}
