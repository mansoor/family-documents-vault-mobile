// Nothing the app keeps leaves the phone by backup: not to the cloud and
// not to a new phone by device transfer. The offline Essentials and the
// capture queue are encrypted under keys that cannot move either; restoring
// them elsewhere would be useless at best.
const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const DOMAINS = ['root', 'file', 'database', 'sharedpref', 'external'];
const exclude = DOMAINS.map((d) => `    <exclude domain="${d}" path="."/>`).join('\n');
const XML = `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
  <cloud-backup>
${exclude}
  </cloud-backup>
  <device-transfer>
${exclude}
  </device-transfer>
</data-extraction-rules>
`;

module.exports = function withDataExtraction(config) {
  config = withDangerousMod(config, [
    'android',
    async (c) => {
      const dir = path.join(c.modRequest.platformProjectRoot, 'app/src/main/res/xml');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'data_extraction_rules.xml'), XML);
      return c;
    },
  ]);
  return withAndroidManifest(config, (c) => {
    const app = c.modResults.manifest.application?.[0];
    if (app) {
      app.$['android:dataExtractionRules'] = '@xml/data_extraction_rules';
      app.$['android:allowBackup'] = 'false';
      delete app.$['android:fullBackupContent'];
    }
    return c;
  });
};
