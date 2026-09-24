import {
  createApi,
  createHttp,
  negotiate,
  NetworkError,
  serverOriginFrom,
  type FetchLike,
  type ServerAddress,
} from '@fdv/client';
import type { Capabilities } from '@fdv/shared';
import { httpDecision, identityCheck, type KnownVault, type NetworkKind } from './policy';

/**
 * Connect: from what somebody typed to a vault the app can work with, or
 * one plain sentence about why not.
 *
 * Nothing secret is sent here — only GET /capabilities — so this is also
 * where the app learns which vault it is talking to (instance_id) before a
 * password or a token ever leaves the phone.
 */

export interface ConnectDeps {
  fetch: FetchLike;
  network: () => Promise<NetworkKind>;
  known: (origin: string) => KnownVault | undefined;
  clientVersion: string;
  minServerVersion: string;
  headers?: () => Record<string, string>;
  timeoutMs?: number;
}

export type ConnectOutcome =
  | { kind: 'ok'; origin: string; caps: Capabilities; firstTime: boolean }
  | { kind: 'invalid_address' }
  | { kind: 'unreachable'; host: string }
  | { kind: 'not_a_vault' }
  | { kind: 'api_version'; server: number }
  | { kind: 'server_too_old'; server: string; needed: string }
  | { kind: 'client_too_old'; client: string; needed: string }
  | { kind: 'setup_required'; origin: string }
  | { kind: 'refuse_public_http'; host: string }
  | { kind: 'refuse_mobile_data'; host: string }
  /** Plain http to a private vault, first time: warn, then call again with approveHttp. */
  | { kind: 'ask_http'; origin: string; host: string; caps: Capabilities }
  /** Something other than the approved vault is answering at this address. */
  | { kind: 'stranger'; host: string }
  /** Same https address, a new installation: whatever was signed in there is gone. */
  | { kind: 'reinstalled'; origin: string; caps: Capabilities };

/** https first; for a private host with no scheme typed, http after it. */
function candidates(address: ServerAddress): string[] {
  if (!address.assumedScheme) return [address.origin];
  const plain = address.origin.replace(/^https:/, 'http:');
  return [address.origin, plain];
}

export async function connect(
  typed: string,
  deps: ConnectDeps,
  opts: { approveHttp?: boolean } = {},
): Promise<ConnectOutcome> {
  const address = serverOriginFrom(typed);
  if (!address) return { kind: 'invalid_address' };
  const network = await deps.network();
  let reachedAny = false;
  let refusal: ConnectOutcome | null = null;

  for (const origin of candidates(address)) {
    const secure = origin.startsWith('https://');
    const known = deps.known(origin);
    const decision = httpDecision({ origin, host: address.host }, network, known);
    if (decision.kind === 'refuse_public') {
      // Typed http to a public host: refuse. Assumed https that failed:
      // the fallback is simply not tried, and the failure stands.
      refusal ??= address.assumedScheme ? null : { kind: 'refuse_public_http', host: address.host };
      continue;
    }
    if (decision.kind === 'refuse_mobile_data') {
      refusal ??= { kind: 'refuse_mobile_data', host: address.host };
      continue;
    }

    const api = createApi(
      createHttp({
        baseUrl: origin,
        fetch: deps.fetch,
        timeoutMs: deps.timeoutMs ?? 8_000,
        ...(deps.headers ? { headers: deps.headers } : {}),
      }),
    );
    let caps: unknown;
    try {
      caps = await api.capabilities();
    } catch (err) {
      if (err instanceof NetworkError) continue; // nothing there on this scheme
      // It answered, with something that is not the capability document.
      reachedAny = true;
      return { kind: 'not_a_vault' };
    }
    reachedAny = true;

    const n = negotiate(caps, { clientVersion: deps.clientVersion, minServerVersion: deps.minServerVersion });
    switch (n.kind) {
      case 'not_a_vault':
      case 'server_too_old':
      case 'client_too_old':
      case 'api_version':
        return n;
      case 'setup_required':
        return { kind: 'setup_required', origin };
      case 'ok':
        break;
    }
    const identity = identityCheck(origin, known?.instanceId ?? null, n.caps.instance_id);
    if (identity.kind === 'stranger') return { kind: 'stranger', host: address.host };
    if (identity.kind === 'reinstalled') return { kind: 'reinstalled', origin, caps: n.caps };
    if (!secure && decision.kind === 'ask' && !opts.approveHttp) {
      return { kind: 'ask_http', origin, host: address.host, caps: n.caps };
    }
    return { kind: 'ok', origin, caps: n.caps, firstTime: identity.kind === 'first' };
  }
  if (refusal) return refusal;
  return reachedAny ? { kind: 'not_a_vault' } : { kind: 'unreachable', host: address.host };
}
