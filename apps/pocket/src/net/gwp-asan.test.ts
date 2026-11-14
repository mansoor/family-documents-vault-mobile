import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The config plugin as prebuild runs it: the app says no to GWP-ASan's
// sampling, whose stack walk crashed Hermes at a cold start (13 Nov 2026).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const withGwpAsan = require('../../plugins/with-gwp-asan.js') as (c: object) => {
  mods: { android: Record<string, (p: object) => Promise<{ modResults: unknown }>> };
};

describe('GWP-ASan (config plugin)', () => {
  it('is never sampled in the app', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fv-gwp-'));
    const config = withGwpAsan({ name: 'FV', slug: 'fv' });
    const out = await config.mods.android.manifest?.({
      modRequest: {
        platform: 'android',
        modName: 'manifest',
        projectRoot: root,
        platformProjectRoot: join(root, 'android'),
        introspect: false,
        ignoreExistingNativeFiles: false,
      },
      modResults: { manifest: { application: [{ $: {} }] } },
    });
    const app = (out?.modResults as { manifest: { application: { $: Record<string, string> }[] } }).manifest
      .application[0];
    expect(app?.$['android:gwpAsanMode']).toBe('never');
  });
});
