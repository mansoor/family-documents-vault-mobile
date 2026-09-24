// Types for the Vitest shim (see vitest-shim.ts and jest.config.js).
declare module 'vitest' {
  export const expect: jest.Expect;
}
