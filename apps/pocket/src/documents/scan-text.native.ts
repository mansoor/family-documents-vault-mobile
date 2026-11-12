import TextRecognition from '@react-native-ml-kit/text-recognition';
import {
  ResponseType,
  scanDocument,
  ScanDocumentResponseStatus,
} from '@preeternal/react-native-document-scanner-plugin';

/**
 * Scan text into a note, on the phone (the owner's ask of 12 Nov 2026): a
 * page through ML Kit's document scanner (its edges found, flattened), then
 * ML Kit's on-device text recognition — the words read on the phone itself,
 * never sent anywhere — and put where the cursor is in the note. The scan
 * is not kept: only the words, in the note being written.
 *
 * (Its own types here: a .native.ts never imports its web twin, which on
 * the phone would be itself.)
 */

export type ScannedText = { kind: 'text'; text: string } | { kind: 'nothing' } | { kind: 'cancelled' } | { kind: 'failed' };

export const textScanOffered = (): boolean => true;

export async function scanTextOnPhone(): Promise<ScannedText> {
  let uri: string | undefined;
  try {
    const r = await scanDocument({
      maxNumDocuments: 1,
      croppedImageQuality: 90,
      responseType: ResponseType.ImageFilePath,
      scannerMode: 'full',
    });
    if (r.status !== ScanDocumentResponseStatus.Success || r.scannedImages.length === 0) return { kind: 'cancelled' };
    uri = r.scannedImages[0];
  } catch (err) {
    if ((err as { code?: string } | null)?.code === 'scan_in_progress') return { kind: 'cancelled' };
    return { kind: 'failed' };
  }
  if (!uri) return { kind: 'cancelled' };
  try {
    const read = await TextRecognition.recognize(uri.startsWith('file://') || uri.startsWith('content://') ? uri : `file://${uri}`);
    const text = read.text.trim();
    return text ? { kind: 'text', text } : { kind: 'nothing' };
  } catch {
    return { kind: 'failed' };
  }
}
