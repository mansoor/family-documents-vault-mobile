import type { StoredSession, TokenStore } from '@fdv/client';
import { randomUUID } from 'expo-crypto';
import { secureDelete, secureGet, secureSet } from '../platform/secure';

/**
 * Where the session lives: the refresh token and who it is for, in the
 * OS keystore (this device only, while unlocked). The access token never
 * touches storage — it lives in memory and is fetched again when needed.
 */
export const SESSION_KEY = 'fdv.session.v1';
export const INSTALLATION_KEY = 'fdv.installation.v1';

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
 * installation id.
 */
export async function forgetPreviousInstallation(): Promise<void> {
  await secureDelete(SESSION_KEY);
  await secureDelete(INSTALLATION_KEY);
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
