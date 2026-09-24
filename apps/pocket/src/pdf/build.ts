import { PDFDocument } from 'pdf-lib';

/** A scanned page: the scanner's JPEG and its size in pixels. */
export interface JpegPage {
  bytes: Uint8Array;
  widthPx: number;
  heightPx: number;
}

/**
 * Pages are laid out as if scanned at 200 dpi, so a PDF viewer shows an A4
 * letter at about A4 and a card at about card size. The pixels themselves
 * are untouched.
 */
export const DPI = 200;

const SOI = 0xd8;
const SOS = 0xda;
const APP1 = 0xe1;

/**
 * Removes the APP1 segments — EXIF and XMP, which carry where and when a
 * photo was taken and on what phone — and nothing else: every other byte
 * of the JPEG is kept as it was.
 */
export function stripApp1(jpeg: Uint8Array): Uint8Array {
  if (jpeg[0] !== 0xff || jpeg[1] !== SOI) throw new Error('not a JPEG');
  const kept: Uint8Array[] = [jpeg.subarray(0, 2)];
  let i = 2;
  while (i < jpeg.length) {
    if (jpeg[i] !== 0xff) throw new Error(`corrupt JPEG at byte ${i}`);
    const marker = jpeg[i + 1];
    if (marker === undefined) throw new Error('JPEG ends inside a marker');
    if (marker === 0xff) {
      // Fill byte before a marker: keep it, move on.
      kept.push(jpeg.subarray(i, i + 1));
      i += 1;
      continue;
    }
    if (marker === SOS) {
      // The start of the image data: everything from here on is kept.
      kept.push(jpeg.subarray(i));
      break;
    }
    const hi = jpeg[i + 2];
    const lo = jpeg[i + 3];
    if (hi === undefined || lo === undefined) throw new Error('JPEG ends inside a segment');
    const end = i + 2 + ((hi << 8) | lo);
    if (end > jpeg.length) throw new Error('JPEG segment runs past the end');
    if (marker !== APP1) kept.push(jpeg.subarray(i, end));
    i = end;
  }
  const out = new Uint8Array(kept.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of kept) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * One PDF from the scanned pages, one page each, the JPEGs embedded as they
 * are (no re-encoding, so nothing is lost), with no metadata of its own.
 */
export async function buildPdf(pages: JpegPage[]): Promise<Uint8Array<ArrayBuffer>> {
  if (pages.length === 0) throw new Error('a PDF needs at least one page');
  const pdf = await PDFDocument.create({ updateMetadata: false });
  for (const page of pages) {
    const image = await pdf.embedJpg(stripApp1(page.bytes));
    const width = (page.widthPx * 72) / DPI;
    const height = (page.heightPx * 72) / DPI;
    pdf.addPage([width, height]).drawImage(image, { x: 0, y: 0, width, height });
  }
  // A plain ArrayBuffer underneath, as hashing and fetch bodies want.
  return new Uint8Array(await pdf.save({ useObjectStreams: false }));
}
