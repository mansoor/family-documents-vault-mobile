import { serverOriginFrom } from '@fdv/client';

/**
 * What was pasted into the address field (4.15). A link from the vault's
 * own pages carries a secret in its path — an invitation, a password
 * reset, a share. The app has no use for the secret and never keeps it:
 * the address becomes the vault's origin (for an invitation or a reset),
 * and the link itself is only ever handed to the browser, when asked. It
 * is not stored, and not logged.
 */
export type Pasted =
  /** An address, or something that is not a link of the vault's: connected to as typed. */
  | { kind: 'address' }
  /** An invitation or a password reset: finished in the browser, then signed in here. */
  | { kind: 'join' | 'reset'; origin: string; link: string }
  /** A share, for somebody outside the family: it opens in the browser. */
  | { kind: 'shared'; link: string };

const LINK = /^\/(join|reset|shared)\/([^/?#]+)\/?(?:[?#].*)?$/;

export function readPasted(text: string): Pasted {
  const address = serverOriginFrom(text);
  if (!address?.trimmed) return { kind: 'address' };
  const typed = text.trim();
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(typed);
  const rest = scheme ? typed.slice(scheme[0].length) : typed;
  const cut = rest.search(/[/?#]/);
  const path = cut === -1 ? '' : rest.slice(cut);
  const m = LINK.exec(path);
  if (!m) return { kind: 'address' };
  const kind = m[1] as 'join' | 'reset' | 'shared';
  // The link as the browser should open it: the origin as the app reads it, the path as pasted.
  const link = `${address.origin}${path}`;
  return kind === 'shared' ? { kind, link } : { kind, origin: address.origin, link };
}
