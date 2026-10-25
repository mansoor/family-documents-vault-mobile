import { getRandomValues } from 'expo-crypto';

/**
 * Web Crypto's random numbers, `crypto.getRandomValues`, where the platform
 * has none of its own: Hermes has no `crypto` at all. The vault's shared
 * client draws every upload's multipart boundary from it (since its
 * v0.8.0-dev.7), so without it each scan's upload threw before anything
 * was sent, and the scan waited on the phone as if there were no
 * connection. The phone's own secure source, expo-crypto's, stands in.
 * Where there is one already — the web build, Node under the tests — it is
 * left alone.
 */
export function installWebCrypto(target: { crypto?: unknown } = globalThis as { crypto?: unknown }): void {
  const existing = target.crypto as { getRandomValues?: unknown } | undefined;
  if (typeof existing?.getRandomValues === 'function') return;
  target.crypto = { ...existing, getRandomValues };
}

installWebCrypto();
