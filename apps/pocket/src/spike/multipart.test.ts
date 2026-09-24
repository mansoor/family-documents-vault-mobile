import { multipartFile } from './multipart';

// Expo's TextDecoder speaks UTF-8 only; one character per byte instead.
const bytesAsText = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join('');

describe('multipartFile', () => {
  it('wraps the bytes, untouched, in one file part', () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x0d, 0x0a]);
    const { body, contentType } = multipartFile('file', 'scan.pdf', 'application/pdf', bytes, 'XYZ');
    expect(contentType).toBe('multipart/form-data; boundary=XYZ');
    const text = bytesAsText(body);
    expect(text.startsWith('--XYZ\r\n')).toBe(true);
    expect(text).toContain('Content-Disposition: form-data; name="file"; filename="scan.pdf"\r\n');
    expect(text).toContain('Content-Type: application/pdf\r\n\r\n');
    expect(text.endsWith('\r\n--XYZ--\r\n')).toBe(true);
    const start = text.indexOf('\r\n\r\n') + 4;
    expect(body.subarray(start, start + bytes.length)).toEqual(bytes);
  });

  it('a quote or a line break in a name cannot break out of its header', () => {
    const { body } = multipartFile('file', 'a"b\r\nc.pdf', 'application/pdf', new Uint8Array(), 'B');
    expect(new TextDecoder().decode(body)).toContain('filename="a_b__c.pdf"');
  });
});
