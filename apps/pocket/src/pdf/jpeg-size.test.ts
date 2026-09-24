import { readFileSync } from 'fs';
import { join } from 'path';
import { jpegSize } from './jpeg-size';

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, '__fixtures__', name)));

describe('jpegSize', () => {
  it('reads the size from the frame header, past an EXIF segment', () => {
    expect(jpegSize(fixture('letter-with-exif.jpg'))).toEqual({ widthPx: 400, heightPx: 566 });
    expect(jpegSize(fixture('card.jpg'))).toEqual({ widthPx: 300, heightPx: 190 });
  });

  it('refuses something that is not a JPEG, or has no frame', () => {
    expect(() => jpegSize(new Uint8Array([1, 2, 3]))).toThrow('not a JPEG');
    expect(() => jpegSize(new Uint8Array([0xff, 0xd8, 0xff, 0xd9, 0, 0, 0, 0, 0, 0, 0]))).toThrow();
  });
});
