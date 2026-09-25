import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The config plugin as prebuild runs it (4.15): the file it writes, and the
// manifest pointing at it. Cleartext is the app's own decision per host
// (plain http only to an approved vault at home); user CAs are trusted so a
// vault that makes its own certificate can be trusted once, by installing it.
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

describe('the network security config (config plugin)', () => {
  it('writes network_security_config.xml as it was reviewed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fv-nsc-'));
    const config = withNetworkSecurity({ name: 'FV', slug: 'fv' });
    await config.mods.android.dangerous?.({ modRequest: request(root, 'dangerous'), modResults: {} });
    const xml = readFileSync(
      join(root, 'android', 'app', 'src', 'main', 'res', 'xml', 'network_security_config.xml'),
      'utf8',
    );
    expect(xml).toMatchSnapshot();
    expect(xml).toContain('<certificates src="user"/>');
  });

  it('points the manifest at it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fv-nsc-'));
    const config = withNetworkSecurity({ name: 'FV', slug: 'fv' });
    const out = await config.mods.android.manifest?.({
      modRequest: request(root, 'manifest'),
      modResults: { manifest: { application: [{ $: {} }] } },
    });
    const app = (out?.modResults as { manifest: { application: { $: Record<string, string> }[] } }).manifest
      .application[0];
    expect(app?.$['android:networkSecurityConfig']).toBe('@xml/network_security_config');
  });
});
