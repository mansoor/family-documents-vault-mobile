import { log, scrub, setSink } from './log';

describe('the log', () => {
  it('tokens and ids never reach the log', () => {
    const lines: string[] = [];
    setSink((_level, event, fields) => lines.push(`${event} ${JSON.stringify(fields)}`));
    log.info('signed in', {
      access_token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PSR5TCFBh',
      refreshToken: 'r'.repeat(40),
      installation: '0f5a1c2e-9b7d-4e61-8a33-5c2d7e9f1a40',
      document_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      title: "Sam's passport",
      origin: 'http://192.168.1.20:8099',
      note: 'reached 0f5a1c2e-9b7d-4e61-8a33-5c2d7e9f1a40 at last',
      header: 'Bearer abc',
      status: 201,
      ms: 840,
      ok: true,
    });
    const line = lines.join('\n');
    expect(line).not.toMatch(/eyJ|rrrr|0f5a1c2e|aaaaaaaa|passport|192\.168|Bearer/);
    expect(line).toContain('"status":201');
    expect(line).toContain('"ms":840');
    expect(line).toContain('"ok":true');
  });

  it('objects are not written out, and long strings are cut', () => {
    const words = 'the page took a while '.repeat(5);
    expect(scrub({ extra: { title: 'x' }, words, opaque: 'w'.repeat(100) })).toEqual({
      extra: '[object]',
      words: `${words.slice(0, 80)}…`,
      // A long run with no spaces looks like a token, and is treated as one.
      opaque: '[withheld]',
    });
  });
});
