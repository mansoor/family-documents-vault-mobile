/**
 * A multipart/form-data body with one file part, built by hand as bytes.
 *
 * The spike tries two ways of uploading a scan: React Native's FormData
 * pointing at a file on disk, and this — the bytes in memory, sent through
 * expo/fetch. Whichever proves reliable on the phone is what the capture
 * queue uses from 4.4.
 */
export interface MultipartBody {
  body: Uint8Array<ArrayBuffer>;
  contentType: string;
}

export function multipartFile(
  field: string,
  filename: string,
  mime: string,
  bytes: Uint8Array,
  boundary = `fdv-${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`,
): MultipartBody {
  const encoder = new TextEncoder();
  const safe = (s: string) => s.replace(/["\r\n]/g, '_');
  const head = encoder.encode(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${safe(field)}"; filename="${safe(filename)}"\r\n` +
      `Content-Type: ${mime}\r\n\r\n`,
  );
  const tail = encoder.encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(head.length + bytes.length + tail.length);
  body.set(head, 0);
  body.set(bytes, head.length);
  body.set(tail, head.length + bytes.length);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}
