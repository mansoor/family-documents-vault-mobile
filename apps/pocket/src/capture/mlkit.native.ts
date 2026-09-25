import {
  ResponseType,
  scanDocument,
  ScanDocumentResponseStatus,
} from '@preeternal/react-native-document-scanner-plugin';
import { pickFile, pickPhoto } from './pickers';
import type { ScannerPort } from './scanner';

/** ML Kit's document scanner, on the phone: edges found, pages flattened. */
export const mlkitScanner: ScannerPort = {
  scans: true,
  async scan(maxPages) {
    try {
      const r = await scanDocument({
        maxNumDocuments: maxPages,
        croppedImageQuality: 80,
        responseType: ResponseType.ImageFilePath,
        scannerMode: 'full',
      });
      if (r.status !== ScanDocumentResponseStatus.Success || r.scannedImages.length === 0) return { kind: 'cancelled' };
      return { kind: 'pages', pages: r.scannedImages.map((uri) => ({ uri })) };
    } catch (err) {
      // Already open (a second tap while it starts): not a failure.
      if ((err as { code?: string } | null)?.code === 'scan_in_progress') return { kind: 'cancelled' };
      // No Google Play services, or the scanner could not be set up (its
      // first use downloads it): Home offers the pickers instead.
      return { kind: 'failed' };
    }
  },
  pickFile,
  pickPhoto,
};
