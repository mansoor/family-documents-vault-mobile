// What the app is made of, for Settings → About (4.15): every package it
// depends on at run time, with its licence, as pnpm reports them, and the
// native libraries the app adds itself (which pnpm does not see). Written
// to src/about/licences.json; CI writes it again and fails if it changed,
// so the list in a build is the list of that build.
//
//   node scripts/licences.mjs          write it
//   node scripts/licences.mjs --check  exit 1 if it is out of date
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = fileURLToPath(new URL('..', import.meta.url));
const target = join(app, 'src', 'about', 'licences.json');

/** Native code the app's own modules bring in (modules/unifiedpush). */
const NATIVE = [
  { name: 'org.unifiedpush.android:connector', versions: ['3.3.5'], licence: 'Apache-2.0' },
  { name: 'com.google.crypto.tink:tink', versions: ['1.23.0'], licence: 'Apache-2.0' },
];

const raw = execFileSync('pnpm', ['licenses', 'list', '--prod', '--json'], {
  cwd: app,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
  shell: process.platform === 'win32',
});
const byLicence = JSON.parse(raw);
const items = [];
for (const [licence, packages] of Object.entries(byLicence)) {
  for (const p of packages) {
    // A package for one platform only (a Windows or a Linux build of a tool)
    // is not part of the app, and would make the list differ by machine.
    const manifest = p.paths?.[0] ? join(p.paths[0], 'package.json') : null;
    if (manifest && existsSync(manifest)) {
      const m = JSON.parse(readFileSync(manifest, 'utf8'));
      if (m.os || m.cpu) continue;
    }
    items.push({ name: p.name, versions: [...p.versions].sort(), licence: p.license || licence });
  }
}
items.push(...NATIVE);
items.sort((a, b) => a.name.localeCompare(b.name, 'en'));
// One package a line: small in the app, and a change reads as one line.
const text = `[\n${items.map((i) => JSON.stringify(i)).join(',\n')}\n]\n`;

if (process.argv.includes('--check')) {
  const now = existsSync(target) ? readFileSync(target, 'utf8') : '';
  if (now !== text) {
    console.error('src/about/licences.json is out of date: run node scripts/licences.mjs');
    process.exit(1);
  }
  console.log(`licences.json is current (${items.length} packages)`);
} else {
  writeFileSync(target, text);
  console.log(`wrote ${items.length} packages to src/about/licences.json`);
}
