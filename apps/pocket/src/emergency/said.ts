import { emit } from '../state/events';

/**
 * What the emergency page says once the editor has saved (app 0.19.0):
 * "Saved." It is kept until that person's page takes it, so it is said
 * whether the page stayed underneath (it hears `emergencyChanged`) or is
 * drawn afresh (it finds it waiting), as Sharing's words since 0.18.0.
 */
const waiting = new Map<string, string>();

export function sayOnEmergencyPage(memberId: string, words: string): void {
  waiting.set(memberId, words);
  emit('emergencyChanged', memberId, words);
}

/** What is waiting for this person's page, left there. */
export const waitingSaid = (memberId: string): string | null => waiting.get(memberId) ?? null;

/** What is waiting for this person's page, taken. */
export function takeSaid(memberId: string): string | null {
  const words = waiting.get(memberId) ?? null;
  waiting.delete(memberId);
  return words;
}
