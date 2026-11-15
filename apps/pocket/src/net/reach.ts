import { Platform } from 'react-native';
import type { NetworkKind } from './policy';

/**
 * Why the vault gives no answer, as the person is told it (0.13.0):
 *
 * - 'no_network': the phone itself is offline (no Wi-Fi, no mobile data;
 *   airplane mode).
 * - 'unreachable': the phone has a network, but the vault does not answer on
 *   it — a Wi-Fi sign-in page, a vault only reachable over a VPN that is off,
 *   a tunnel down, a name that does not resolve, a certificate refused, or no
 *   answer in time.
 *
 * And 'online' when it answers. An answer that is an error is neither: the
 * vault's own words say that (errors/words.ts).
 */
export type Reach = 'online' | 'no_network' | 'unreachable';

/** Whether the phone has no network at all: none named, or a browser that says it is offline. */
export function noNetwork(kind: NetworkKind): boolean {
  if (kind === 'none') return true;
  if (kind === 'browser' || Platform.OS === 'web') {
    const nav = (globalThis as { navigator?: { onLine?: boolean } }).navigator;
    return nav?.onLine === false;
  }
  return false;
}

/**
 * What the vault's state last found, for words said where there is no
 * render to read it from (errors/words.ts): set by state/vault.tsx.
 */
let phoneOffline = false;

export function setPhoneOffline(value: boolean): void {
  phoneOffline = value;
}

export function isPhoneOffline(): boolean {
  return phoneOffline;
}
