// Every way the app can fail, and what it says then (4.17): an inventory
// written from the catalogue itself (src/i18n/en-GB.json), so the words in
// it are the words on the screen. Written to docs/failure-states.md.
//
//   node scripts/failure-states.mjs          write it
//   node scripts/failure-states.mjs --check  exit 1 if it is out of date
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = fileURLToPath(new URL('..', import.meta.url));
const target = join(app, '..', '..', 'docs', 'failure-states.md');
const words = JSON.parse(readFileSync(join(app, 'src', 'i18n', 'en-GB.json'), 'utf8'));

/** Situations, where they are met, and the catalogue keys that answer them. */
const AREAS = [
  [
    'Reaching the vault',
    'Connect',
    'connect',
    'invalid notAVault unreachable setupRequired serverTooOld clientTooOld apiVersion askHttp refusePublicHttp refuseMobileData stranger reinstalled certificateUntrusted certificateWrongName certificateExpired captivePortal linkJoin linkReset linkShared',
  ],
  ['Signing in', 'Sign in', 'signIn', 'signedOutHere passkeyOnly'],
  [
    'Any request that fails (wordsFor)',
    'Every screen',
    'errors',
    'offline timeout rateLimited unavailable internal storageUnreachable sessionEnded stepUp setupRequired unexpected stranger wifiOnly invalidCredentials notFound previewPending noPreview uploadInProgress general',
  ],
  ['The lock', 'Lock screen, Settings', 'lock', 'tooMany noScreenLock weakBiometrics enrolmentChanged'],
  [
    'Scanning and filing',
    'Capture, the card',
    'capture',
    'pageLimit tooBig noSpace unreadable signedOut offlineSkip queueUnavailable notAllowed',
  ],
  [
    'Scans on their way',
    'Home, the queue',
    'queue',
    'busy notYet tooBigForVault wrongKind refused needsYou storage noLongerAdd ownerGone versionRefused',
  ],
  ['The scanner', 'Home', 'home', 'scannerFailed savedOffline offline'],
  [
    'Essentials kept for no signal',
    'Home, a kept Essential, Sign in',
    'essentials',
    'wrongPassword noConnection failed connectBy renew signInToSync removedAge removedSignedOut shortOfSpace offlineBanner notKept noPreview pending privateChanged privateUnavailable',
  ],
  ['Show mode', 'Show', 'show', 'notKept pending noPreview'],
  ['Confirm it is you', 'The step-up sheet', 'stepUp', 'failed'],
  [
    'A document',
    'Document',
    'document',
    'conflict needsConnection notFound notConfirmed saveWarning saveFailed pageFailed pending noPreview failed',
  ],
  ['Search, Needs attention, People', 'Tabs', 'search', 'needsConnection sealedNone'],
  ['', '', 'attention', 'needsConnection failed'],
  ['', '', 'people', 'needsConnection'],
  [
    'Notifications',
    'Settings → Notifications',
    'push',
    'iphone oldVault noDistributor permissionOff failed failedNetwork failedAction failedOther unreachable',
  ],
  [
    'Settings',
    'Settings',
    'settings',
    'notSecure changeVaultWords changeVaultWaiting onItsWay devicesUnreachable offlineNone offlineRemoveWords',
  ],
];

/** Words in those sections that are not failures (titles, buttons). */
const IGNORED = new Set([
  'push.title',
  'push.openSettings',
  'push.offHint',
  'push.turnOn',
  'push.choose',
  'push.waiting',
  'push.on',
  'push.onThrough',
  'push.daily',
  'push.dailyHint',
  'push.sendTest',
  'push.testSent',
  'push.turnOff',
  'push.tryAgain',
]);

const said = (section, key) => {
  const s = words[section] ?? {};
  if (typeof s[key] === 'string') return s[key];
  const forms = ['one', 'other'].map((f) => s[`${key}_${f}`]).filter(Boolean);
  if (forms.length) return forms.join(' / ');
  throw new Error(`${section}.${key} is not in the catalogue`);
};

// Every word in the catalogue's failure sections is in the inventory: a new one fails CI until it is.
for (const section of ['errors', 'push']) {
  const listed = new Set(AREAS.filter(([, , s]) => s === section).flatMap(([, , , keys]) => keys.split(' ')));
  const missing = Object.keys(words[section] ?? {})
    .map((k) => k.replace(/_(one|other)$/, ''))
    .filter((k) => !listed.has(k) && !IGNORED.has(`${section}.${k}`));
  if (missing.length) {
    console.error(
      `not in the failure-state inventory: ${[...new Set(missing)].map((k) => `${section}.${k}`).join(', ')}`,
    );
    process.exit(1);
  }
}

const lines = [
  '# Failure states',
  '',
  'Every way the app can fail that the person sees, where they meet it, and',
  'the words it uses — taken from the catalogue (`apps/pocket/src/i18n/en-GB.json`),',
  'so they are the words on the screen. Anything the vault refuses with a',
  "reason of its own is shown in the vault's words, verbatim (`errors/words.ts`).",
  '',
  'Written by `node apps/pocket/scripts/failure-states.mjs`; CI fails if it is out of date.',
  '',
  '| Situation | Where | Key | Words |',
  '| --- | --- | --- | --- |',
];
for (const [situation, where, section, keys] of AREAS) {
  let first = true;
  for (const key of keys.split(' ')) {
    const text = said(section, key).replace(/\|/g, '\\|');
    lines.push(`| ${first ? situation : ''} | ${first ? where : ''} | \`${section}.${key}\` | ${text} |`);
    first = false;
  }
}
const text = `${lines.join('\n')}\n`;

if (process.argv.includes('--check')) {
  const now = existsSync(target) ? readFileSync(target, 'utf8') : '';
  if (now !== text) {
    console.error('docs/failure-states.md is out of date: run node apps/pocket/scripts/failure-states.mjs');
    process.exit(1);
  }
  console.log('failure-states.md is current');
} else {
  writeFileSync(target, text);
  console.log('wrote docs/failure-states.md');
}
