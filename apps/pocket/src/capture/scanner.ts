import { File, Paths } from 'expo-file-system';
import { extra } from '../config';
import { FIXTURE_PAGE_BASE64 } from './fixture-page';
import { mlkitScanner } from './mlkit';
import type { PageRef, PickedFile } from '../queue/commit';

/**
 * Where a capture comes from, behind one seam:
 *
 * - ML Kit's document scanner on the phone: edges found, pages flattened,
 *   several pages in one go.
 * - The pickers: a PDF, a photo, a Word or Excel file already on the phone.
 *   The only way in on the web build, and on a phone whose scanner cannot
 *   start (no Google Play services).
 * - Fixtures, for the tests and the e2e build.
 */
export type ScanOutcome =
  { kind: 'pages'; pages: PageRef[] } | { kind: 'file'; file: PickedFile } | { kind: 'cancelled' } | { kind: 'failed' };

export interface ScannerPort {
  /** Whether this one can scan pages with the camera; otherwise files only. */
  readonly scans: boolean;
  scan(maxPages: number): Promise<ScanOutcome>;
  pickFile(): Promise<ScanOutcome>;
  pickPhoto(): Promise<ScanOutcome>;
}

/** Pages and files made up by a test (or the e2e build), handed over in order. */
export function fixtureScanner(outcomes: ScanOutcome[], scans = true): ScannerPort & { asked: string[] } {
  const asked: string[] = [];
  const next = (what: string) => {
    asked.push(what);
    return Promise.resolve(outcomes.shift() ?? { kind: 'cancelled' as const });
  };
  return {
    scans,
    asked,
    scan: (maxPages) => next(`scan:${maxPages}`),
    pickFile: () => next('file'),
    pickPhoto: () => next('photo'),
  };
}

/**
 * The e2e build's scanner (4.5): two pages of the fixture card, written
 * where a real scanner leaves its pages, so everything after the scan — the
 * card, the PDF, the queue, the deletion — is the real thing.
 */
export function e2eScanner(): ScannerPort {
  let n = 0;
  const bytes = Uint8Array.from(atob(FIXTURE_PAGE_BASE64), (c) => c.charCodeAt(0));
  const page = (): PageRef => {
    n += 1;
    const f = new File(Paths.cache, `fixture-page-${Date.now()}-${n}.jpg`);
    f.create();
    f.write(bytes);
    return { uri: f.uri };
  };
  return {
    scans: true,
    scan: async (max) => ({ kind: 'pages', pages: Array.from({ length: Math.min(2, max) }, page) }),
    pickFile: async () => ({ kind: 'cancelled' }),
    pickPhoto: async () => ({ kind: 'cancelled' }),
  };
}

/** ML Kit on the phone (mlkit.native.ts); the pickers alone on the web (mlkit.ts); fixtures in the e2e build. */
export function defaultScanner(): ScannerPort {
  return extra.fixtures ? e2eScanner() : mlkitScanner;
}
