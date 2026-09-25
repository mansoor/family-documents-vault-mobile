import { getRandomValues } from 'expo-crypto';
import { readPrefs, writePrefs } from '../platform/prefs';
import {
  canUseStrongBiometrics,
  secureDelete,
  secureGet,
  secureGetGuarded,
  secureSet,
  secureSetGuarded,
} from '../platform/secure';

/** The everyday Essentials' key: this device only, readable once the phone is unlocked. */
export const ESSENTIALS_KEY = 'fdv.essentials-key.v1';
/** The Only me Essentials' key: behind strong biometrics, gone when enrolment changes. */
export const PRIVATE_KEY = 'fdv.essentials-private-key.v1';

export interface KeyStorePort {
  get(name: string): Promise<string | null>;
  set(name: string, value: string): Promise<void>;
  delete(name: string): Promise<void>;
  /** Null when there is none, or when the system has invalidated it; throws when not confirmed. */
  getGuarded(name: string, prompt: string): Promise<string | null>;
  setGuarded(name: string, value: string, prompt: string): Promise<void>;
  canUseStrong(): boolean;
  /** Whether an Only me key was made on this phone: without it, a missing key is only not made yet. */
  privateMade(): boolean;
  setPrivateMade(made: boolean): void;
}

export function defaultKeyStore(): KeyStorePort {
  return {
    get: secureGet,
    set: secureSet,
    delete: secureDelete,
    getGuarded: secureGetGuarded,
    setGuarded: secureSetGuarded,
    canUseStrong: canUseStrongBiometrics,
    privateMade: () => readPrefs('private-key', { made: false }).made,
    setPrivateMade: (made) => writePrefs('private-key', { made }),
  };
}

const HEX = /^[0-9a-f]{64}$/;
const newHex = () => Array.from(getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');

export type PrivateKey =
  | { kind: 'ok'; hex: string }
  /** No strong biometrics on this phone: Only me copies cannot be kept. */
  | { kind: 'unavailable' }
  /** A fingerprint or face was added or changed: the key is gone, and so must its copies be. */
  | { kind: 'changed' }
  /** The person did not confirm. */
  | { kind: 'not_confirmed' };

/**
 * The keys of the two offline stores (4.8), as SQLCipher takes them: 32
 * random bytes in hex.
 *
 *  - **Everyday Essentials** (household and adults-only): a key in the
 *    phone's keystore for this device only. Not behind a fingerprint — it
 *    is read once the app's lock has opened, and held in memory until the
 *    lock closes again, when it is dropped.
 *  - **Only me Essentials**: a key behind the phone's strong biometrics,
 *    with no PIN instead, read only when an Only me copy is opened and
 *    never held. Adding or changing a fingerprint or face makes the system
 *    throw it away; the copies it locked are then wiped and fetched again
 *    online.
 */
export class KeyRing {
  private everyday: string | null = null;

  constructor(private readonly store: KeyStorePort = defaultKeyStore()) {}

  /** After the lock opens: the everyday key, made on first use, now in memory. */
  async openEveryday(): Promise<string> {
    let hex: string | null = null;
    try {
      hex = await this.store.get(ESSENTIALS_KEY);
    } catch {
      // A keystore entry that cannot be read is a key that is gone.
      await this.store.delete(ESSENTIALS_KEY).catch(() => undefined);
    }
    if (!hex || !HEX.test(hex)) {
      hex = newHex();
      await this.store.set(ESSENTIALS_KEY, hex);
    }
    this.everyday = hex;
    return hex;
  }

  /** The everyday key while the lock is open; null otherwise. */
  get everydayKey(): string | null {
    return this.everyday;
  }

  /** The lock has closed: nothing stays in memory. */
  drop(): void {
    this.everyday = null;
  }

  /** The Only me key, asked for now: made the first time, and asked again every time. */
  async openPrivate(prompt: string): Promise<PrivateKey> {
    if (!this.store.canUseStrong()) return { kind: 'unavailable' };
    let hex: string | null;
    try {
      hex = await this.store.getGuarded(PRIVATE_KEY, prompt);
    } catch {
      return { kind: 'not_confirmed' };
    }
    if (hex && HEX.test(hex)) return { kind: 'ok', hex };
    if (this.store.privateMade()) {
      // It was made here and the system has thrown it away.
      await this.store.delete(PRIVATE_KEY).catch(() => undefined);
      this.store.setPrivateMade(false);
      return { kind: 'changed' };
    }
    const made = newHex();
    try {
      await this.store.setGuarded(PRIVATE_KEY, made, prompt);
    } catch {
      return { kind: 'not_confirmed' };
    }
    this.store.setPrivateMade(true);
    return { kind: 'ok', hex: made };
  }

  /** A new installation: none of a previous one's keys are kept. */
  async forget(): Promise<void> {
    this.everyday = null;
    await this.store.delete(ESSENTIALS_KEY).catch(() => undefined);
    await this.store.delete(PRIVATE_KEY).catch(() => undefined);
    this.store.setPrivateMade(false);
  }
}
