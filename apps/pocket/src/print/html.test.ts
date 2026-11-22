import { documentHtml, escapeHtml, isPagePicture, noteBody, noteHtml, shownColumns, tableHtml } from './html';

const foot = { words: 'Printed from The Test family on 22 Nov 2026, 14:03' };
const JPEG = 'data:image/jpeg;base64,/9j/2Q==';

describe('printing (0.21.0): the page given to the platform’s print', () => {
  it('every word is text: nothing a title, a note or a name says becomes markup', () => {
    expect(escapeHtml(`<script>alert("x")</script> & 'y'`)).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;',
    );
    const html = documentHtml({
      name: '<img src=x onerror=alert(1)>',
      subline: 'Pat · "Passport"',
      details: { rows: [['Kind', '<b>Passport</b>']], noteLabel: 'Notes', note: '<script>x</script>' },
      pages: [],
      pageWords: () => '',
      foot,
    });
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>x');
    expect(html).not.toContain('<b>Passport');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
  });

  it('a page is drawn only from a JPEG the vault drew: anything else is left out', () => {
    expect(isPagePicture(JPEG)).toBe(true);
    expect(isPagePicture('https://example.com/x.jpg')).toBe(false);
    expect(isPagePicture('data:image/jpeg;base64,abc" onerror="x')).toBe(false);
    const html = documentHtml({
      name: 'Will',
      subline: null,
      details: null,
      pages: [JPEG, 'javascript:alert(1)', JPEG],
      pageWords: (n, of) => `Page ${n} of ${of}`,
      foot,
    });
    expect(html.match(/<img /g)).toHaveLength(2);
    expect(html).toContain('alt="Page 2 of 2"');
    expect(html).not.toContain('javascript:');
  });

  it('nothing of the app around it, the light theme, and the vault and the time at the foot', () => {
    const html = tableHtml({ title: 'Holiday', said: [], columns: ['Name'], rows: [['Passport']], none: '', foot });
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('background: #ffffff');
    expect(html).toContain('<p class="foot">Printed from The Test family on 22 Nov 2026, 14:03</p>');
    expect(html).not.toMatch(/<button|<nav|<a /);
  });

  it('fetches nothing and runs nothing: only its own pictures and style', () => {
    const html = noteHtml({ title: 'Gate', lines: [], words: 'x', foot });
    expect(html).toContain(
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">`,
    );
  });

  it('pages cut at the limit, or one missing, are said on the printout, and each page keeps its own number', () => {
    const html = documentHtml({
      name: 'Deeds',
      subline: null,
      details: null,
      pages: [JPEG, JPEG],
      pageNumbers: [1, 3],
      total: 48,
      pagesSaid: ['Pages 1–20 of 48. The rest weren’t printed.', 'Page 2 couldn’t be read, so it isn’t printed.'],
      pageWords: (n, of) => `Page ${n} of ${of}`,
      foot,
    });
    expect(html).toContain('Pages 1–20 of 48. The rest weren’t printed.');
    expect(html).toContain('Page 2 couldn’t be read, so it isn’t printed.');
    expect(html).toContain('alt="Page 1 of 48"');
    expect(html).toContain('alt="Page 3 of 48"');
  });

  it('a note’s words: headings, lists and boxes to tick, a link as words with its address, never a link', () => {
    const body = noteBody('# Gate\n\nThe **blue** door.\n\n- [ ] milk\n- [x] bread\n\n1. one\n2. two\n\n[the shop](https://shop.example.com)');
    expect(body).toContain('<h3>Gate</h3>');
    expect(body).toContain('The <strong>blue</strong> door.');
    expect(body).toContain('<ul class="checks"><li>☐ milk</li><li>☑ bread</li></ul>');
    expect(body).toContain('<ol start="1"><li>one</li><li>two</li></ol>');
    expect(body).toContain('the shop (https://shop.example.com)');
    expect(body).not.toContain('<a ');
    const html = noteHtml({ title: 'Spare keys', lines: ['Only me', 'Changed 1 Nov'], words: 'In the tin.', foot });
    expect(html).toContain('<h1>Spare keys</h1>');
    expect(html).toContain('<p class="sub">Only me</p>');
    expect(html).toContain('In the tin.');
  });

  it('a table: what it shows said above it, a box to tick when asked, and words for none', () => {
    const html = tableHtml({
      title: 'Holiday',
      said: ['Who: Pat'],
      columns: ['Name', 'Status'],
      rows: [['Passport', 'Expires soon']],
      tick: 'Done',
      none: 'Nothing in it yet.',
      foot,
    });
    expect(html).toContain('<p class="said">Who: Pat</p>');
    expect(html).toContain('<th>Done</th><th>Name</th><th>Status</th>');
    expect(html).toContain('<td class="tick">☐</td><td>Passport</td><td>Expires soon</td>');
    const none = tableHtml({ title: 'Empty', said: [], columns: ['Name'], rows: [], none: 'Nothing in it yet.', foot });
    expect(none).toContain('Nothing in it yet.');
    expect(none).not.toContain('<table>');
  });

  it('a column nobody is told is left out; the name always stays', () => {
    expect(shownColumns(['Name', 'Kind', 'Where'], [['A', 'Passport', ''], ['', 'Bill', '']])).toEqual({
      columns: ['Name', 'Kind'],
      rows: [
        ['A', 'Passport'],
        ['', 'Bill'],
      ],
    });
  });
});
