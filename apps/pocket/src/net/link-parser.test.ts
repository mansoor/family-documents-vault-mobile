import { readPasted } from './links';

/** What a pasted link becomes in the address field (4.15): never its secret. */
describe('a link pasted as the address', () => {
  it('an invitation link becomes the address and an Open in browser prompt; the token is gone', () => {
    const r = readPasted('https://vault.example.com/join/link-secret-0123456789abcdef');
    expect(r).toEqual({
      kind: 'join',
      origin: 'https://vault.example.com',
      link: 'https://vault.example.com/join/link-secret-0123456789abcdef',
    });
    // What becomes the address carries nothing of it.
    expect(r.kind === 'join' && r.origin.includes('link-secret')).toBe(false);
    // As somebody copies it: no scheme, a port, a trailing slash.
    expect(readPasted('  vault.local:8443/join/abc123/  ')).toEqual({
      kind: 'join',
      origin: 'https://vault.local:8443',
      link: 'https://vault.local:8443/join/abc123/',
    });
    expect(readPasted('http://192.168.1.20:8080/reset/reset-secret')).toEqual({
      kind: 'reset',
      origin: 'http://192.168.1.20:8080',
      link: 'http://192.168.1.20:8080/reset/reset-secret',
    });
    // IPv6, as a browser writes it.
    expect(readPasted('https://[fd00::20]:8443/join/abc')).toMatchObject({
      kind: 'join',
      origin: 'https://[fd00::20]:8443',
    });
  });

  it('a shared link opens in the browser', () => {
    expect(readPasted('https://vault.example.com/shared/share-secret-0123')).toEqual({
      kind: 'shared',
      link: 'https://vault.example.com/shared/share-secret-0123',
    });
  });

  it('anything else is an address, as typed', () => {
    for (const typed of [
      'vault.example.com',
      'https://vault.example.com/',
      'https://vault.example.com/documents/abc',
      'https://vault.example.com/join/',
      'https://vault.example.com/join/a/b',
      'https://someone@vault.example.com/join/abc',
      'not an address',
      '',
    ]) {
      expect(readPasted(typed)).toEqual({ kind: 'address' });
    }
  });
});
