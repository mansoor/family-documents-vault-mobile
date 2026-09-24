import { isPrivateHost, type ServerAddress } from '@fdv/client';

/**
 * When the app may talk to a vault over plain http, and when it may send it
 * a password or a token.
 *
 * A self-hosted vault on the home network often has no certificate, and
 * refusing it outright would leave the family with no app. So plain http is
 * allowed — but only where it is about as safe as it gets:
 *
 *  - only to a private address (the home network, a VPN such as Tailscale,
 *    this device), never to anything on the internet;
 *  - only on Wi-Fi or Ethernet, never on mobile data, where "private"
 *    addresses belong to the carrier, not the family — and not when the
 *    phone cannot say which network it is on;
 *  - only after the person has been told, once per vault, what it means.
 *
 * And nothing secret is sent to an http address unless the vault answering
 * there right now is the one approved before (its instance_id): the same
 * address on another network — a café's 192.168.1.20 — is somebody else.
 */

/**
 * 'unknown' is a phone that cannot say which network it is on, treated as
 * mobile data. 'browser' is the web build (development and the browser
 * tests), where no network can be named and the vault is on this machine.
 */
export type NetworkKind = 'wifi' | 'ethernet' | 'cellular' | 'none' | 'unknown' | 'browser';

/** What the phone remembers about a vault it has connected to. */
export interface KnownVault {
  origin: string;
  /** The vault's installation id, recorded the first time it was trusted. */
  instanceId: string | null;
  /** The person has seen the warning about plain http for this vault, and said yes. */
  httpApproved: boolean;
}

export type HttpDecision =
  | { kind: 'secure' }
  | { kind: 'refuse_public' }
  | { kind: 'refuse_mobile_data' }
  | { kind: 'ask' }
  | { kind: 'allowed' };

export function httpDecision(
  address: Pick<ServerAddress, 'origin' | 'host'>,
  network: NetworkKind,
  known: KnownVault | undefined,
): HttpDecision {
  if (address.origin.startsWith('https://')) return { kind: 'secure' };
  if (!isPrivateHost(address.host)) return { kind: 'refuse_public' };
  if (network === 'cellular' || network === 'unknown') return { kind: 'refuse_mobile_data' };
  if (!known?.httpApproved) return { kind: 'ask' };
  return { kind: 'allowed' };
}

export type Identity =
  /** First time: record this vault's id. */
  | { kind: 'first' }
  | { kind: 'same' }
  /** Over http: not the vault that was approved. Send nothing. */
  | { kind: 'stranger' }
  /** Over https: the same address, a new installation. Sign in again. */
  | { kind: 'reinstalled' };

export function identityCheck(
  origin: string,
  recorded: string | null,
  answered: string | undefined,
): Identity {
  const secure = origin.startsWith('https://');
  if (recorded === null) {
    // An http vault that will not say who it is can never be told apart
    // from an impostor later, so it is not trusted in the first place.
    return !secure && !answered ? { kind: 'stranger' } : { kind: 'first' };
  }
  if (answered === recorded) return { kind: 'same' };
  return secure ? { kind: 'reinstalled' } : { kind: 'stranger' };
}
