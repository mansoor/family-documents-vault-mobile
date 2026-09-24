/**
 * A JPEG's width and height in pixels, from its frame header — the scanner
 * hands back files, not sizes, and the PDF lays each page out from them.
 */
export function jpegSize(jpeg: Uint8Array): { widthPx: number; heightPx: number } {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('not a JPEG');
  let i = 2;
  while (i + 9 < jpeg.length) {
    if (jpeg[i] !== 0xff) throw new Error(`corrupt JPEG at byte ${i}`);
    const marker = jpeg[i + 1] ?? 0;
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    // Start-of-frame markers: C0–CF, except C4 (Huffman), C8 (reserved) and CC (arithmetic).
    const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isFrame) {
      const heightPx = ((jpeg[i + 5] ?? 0) << 8) | (jpeg[i + 6] ?? 0);
      const widthPx = ((jpeg[i + 7] ?? 0) << 8) | (jpeg[i + 8] ?? 0);
      if (widthPx === 0 || heightPx === 0) throw new Error('JPEG has no size');
      return { widthPx, heightPx };
    }
    if (marker === 0xda) break; // image data, and no frame header before it
    i += 2 + (((jpeg[i + 2] ?? 0) << 8) | (jpeg[i + 3] ?? 0));
  }
  throw new Error('JPEG has no frame header');
}
