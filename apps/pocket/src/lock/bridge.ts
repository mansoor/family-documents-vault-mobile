/**
 * Signing in with a password is proving who you are, so it opens the lock
 * (4.8). The vault says so here, in the same moment it becomes signed in,
 * and the lock opens in that same render — the lock screen is never shown,
 * and the phone's own prompt never asked for, right after a password.
 */
let listener: (() => void) | null = null;

export function onSignedIn(fn: () => void): () => void {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}

export function signedIn(): void {
  listener?.();
}
