// What the operating system lets the app reach, by build (app.config.ts's
// extra.variant).
//
// The release build, the one families install, never sends anything over
// plain http: nothing inside the app can fall back to cleartext. Whether it
// also trusts a certificate installed on the phone by hand is one switch,
// RELEASE_USER_CERTIFICATES, below: on for now, so a vault that makes its
// own certificate still works; strict (the system's authorities alone, so a
// certificate somebody was talked into installing cannot read what goes to
// the vault) before the app goes live.
//
// The test builds (dev, preview, e2e) talk to throwaway vaults on a laptop
// or in the emulator over plain http (and the dev build to Metro), and to
// vaults whose certificate was installed by hand, so they keep what they
// had: cleartext permitted (the app's own policy still decides per host,
// net/policy.ts: plain http only to an approved vault at home) and
// user-installed authorities trusted. A build with no variant is a release.
const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * THE SWITCH: whether the release build also trusts a certificate installed
 * on the phone by hand (a self-hosted vault's own `vault-ca.crt`). true (the
 * owner's choice, 22 Nov 2026): the system's authorities and those; false:
 * the system's alone. Flipping it is this one line: the file below and what
 * the app says on Connect (config.ts reads `extra.userCertificates`) follow
 * it. Plain http stays off in the release build either way.
 */
const RELEASE_USER_CERTIFICATES = true; // To be switched to strict (false) before the app goes live.

const USER_ANCHOR = `
      <certificates src="user"/>`;

const RELEASE_XML = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false">
    <trust-anchors>
      <certificates src="system"/>${RELEASE_USER_CERTIFICATES ? USER_ANCHOR : ''}
    </trust-anchors>
  </base-config>
</network-security-config>
`;

const TEST_XML = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="true">
    <trust-anchors>
      <certificates src="system"/>
      <certificates src="user"/>
    </trust-anchors>
  </base-config>
</network-security-config>
`;

const TEST_BUILDS = ['dev', 'preview', 'e2e'];

/** Whether a build is one of the test builds, which may reach a laptop's vault over plain http. */
function testBuild(variant) {
  return TEST_BUILDS.includes(variant);
}

module.exports = function withNetworkSecurity(config) {
  const test = testBuild(config.extra?.variant);
  // What the app tells people about certificates installed by hand follows the file.
  config.extra = { ...config.extra, userCertificates: test || RELEASE_USER_CERTIFICATES };
  config = withDangerousMod(config, [
    'android',
    async (c) => {
      const dir = path.join(c.modRequest.platformProjectRoot, 'app/src/main/res/xml');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'network_security_config.xml'), test ? TEST_XML : RELEASE_XML);
      return c;
    },
  ]);
  return withAndroidManifest(config, (c) => {
    const app = c.modResults.manifest.application?.[0];
    if (app) {
      app.$['android:networkSecurityConfig'] = '@xml/network_security_config';
      // Said in the manifest too, for anything that reads only the manifest.
      app.$['android:usesCleartextTraffic'] = test ? 'true' : 'false';
    }
    return c;
  });
};
