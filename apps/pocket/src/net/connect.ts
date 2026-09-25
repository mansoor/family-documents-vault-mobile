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
import { certificateTrouble, type CertificateTrouble } from './tls';

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
  /**
   * The platform's own words for why an https request failed — expo/fetch
   * passes them on, the phone's fetch does not — or null when it went
   * through or cannot say. Asked only after a failure (4.15).
   */
  whyFailed?: (url: string) => Promise<unknown>;
  /** Whether this network reaches the internet: false behind a Wi-Fi sign-in page. */
  validated?: () => Promise<boolean | null>;
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
  | { kind: 'reinstalled'; origin: string; caps: Capabilities }
  /** The vault's certificate is not one this phone accepts (4.15). */
  | { kind: 'certificate'; host: string; trouble: CertificateTrouble }
  /** A Wi-Fi sign-in page answered instead (4.15). */
  | { kind: 'captive_portal' };

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
  let certificate: Extract<ConnectOutcome, { kind: 'certificate' }> | null = null;
  // On Wi-Fi that does not reach the internet, what answered may be its sign-in page.
  const captive = async () => network === 'wifi' && (await deps.validated?.().catch(() => null)) === false;

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
      if (err instanceof NetworkError) {
        // Nothing there on this scheme — or a certificate the phone refused.
        if (secure && deps.whyFailed && !certificate && err.kind !== 'timeout') {
          const why = await deps.whyFailed(`${origin}/api/v1/capabilities`).catch((e: unknown) => e);
          const trouble = certificateTrouble(why);
          if (trouble) certificate = { kind: 'certificate', host: address.host, trouble };
        }
        continue;
      }
      // It answered, with something that is not the capability document.
      reachedAny = true;
      return (await captive()) ? { kind: 'captive_portal' } : { kind: 'not_a_vault' };
    }
    reachedAny = true;

    const n = negotiate(caps, { clientVersion: deps.clientVersion, minServerVersion: deps.minServerVersion });
    switch (n.kind) {
      case 'not_a_vault':
        return (await captive()) ? { kind: 'captive_portal' } : n;
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
  // Only https records a certificate problem, and it says more than the
  // refusal of the http tried after it (mobile data, say).
  if (certificate && !reachedAny) {
    // A sign-in page answering for https shows its own name; a vault that
    // makes its own certificate is simply not trusted yet, internet or not.
    return certificate.trouble === 'wrong_name' && (await captive()) ? { kind: 'captive_portal' } : certificate;
  }
  if (refusal) return refusal;
  if (reachedAny) return (await captive()) ? { kind: 'captive_portal' } : { kind: 'not_a_vault' };
  return { kind: 'unreachable', host: address.host };
}
