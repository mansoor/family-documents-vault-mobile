import { ApiRequestError, NetworkError } from '@fdv/client';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import i18n from '../i18n';
import { CATALOGUE, wordsFor } from './words';

const t = i18n.t.bind(i18n);

/** The app's and its client's own code: not tests, not test support. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'test-support' || e.name === 'testing' || e.name === 'node_modules') continue;
      out.push(...sources(full));
    } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** A comparison against an error code: `code === 'x'`, `err.code !== "y"`. */
const COMPARED = /\bcode\s*[!=]==?\s*['"]([a-z_]+)['"]/g;

describe('every failure in words (4.17)', () => {
  it('every code the app or its client acts on has words in the catalogue', () => {
    const roots = [
      join(__dirname, '..'),
      join(__dirname, '..', '..', '..', '..', 'vendor', 'fdv', 'packages', 'client', 'src'),
    ];
    const codes = new Set<string>();
    for (const root of roots) {
      for (const file of sources(root)) {
        for (const m of readFileSync(file, 'utf8').matchAll(COMPARED)) if (m[1]) codes.add(m[1]);
      }
    }
    // It did find them: the client's own, and the screens'.
    expect([...codes]).toEqual(expect.arrayContaining(['session_ended', 'invalid_credentials', 'preview_pending']));
    expect([...codes].filter((c) => !CATALOGUE[c])).toEqual([]);
    const wordless = Object.entries(CATALOGUE).filter(([, key]) => !i18n.exists(key) && !i18n.exists(`${key}_other`));
    expect(wordless).toEqual([]);
  });

  it("an answer the app has no words of its own for is said in the vault's words, verbatim", () => {
    const err = new ApiRequestError(422, 'validation_failed', 'Send the details before the file.');
    expect(wordsFor(err, t)).toBe('Send the details before the file.');
    // And one with no words at all gets the general ones, never a code.
    expect(wordsFor(new ApiRequestError(500, 'internal', ''), t)).toBe(t('errors.general'));
    expect(wordsFor(new Error('TypeError: x is undefined'), t)).toBe(t('errors.general'));
  });

  it("no answer, a timeout, too many tries, a session that is over: the app's own words", () => {
    expect(wordsFor(new NetworkError('offline'), t)).toBe(t('errors.offline'));
    expect(wordsFor(new NetworkError('timeout'), t)).toBe(t('errors.timeout'));
    const limited = new ApiRequestError(429, 'bad_request', 'Too many requests', undefined, { retryAfterSeconds: 150 });
    expect(wordsFor(limited, t)).toBe('Too many tries. Wait 3 minutes, then try again.');
    const ended = new ApiRequestError(401, 'session_ended', 'Session revoked (reuse)');
    expect(wordsFor(ended, t)).toBe(t('errors.sessionEnded'));
    expect(wordsFor(ended, t)).not.toMatch(/reuse|revoked|session_ended/);
  });

  it('none of the words is a code, a status or "error"', () => {
    const coded = [...new Set(Object.values(CATALOGUE))]
      .map((key) => [key, t(key, { count: 2 })])
      .filter(([, words]) => /\b(error|[a-z]+_[a-z_]+|[45]\d\d)\b/i.test(words ?? ''));
    expect(coded).toEqual([]);
  });
});
