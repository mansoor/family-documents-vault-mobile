// Writes src/probes/node-snapshots.json: @fdv/shared's helpers run under
// Node, the answers the phone (probe P1) and the tests compare against.
//   pnpm exec tsx scripts/gen-shared-snapshots.mts
process.env.TZ = 'UTC';

const { writeFileSync } = await import('node:fs');
const { join } = await import('node:path');
const shared = await import('@fdv/shared');
const { sharedCases } = await import('../src/probes/shared-cases');

const out = join(import.meta.dirname, '..', 'src', 'probes', 'node-snapshots.json');
writeFileSync(out, `${JSON.stringify(sharedCases(shared), null, 2)}\n`);
console.log(`wrote ${out}`);
