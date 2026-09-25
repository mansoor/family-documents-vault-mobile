import type { ScreenGuardPort } from './types';

/** The web build: a browser has no such switch. */
export function defaultScreenGuard(): ScreenGuardPort {
  return { prevent: async () => undefined, allow: async () => undefined };
}
