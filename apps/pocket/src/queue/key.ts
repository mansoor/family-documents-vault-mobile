import { getRandomValues } from 'expo-crypto';
import { secureGet, secureSet } from '../platform/secure';

export const QUEUE_KEY = 'fdv.queue-key.v1';

/**
 * The key queue.db is encrypted under: 32 random bytes, made on first use,
 * kept in the OS keystore for this device only and readable whenever the
 * phone is unlocked — not behind a fingerprint, because the queue has to
 * send by itself. As hex, which is how SQLCipher takes a raw key.
 */
export async function queueKey(): Promise<{ hex: string; made: boolean }> {
  const stored = await secureGet(QUEUE_KEY);
  if (stored && /^[0-9a-f]{64}$/.test(stored)) return { hex: stored, made: false };
  const bytes = getRandomValues(new Uint8Array(32));
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  await secureSet(QUEUE_KEY, hex);
  return { hex, made: true };
}
