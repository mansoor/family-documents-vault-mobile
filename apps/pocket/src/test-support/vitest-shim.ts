// @fdv/client/testing's contract scenarios import `expect` from Vitest; the
// app's tests run on Jest, whose `expect` speaks the same language — except
// that Vitest's takes a message after the value, and Jest's refuses one.
const jestExpect = (globalThis as unknown as { expect: jest.Expect }).expect;
export const expect = Object.assign(<T>(actual: T, _message?: string) => jestExpect(actual), jestExpect);
