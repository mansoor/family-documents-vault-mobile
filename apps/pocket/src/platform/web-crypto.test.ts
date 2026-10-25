import { multipartBody } from '@fdv/client';
import { installWebCrypto } from './web-crypto';

describe('Web Crypto for the shared client', () => {
  it('gives a platform with no crypto a getRandomValues that fills the array', () => {
    const target: { crypto?: unknown } = {};
    installWebCrypto(target);
    const bytes = (target.crypto as { getRandomValues(a: Uint8Array): Uint8Array }).getRandomValues(new Uint8Array(32));
    expect(bytes.some((b) => b !== 0)).toBe(true);
  });

  it("leaves a platform's own crypto alone", () => {
    const own = { getRandomValues: jest.fn(), subtle: {} };
    const target: { crypto?: unknown } = { crypto: own };
    installWebCrypto(target);
    expect(target.crypto).toBe(own);
  });

  it('lets an upload body be made where there was no crypto, as on Hermes', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true, writable: true });
    try {
      const file = { name: 'file', filename: 'scan.jpg', contentType: 'image/jpeg', bytes: new Uint8Array([1, 2, 3]) };
      // What every scan's upload met on the phone before (0.3.2).
      expect(() => multipartBody([file])).toThrow();
      installWebCrypto();
      expect(multipartBody([file]).contentType).toMatch(/^multipart\/form-data; boundary=fdv-[0-9a-f]{36}$/);
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
    }
  });
});
