import { pickFile, pickPhoto } from './pickers';
import type { ScannerPort } from './scanner';

/** The web build has no scanner: files and photos only. */
export const mlkitScanner: ScannerPort = {
  scans: false,
  scan: async () => ({ kind: 'failed' }),
  pickFile,
  pickPhoto,
};
