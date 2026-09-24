// The operating system permits cleartext and trusts the system's and the
// user's certificate authorities; the app's own policy decides per host
// (iteration 4.2): plain http only to a vault on the home network, and only
// after the person has said yes to it.
const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const XML = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="true">
    <trust-anchors>
      <certificates src="system"/>
      <certificates src="user"/>
    </trust-anchors>
  </base-config>
</network-security-config>
`;

module.exports = function withNetworkSecurity(config) {
  config = withDangerousMod(config, [
    'android',
    async (c) => {
      const dir = path.join(c.modRequest.platformProjectRoot, 'app/src/main/res/xml');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'network_security_config.xml'), XML);
      return c;
    },
  ]);
  return withAndroidManifest(config, (c) => {
    const app = c.modResults.manifest.application?.[0];
    if (app) app.$['android:networkSecurityConfig'] = '@xml/network_security_config';
    return c;
  });
};
