import { File, Paths } from 'expo-file-system';
import type { TimelineExport } from './timeline';

/**
 * The last scan's timeline, kept on the phone so that a cold start in
 * airplane mode (probe P11) has something to show. Timings and hashes
 * only: nothing from the page.
 */
export interface LastRun {
  at: string;
  timeline: TimelineExport;
  pdfSha256: string | null;
  results: { variant: 'file' | 'bytes'; status: number }[];
}

const file = () => new File(Paths.document, 'spike-last-run.json');

export function saveLastRun(run: LastRun): void {
  const f = file();
  if (f.exists) f.delete();
  f.create();
  f.write(JSON.stringify(run));
}

export function loadLastRun(): LastRun | null {
  const f = file();
  if (!f.exists) return null;
  try {
    return JSON.parse(f.textSync()) as LastRun;
  } catch {
    return null;
  }
}
