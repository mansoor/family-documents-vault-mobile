import { readFileSync } from 'fs';
import { join } from 'path';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { buildPdf, DPI, stripApp1, type JpegPage } from './build';

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, '__fixtures__', name)));
const letter: JpegPage = { bytes: fixture('letter-with-exif.jpg'), widthPx: 400, heightPx: 566 };
const card: JpegPage = { bytes: fixture('card.jpg'), widthPx: 300, heightPx: 190 };

const ascii = (bytes: Uint8Array) => String.fromCharCode(...bytes);

/** Where each segment before the image data starts and ends, by marker. */
function segments(jpeg: Uint8Array): { marker: number; start: number; end: number }[] {
  const found = [];
  let i = 2;
  while (i < jpeg.length && jpeg[i + 1] !== 0xda) {
    const end = i + 2 + (((jpeg[i + 2] ?? 0) << 8) | (jpeg[i + 3] ?? 0));
    found.push({ marker: jpeg[i + 1] ?? 0, start: i, end });
    i = end;
  }
  return found;
}

async function imageStreams(pdf: Uint8Array): Promise<Uint8Array[]> {
  const doc = await PDFDocument.load(pdf);
  return doc.context
    .enumerateIndirectObjects()
    .map(([, object]) => object)
    .filter(
      (o): o is PDFRawStream =>
        o instanceof PDFRawStream && o.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'),
    )
    .map((s) => s.contents);
}

describe('stripApp1', () => {
  it('the EXIF APP1 segment is removed and nothing else', () => {
    const app1 = segments(letter.bytes).filter((s) => s.marker === 0xe1);
    expect(app1).toHaveLength(1);
    const seg = app1[0];
    if (!seg) throw new Error('no APP1 segment in the fixture');
    const expected = new Uint8Array([
      ...letter.bytes.subarray(0, seg.start),
      ...letter.bytes.subarray(seg.end),
    ]);
    const stripped = stripApp1(letter.bytes);
    expect(stripped).toEqual(expected);
    expect(ascii(stripped)).not.toContain('Synthetic Phone Co');
  });

  it('a JPEG without EXIF comes back byte for byte', () => {
    expect(stripApp1(card.bytes)).toEqual(card.bytes);
  });

  it('refuses something that is not a JPEG', () => {
    expect(() => stripApp1(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toThrow('not a JPEG');
  });
});

describe('buildPdf', () => {
  it('two JPEG pages become one two-page PDF whose image streams are the input JPEGs byte for byte, EXIF removed', async () => {
    const pdf = await buildPdf([letter, card]);
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBe(2);
    expect(await imageStreams(pdf)).toEqual([stripApp1(letter.bytes), card.bytes]);
    expect(ascii(pdf)).not.toContain('Synthetic Phone Co');
    // No producer, creator or dates of its own.
    expect(ascii(pdf)).not.toMatch(/\/Producer|\/CreationDate|\/ModDate|\/Creator/);
  });

  it('page size follows the pixels at 200 dpi', async () => {
    const doc = await PDFDocument.load(await buildPdf([letter, card]));
    const sizes = doc.getPages().map((p) => p.getSize());
    expect(sizes[0]?.width).toBeCloseTo((400 * 72) / DPI, 5);
    expect(sizes[0]?.height).toBeCloseTo((566 * 72) / DPI, 5);
    expect(sizes[1]?.width).toBeCloseTo((300 * 72) / DPI, 5);
    expect(sizes[1]?.height).toBeCloseTo((190 * 72) / DPI, 5);
  });

  it('refuses to build a PDF with no pages', async () => {
    await expect(buildPdf([])).rejects.toThrow('at least one page');
  });
});
