import { ApiRequestError, isAppUpdateRequired, type Http } from '@fdv/client';

/**
 * Two answers that hold the whole app back rather than refuse one request
 * (0.20.0), and say nothing about what was asked:
 *
 *  - `426 app_update_required`: this app is older than the vault works
 *    with. The session stays, and so does everything kept on the phone.
 *  - `403 two_step_setup_required`: this session must set up two-step
 *    sign-in (or confirm it with a code) before anything else.
 *
 * Neither is a refusal of a scan or a note: what waits on the phone keeps
 * waiting, and goes once the app or the sign-in is put right.
 */
export function twoStepHeld(err: unknown): err is ApiRequestError {
  return err instanceof ApiRequestError && err.code === 'two_step_setup_required';
}

export function sessionHeld(err: unknown): boolean {
  return isAppUpdateRequired(err) || twoStepHeld(err);
}

/**
 * The vault's http, telling `heard` of every failure on its way back to
 * the caller, so either answer is noticed whichever call met it — a
 * screen's, the queue's, a note's — and never only where a screen
 * happened to look.
 */
export function heeding(http: Http, heard: (err: unknown) => void): Http {
  const told = <T,>(p: Promise<T>): Promise<T> =>
    p.catch((err: unknown) => {
      heard(err);
      throw err;
    });
  return {
    baseUrl: http.baseUrl,
    url: (path) => http.url(path),
    request: (path, opts) => told(http.request(path, opts)),
    raw: (path, opts) => told(http.raw(path, opts)),
  };
}
