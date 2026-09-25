import { readPrefs, writePrefs } from '../platform/prefs';
import type { KnownVault } from '../net/policy';

/**
 * The vaults this phone knows: the one it uses now, and what it learnt
 * about each (installation id, http approval, the email last signed in
 * with, to show in Settings). Not secret, and never backed up.
 */
export interface VaultRecord extends KnownVault {
  displayName: string | null;
  email: string | null;
}

export interface Vaults {
  current: string | null;
  known: VaultRecord[];
}

const NAME = 'vaults';

export const readVaults = (): Vaults => readPrefs<Vaults>(NAME, { current: null, known: [] });

export function saveVault(record: VaultRecord, makeCurrent = true): Vaults {
  const now = readVaults();
  const next: Vaults = {
    current: makeCurrent ? record.origin : now.current,
    known: [...now.known.filter((k) => k.origin !== record.origin), record],
  };
  writePrefs(NAME, next);
  return next;
}

export function updateVault(origin: string, patch: Partial<VaultRecord>): Vaults {
  const now = readVaults();
  const next: Vaults = {
    ...now,
    known: now.known.map((k) => (k.origin === origin ? { ...k, ...patch } : k)),
  };
  writePrefs(NAME, next);
  return next;
}

/**
 * Everything the phone knew of a vault — its instance id, the approval
 * for plain http, the email last used — gone (4.15, Change server): the
 * next time is a first time.
 */
export function forgetVault(origin: string): Vaults {
  const now = readVaults();
  const next = {
    current: now.current === origin ? null : now.current,
    known: now.known.filter((k) => k.origin !== origin),
  };
  writePrefs(NAME, next);
  return next;
}

export function leaveVault(): Vaults {
  const next = { ...readVaults(), current: null };
  writePrefs(NAME, next);
  return next;
}
