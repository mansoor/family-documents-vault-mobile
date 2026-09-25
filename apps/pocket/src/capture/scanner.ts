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

/** ML Kit on the phone (mlkit.native.ts); the pickers alone on the web (mlkit.ts). */
export function defaultScanner(): ScannerPort {
  return mlkitScanner;
}
