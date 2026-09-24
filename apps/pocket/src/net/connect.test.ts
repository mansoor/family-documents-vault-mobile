import { INSTANCE, testVault } from '../test-support/vault';
import { connect, type ConnectDeps } from './connect';
import type { KnownVault, NetworkKind } from './policy';

const deps = (
  t: ReturnType<typeof testVault>,
  over: { network?: NetworkKind; known?: KnownVault[] } = {},
): ConnectDeps => ({
  fetch: t.fetch,
  network: async () => over.network ?? 'wifi',
  known: (origin) => over.known?.find((k) => k.origin === origin),
  clientVersion: '0.1.1',
  minServerVersion: '0.4.4',
  timeoutMs: 500,
});

describe('connect', () => {
  it('an https vault is found from a bare name', async () => {
    const t = testVault(['https://vault.test']);
    const out = await connect('vault.test', deps(t));
    expect(out).toMatchObject({ kind: 'ok', origin: 'https://vault.test', firstTime: true });
  });

  it('an address that answers but is not a vault is refused', async () => {
    const t = testVault(['https://router.test']);
    t.impostor.set('https://router.test', { hello: 'this is a router' });
    expect(await connect('router.test', deps(t))).toEqual({ kind: 'not_a_vault' });
  });

  it('nothing at the address says so, with the host', async () => {
    const t = testVault([]);
    expect(await connect('nowhere.test', deps(t))).toEqual({ kind: 'unreachable', host: 'nowhere.test' });
  });

  it('a vault older than the minimum says both versions', async () => {
    const t = testVault(['https://vault.test']);
    t.caps = { ...t.caps, server_version: '0.4.2' };
    expect(await connect('vault.test', deps(t))).toEqual({
      kind: 'server_too_old',
      server: '0.4.2',
      needed: '0.4.4',
    });
  });

  it('an app older than min_client_version asks for an update', async () => {
    const t = testVault(['https://vault.test']);
    t.caps = { ...t.caps, min_client_version: '0.2.0' };
    expect(await connect('vault.test', deps(t))).toEqual({
      kind: 'client_too_old',
      client: '0.1.1',
      needed: '0.2.0',
    });
  });

  it('setup_required sends you to the browser', async () => {
    const t = testVault(['https://vault.test']);
    t.caps = { ...t.caps, setup_required: true };
    expect(await connect('vault.test', deps(t))).toEqual({ kind: 'setup_required', origin: 'https://vault.test' });
  });

  it('a private vault with no certificate: https fails, http is offered, and asked about first', async () => {
    const t = testVault(['http://192.168.1.20:8099']);
    const first = await connect('192.168.1.20:8099', deps(t));
    expect(first).toMatchObject({ kind: 'ask_http', origin: 'http://192.168.1.20:8099' });
    const approved = await connect('192.168.1.20:8099', deps(t), { approveHttp: true });
    expect(approved).toMatchObject({ kind: 'ok', origin: 'http://192.168.1.20:8099', firstTime: true });
  });

  it('http to a public host is refused before any request', async () => {
    const t = testVault(['http://vault.example.com']);
    expect(await connect('http://vault.example.com', deps(t))).toEqual({
      kind: 'refuse_public_http',
      host: 'vault.example.com',
    });
    expect(t.calls).toEqual([]);
  });

  it('on mobile data, a plain-http vault is not tried at all', async () => {
    const t = testVault(['http://192.168.1.20:8099']);
    const out = await connect('http://192.168.1.20:8099', deps(t, { network: 'cellular' }));
    expect(out).toEqual({ kind: 'refuse_mobile_data', host: '192.168.1.20' });
    expect(t.calls).toEqual([]);
  });

  it('a different vault at the same http address is a stranger', async () => {
    const t = testVault(['http://192.168.1.20:8099']);
    t.caps = { ...t.caps, instance_id: '99999999-9999-4999-8999-999999999999' };
    const known: KnownVault = { origin: 'http://192.168.1.20:8099', instanceId: INSTANCE, httpApproved: true };
    expect(await connect('http://192.168.1.20:8099', deps(t, { known: [known] }))).toEqual({
      kind: 'stranger',
      host: '192.168.1.20',
    });
  });

  it('the approved vault, back again, connects without asking', async () => {
    const t = testVault(['http://192.168.1.20:8099']);
    const known: KnownVault = { origin: 'http://192.168.1.20:8099', instanceId: INSTANCE, httpApproved: true };
    expect(await connect('http://192.168.1.20:8099', deps(t, { known: [known] }))).toMatchObject({
      kind: 'ok',
      firstTime: false,
    });
  });

  it('a reinstalled https vault says so', async () => {
    const t = testVault(['https://vault.test']);
    const known: KnownVault = { origin: 'https://vault.test', instanceId: '11111111-1111-4111-8111-111111111111', httpApproved: false };
    expect(await connect('vault.test', deps(t, { known: [known] }))).toMatchObject({ kind: 'reinstalled' });
  });

  it('something that is not an address is refused', async () => {
    expect(await connect('not an address', deps(testVault()))).toEqual({ kind: 'invalid_address' });
  });
});
