import { serverOriginFrom } from '@fdv/client';
import { httpDecision, identityCheck, type KnownVault } from './policy';

const at = (typed: string) => {
  const a = serverOriginFrom(typed);
  if (!a) throw new Error(`not an address: ${typed}`);
  return a;
};
const known = (origin: string, over: Partial<KnownVault> = {}): KnownVault => ({
  origin,
  instanceId: '11111111-1111-4111-8111-111111111111',
  httpApproved: true,
  ...over,
});

describe('plain http', () => {
  it('http to a public host is refused before any request', () => {
    expect(httpDecision(at('http://vault.example.com'), 'wifi', undefined)).toEqual({ kind: 'refuse_public' });
    expect(httpDecision(at('http://8.8.8.8:8099'), 'wifi', undefined)).toEqual({ kind: 'refuse_public' });
    // A look-alike: octal "010" is 8.0.0.1, a public address.
    expect(serverOriginFrom('http://010.0.0.1')).toBeNull();
  });

  it('http to 192.168.1.20 warns once and remembers', () => {
    const address = at('http://192.168.1.20:8099');
    expect(httpDecision(address, 'wifi', undefined)).toEqual({ kind: 'ask' });
    expect(httpDecision(address, 'wifi', known(address.origin, { httpApproved: false }))).toEqual({ kind: 'ask' });
    expect(httpDecision(address, 'wifi', known(address.origin))).toEqual({ kind: 'allowed' });
    expect(httpDecision(address, 'ethernet', known(address.origin))).toEqual({ kind: 'allowed' });
  });

  it('on mobile data http is never used', () => {
    const address = at('http://192.168.1.20:8099');
    expect(httpDecision(address, 'cellular', known(address.origin))).toEqual({ kind: 'refuse_mobile_data' });
    // Tailscale's addresses are private too, and still not over mobile data.
    expect(httpDecision(at('http://100.101.102.103'), 'cellular', undefined)).toEqual({ kind: 'refuse_mobile_data' });
  });

  it('https is always fine', () => {
    expect(httpDecision(at('vault.example.com'), 'cellular', undefined)).toEqual({ kind: 'secure' });
  });
});

describe('which vault is answering', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const other = '22222222-2222-4222-8222-222222222222';

  it('a different vault at the same address gets nothing: no password or token leaves the phone', () => {
    expect(identityCheck('http://192.168.1.20:8099', id, other)).toEqual({ kind: 'stranger' });
    // One that will not say who it is, over http, is not trusted either.
    expect(identityCheck('http://192.168.1.20:8099', id, undefined)).toEqual({ kind: 'stranger' });
    expect(identityCheck('http://192.168.1.20:8099', null, undefined)).toEqual({ kind: 'stranger' });
  });

  it('the same vault is recognised; a first one is recorded', () => {
    expect(identityCheck('http://192.168.1.20:8099', id, id)).toEqual({ kind: 'same' });
    expect(identityCheck('http://192.168.1.20:8099', null, id)).toEqual({ kind: 'first' });
  });

  it('over https a new id means the vault was reinstalled: sign in again', () => {
    expect(identityCheck('https://vault.example.com', id, other)).toEqual({ kind: 'reinstalled' });
  });
});
