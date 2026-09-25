import type { AuthPort } from './types';

/**
 * The web build (development and the browser tests) has no screen lock:
 * it runs as a phone without one does, unlocked, with nothing kept offline.
 */
export function defaultAuth(): AuthPort {
  return { level: async () => 'none', authenticate: async () => 'unavailable' };
}
