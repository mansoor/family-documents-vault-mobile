import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The config plugin as prebuild runs it (4.15; by build since 0.21.0): the
// file it writes, and the manifest pointing at it. The release build trusts
// only the system's authorities and refuses plain http; the test builds
// (dev, preview, e2e) keep cleartext, the app's own decision per host, and
// trust a certificate installed by hand, for the throwaway vaults they reach.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const withNetworkSecurity = require('../../plugins/with-network-security.js') as (c: object) => {
  mods: { android: Record<string, (p: object) => Promise<{ modResults: unknown }>> };
};

const request = (root: string, modName: string) => ({
  platform: 'android',
  modName,
  projectRoot: root,
  platformProjectRoot: join(root, 'android'),
  introspect: false,
  ignoreExistingNativeFiles: false,
});

const configFor = (variant: string | undefined) =>
  withNetworkSecurity({ name: 'FV', slug: 'fv', extra: variant ? { variant } : {} });

async function written(variant: string | undefined): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'fv-nsc-'));
  await configFor(variant).mods.android.dangerous?.({ modRequest: request(root, 'dangerous'), modResults: {} });
  return readFileSync(join(root, 'android', 'app', 'src', 'main', 'res', 'xml', 'network_security_config.xml'), 'utf8');
}

async function manifest(variant: string | undefined): Promise<Record<string, string> | undefined> {
  const root = mkdtempSync(join(tmpdir(), 'fv-nsc-'));
  const out = await configFor(variant).mods.android.manifest?.({
    modRequest: request(root, 'manifest'),
    modResults: { manifest: { application: [{ $: {} }] } },
  });
  return (out?.modResults as { manifest: { application: { $: Record<string, string> }[] } }).manifest.application[0]?.$;
}

describe('the network security config (config plugin)', () => {
  it('the release build: the system’s authorities only, and no plain http', async () => {
    const xml = await written('release');
    expect(xml).toMatchSnapshot();
    expect(xml).toContain('cleartextTrafficPermitted="false"');
    expect(xml).not.toContain('<certificates src="user"/>');
    expect((await manifest('release'))?.['android:usesCleartextTraffic']).toBe('false');
  });

  it('a build that names no test variant is a release', async () => {
    expect(await written(undefined)).toBe(await written('release'));
    expect(await written('something')).toBe(await written('release'));
  });

  it.each(['dev', 'preview', 'e2e'])('the %s build keeps plain http and certificates installed by hand', async (v) => {
    const xml = await written(v);
    expect(xml).toMatchSnapshot();
    expect(xml).toContain('cleartextTrafficPermitted="true"');
    expect(xml).toContain('<certificates src="user"/>');
    expect((await manifest(v))?.['android:usesCleartextTraffic']).toBe('true');
  });

  it('tells the app what it trusts: certificates installed by hand in the test builds only', () => {
    const extra = (v: string) => (configFor(v) as unknown as { extra: { userCertificates: boolean } }).extra.userCertificates;
    expect(extra('release')).toBe(false);
    expect(extra('preview')).toBe(true);
  });

  it('points the manifest at it', async () => {
    expect((await manifest('release'))?.['android:networkSecurityConfig']).toBe('@xml/network_security_config');
    expect((await manifest('dev'))?.['android:networkSecurityConfig']).toBe('@xml/network_security_config');
  });
});
