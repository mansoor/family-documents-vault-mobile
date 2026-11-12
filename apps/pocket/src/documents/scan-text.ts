/**
 * Scan text into a note (the owner's ask of 12 Nov 2026) needs the phone's
 * own text recognition: none on the web build, so it is not offered there.
 * The phone's is scan-text.native.ts.
 */

export type ScannedText = { kind: 'text'; text: string } | { kind: 'nothing' } | { kind: 'cancelled' } | { kind: 'failed' };

export const textScanOffered = (): boolean => false;

export async function scanTextOnPhone(): Promise<ScannedText> {
  return { kind: 'failed' };
}
