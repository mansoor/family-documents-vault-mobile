// @fdv/client/testing's contract scenarios import `expect` from Vitest; the
// app's tests run on Jest, whose `expect` speaks the same language.
export const expect = (globalThis as unknown as { expect: jest.Expect }).expect;
