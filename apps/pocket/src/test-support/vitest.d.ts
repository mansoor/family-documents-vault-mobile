// Types for the Vitest shim (see vitest-shim.ts and jest.config.js).
declare module 'vitest' {
  /** Jest's expect, taking Vitest's message after the value too (the 0.5.11 contract scenarios pass one). */
  interface ShimExpect extends jest.Expect {
    <T = unknown>(actual: T, message?: string): jest.JestMatchers<T>;
  }
  export const expect: ShimExpect;
}
