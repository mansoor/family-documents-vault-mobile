/**
 * How the phone proves who is holding it (4.8).
 *
 * The lock is the phone's own: its fingerprint or face, with the phone's
 * PIN or pattern always allowed instead. The app never sees any of them,
 * only the answer.
 */

/** What the phone has: no screen lock, a PIN or pattern only, weak biometrics, or strong ones. */
export type LockLevel = 'none' | 'secret' | 'weak' | 'strong';

/** How asking went. */
export type AuthOutcome = 'ok' | 'cancelled' | 'lockout' | 'unavailable' | 'failed';

export interface AuthPort {
  level(): Promise<LockLevel>;
  /** The system's prompt, with the phone's PIN or pattern allowed. */
  authenticate(prompt: string): Promise<AuthOutcome>;
  /** Takes the prompt away (one that has not answered in a minute). */
  cancel?(): Promise<void>;
}

/**
 * The e2e build's: a phone with a PIN, unlocked by a tap on Unlock — there
 * is no system prompt an emulator test could answer.
 */
export function fakeAuth(): AuthPort {
  return { level: async () => 'secret', authenticate: async () => 'ok' };
}

/**
 * Keeping the screen out of screenshots, screen recordings and the recent
 * apps view. Each part of the app that wants it asks under its own name;
 * the screen is protected while any of them does.
 */
export interface ScreenGuardPort {
  prevent(name: string): Promise<void>;
  allow(name: string): Promise<void>;
}
