import { ApiRequestError, NetworkError } from '@fdv/client';
import type { TFunction } from 'i18next';

/**
 * A failure in words (4.17). What the app can say better than the vault —
 * no answer at all, too many tries, a session that is over, a request the
 * vault wants confirmed, an answer that was not the vault's — comes from
 * the catalogue, in the app's own voice. Anything else the vault answered
 * is said in the vault's own words, which it writes to be shown, verbatim;
 * an answer with none gets the catalogue's general words. Never a code,
 * never "error".
 *
 * Every code the app or its client acts on is here: copy-coverage.test.ts
 * reads their sources for the codes they compare against, and fails when
 * one is missing, or its words are.
 */
export const CATALOGUE: Readonly<Record<string, string>> = {
  // No answer at all (a NetworkError, by its kind).
  offline: 'errors.offline',
  timeout: 'errors.timeout',
  // Answers the client itself acts on.
  session_ended: 'errors.sessionEnded',
  unauthenticated: 'errors.sessionEnded',
  step_up_required: 'errors.stepUp',
  setup_required: 'errors.setupRequired',
  http_error: 'errors.unexpected',
  rate_limited: 'errors.rateLimited',
  // Answers the app's screens act on.
  invalid_credentials: 'errors.invalidCredentials',
  not_found: 'errors.notFound',
  preview_pending: 'errors.previewPending',
  no_preview: 'errors.noPreview',
  scan_in_progress: 'errors.scanInProgress',
  upload_in_progress: 'errors.uploadInProgress',
};

/**
 * Codes whose exact words only the vault has — which password, which thing
 * was not found — so its message is shown when it gives one, and the
 * catalogue's only when it does not.
 */
const VAULT_SAYS: ReadonlySet<string> = new Set(['invalid_credentials', 'not_found']);

/** The words for a failure, as the person should read them. */
export function wordsFor(err: unknown, t: TFunction, general = 'errors.general'): string {
  if (err instanceof NetworkError) return t(CATALOGUE[err.kind] ?? CATALOGUE.offline ?? general);
  if (err instanceof ApiRequestError) {
    // Too many tries, however the vault's limiter phrased it: when to try again.
    if (err.status === 429 || err.code === 'rate_limited') {
      const minutes = Math.max(1, Math.ceil((err.retryAfterSeconds ?? 60) / 60));
      return t('errors.rateLimited', { count: minutes });
    }
    const key = CATALOGUE[err.code];
    if (key && VAULT_SAYS.has(err.code) && err.message) return err.message;
    if (key) return t(key);
    return err.message || t(general);
  }
  return t(general);
}
