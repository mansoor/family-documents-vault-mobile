import type { StoredSession, TokenStore } from '@fdv/client';
import { randomUUID } from 'expo-crypto';
import { ESSENTIALS_KEY, PRIVATE_KEY } from '../lock/keys';
import { log } from '../log';
import { writePrefs } from '../platform/prefs';
import { secureDelete, secureGet, secureSet } from '../platform/secure';

/**
 * Where the session lives: the refresh token and who it is for, in the
 * OS keystore (this device only, while unlocked). The access token never
 * touches storage — it lives in memory and is fetched again when needed.
 */
export const SESSION_KEY = 'fdv.session.v1';
export const INSTALLATION_KEY = 'fdv.installation.v1';
/**
 * This phone's proof that it signed in before (0.20.0, the vault's
 * `Tokens.device_proof`), one per vault: sent with the password, so failed
 * tries from anywhere else never make this phone wait. Kept in the keystore
 * as the refresh token is, each vault's under a key of its own (the
 * address hashed: a keystore name takes letters, digits, ".", "-" and "_"),
 * and kept when signing out: it is about the phone, not the session. Opens
 * nothing by itself. The index lists the keys, so a fresh installation can
 * forget them all without knowing the addresses.
 */
export const DEVICE_PROOF_PREFIX = 'fdv.device-proof.v2.';
export const DEVICE_PROOF_INDEX = 'fdv.device-proof.index.v2';

/** At most this long, as the vault says; anything else kept is not one of its proofs. */
const PROOF_MAX = 200;

/** A vault's address as a keystore name: two 32-bit FNV-1a hashes, not for secrecy, only for a name. */
export function deviceProofKey(origin: string): string {
  const fnv = (seed: number) => {
    let h = seed >>> 0;
    for (let i = 0; i < origin.length; i += 1) {
      h ^= origin.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  };
  return `${DEVICE_PROOF_PREFIX}${fnv(0x811c9dc5)}${fnv(0x2f2a1d3b)}`;
}

async function readIndex(): Promise<string[]> {
  try {
    const raw = await secureGet(DEVICE_PROOF_INDEX);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

/** The proof this phone keeps for the vault at `origin`, or null. */
export async function loadDeviceProof(origin: string): Promise<string | null> {
  const proof = await secureGet(deviceProofKey(origin)).catch(() => null);
  return typeof proof === 'string' && proof.length > 0 && proof.length <= PROOF_MAX ? proof : null;
}

/**
 * Keeps the vault's newest proof for `origin`. A keystore that will not
 * take it costs only the wait after others' failed tries: said in the log
 * (never the proof), and the sign-in goes on.
 */
export async function saveDeviceProof(origin: string, proof: string): Promise<void> {
  if (!proof || proof.length > PROOF_MAX) return;
  const key = deviceProofKey(origin);
  try {
    await secureSet(key, proof);
    const index = await readIndex();
    if (!index.includes(key)) await secureSet(DEVICE_PROOF_INDEX, JSON.stringify([...index, key]));
  } catch {
    log.warn('device_proof.not_kept', {});
  }
}

/** This vault's proof forgotten: another installation answers at its address now (0.20.0). */
export async function forgetDeviceProof(origin: string): Promise<void> {
  await secureDelete(deviceProofKey(origin)).catch(() => undefined);
}

/** Every vault's proof forgotten: a fresh installation starts from nothing. */
async function forgetDeviceProofs(): Promise<void> {
  for (const key of await readIndex()) await secureDelete(key).catch(() => undefined);
  await secureDelete(DEVICE_PROOF_INDEX).catch(() => undefined);
}

/**
 * The session's store, with this vault's device proof beside it (0.20.0):
 * each vault is sent only the proof it gave.
 */
export function withDeviceProof(store: TokenStore, origin: string): TokenStore {
  return {
    load: () => store.load(),
    save: (session) => store.save(session),
    loadDeviceProof: () => loadDeviceProof(origin),
    saveDeviceProof: (proof) => saveDeviceProof(origin, proof),
  };
}

export class SecureTokenStore implements TokenStore {
  async load(): Promise<StoredSession | null> {
    const raw = await secureGet(SESSION_KEY);
    if (!raw) return null;
    try {
      const s = JSON.parse(raw) as StoredSession;
      return typeof s.refresh_token === 'string' ? s : null;
    } catch {
      return null;
    }
  }

  async save(session: StoredSession | null): Promise<void> {
    if (session) await secureSet(SESSION_KEY, JSON.stringify(session));
    else await secureDelete(SESSION_KEY);
  }
}

/**
 * The keystore can outlive the app (a reinstall on some phones, and always
 * on iOS). A fresh installation starts from nothing: no session, a new
 * installation id, and none of the old installation's offline stores'
 * keys (4.8).
 */
export async function forgetPreviousInstallation(): Promise<void> {
  await secureDelete(SESSION_KEY);
  await secureDelete(INSTALLATION_KEY);
  await forgetDeviceProofs();
  // Not the queue's key: the queue may already be open under it (it opens
  // as the app starts), and a queue key that outlived its queue.db is only
  // ever used for a new, empty one.
  for (const key of [ESSENTIALS_KEY, PRIVATE_KEY]) await secureDelete(key).catch(() => undefined);
  writePrefs('private-key', { made: false });
}

let installation: string | null = null;

/**
 * This installation's own id, made once. The vault uses it to tell this
 * phone from another in the list of signed-in devices and new-device
 * alerts; it says nothing about the phone or the person.
 */
export async function installationId(): Promise<string> {
  if (installation) return installation;
  let stored: string | null = null;
  try {
    stored = await secureGet(INSTALLATION_KEY);
  } catch {
    // Unreadable (a keystore key lost with a restored backup): start again.
    await secureDelete(INSTALLATION_KEY).catch(() => undefined);
  }
  if (stored) {
    installation = stored;
    return stored;
  }
  const made = randomUUID();
  // A keystore that will not take it still leaves this run an id.
  await secureSet(INSTALLATION_KEY, made).catch(() => undefined);
  installation = made;
  return made;
}

/** Tests only: forget the id held in memory. */
export function resetInstallationForTests(): void {
  installation = null;
}
