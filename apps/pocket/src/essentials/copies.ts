import type { KeyRing } from '../lock/keys';
import { deleteEssentials, openEssentials, type Tier } from './open';
import type { EssentialsStore } from './store';

export interface CopiesIo {
  open(tier: Tier, hex: string): Promise<EssentialsStore>;
  remove(tier: Tier): Promise<void>;
}

const IO: CopiesIo = { open: openEssentials, remove: deleteEssentials };

/** The everyday copies, while the lock is open; null while it is closed (the key is not in memory). */
export async function openEverydayCopies(keys: KeyRing, io: CopiesIo = IO): Promise<EssentialsStore | null> {
  const hex = keys.everydayKey;
  return hex ? io.open('everyday', hex) : null;
}

export type PrivateCopies =
  { kind: 'ok'; store: EssentialsStore } | { kind: 'unavailable' } | { kind: 'changed' } | { kind: 'not_confirmed' };

/**
 * The person's Only me copies, asked for now. When the phone's
 * fingerprints or faces have changed the key is gone, and so are these
 * copies — only these: the everyday ones are under another key, untouched.
 * They are fetched again next time there is a connection.
 */
export async function openPrivateCopies(keys: KeyRing, prompt: string, io: CopiesIo = IO): Promise<PrivateCopies> {
  const key = await keys.openPrivate(prompt);
  if (key.kind === 'changed') {
    await io.remove('private');
    return { kind: 'changed' };
  }
  if (key.kind !== 'ok') return key;
  return { kind: 'ok', store: await io.open('private', key.hex) };
}
