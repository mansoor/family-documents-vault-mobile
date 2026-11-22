import { parseNotes, type NoteBlock, type NoteInline } from '@fdv/shared';

/**
 * What the phone prints (0.21.0), as one HTML page for the platform's print:
 * a document's pages and a sheet of its details, a note, a collection's
 * contents or the activity log as a table. Nothing of the app around it —
 * no tabs, no header, no buttons — in the light theme whatever the phone is
 * set to, with the vault's name and when it was printed at the foot.
 *
 * Every word in it is text, escaped here: nothing a document, a note or a
 * name says can become markup. A page is drawn only from the JPEG the vault
 * drew of it, as a data address. Nothing secret is ever given to it: no PIN,
 * no password, no link to a share. Pure, so it is tested without a screen.
 */

/** Text, safe anywhere in HTML: in an element or in an attribute. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** A page's picture: only a JPEG the vault drew, as a data address; anything else is not drawn. */
const JPEG_DATA = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;
export function isPagePicture(uri: string): boolean {
  return JPEG_DATA.test(uri);
}

/** What is said at the foot of every printed page: the vault's name and when, already in words. */
export interface Foot {
  /** "Printed from The Test family on 22 Nov 2026, 14:03". */
  words: string;
}

const STYLE = `
@page { margin: 16mm; }
* { box-sizing: border-box; }
html, body { background: #ffffff; color: #1a1a1a; }
body { font-family: -apple-system, Roboto, "Segoe UI", Helvetica, Arial, sans-serif; font-size: 11pt; line-height: 1.45; margin: 0; }
h1 { font-size: 18pt; margin: 0 0 4pt; }
h2 { font-size: 13pt; margin: 14pt 0 6pt; }
h3, h4, h5 { font-size: 11.5pt; margin: 10pt 0 4pt; }
p { margin: 0 0 6pt; }
.sub { color: #555555; margin: 0 0 10pt; }
.said { color: #333333; margin: 0 0 2pt; }
dl.facts { display: grid; grid-template-columns: max-content 1fr; gap: 3pt 14pt; margin: 6pt 0 10pt; }
dl.facts dt { color: #555555; }
dl.facts dd { margin: 0; font-weight: 600; }
table { width: 100%; border-collapse: collapse; margin-top: 6pt; }
th, td { text-align: left; vertical-align: top; padding: 4pt 6pt; border-bottom: 1px solid #cccccc; }
th { font-weight: 700; border-bottom: 1.5px solid #555555; }
thead { display: table-header-group; }
tr { page-break-inside: avoid; }
td.tick { width: 18pt; font-size: 13pt; }
.page { page-break-before: always; text-align: center; }
.page.first { page-break-before: auto; }
.page img { max-width: 100%; max-height: 245mm; }
.note ul, .note ol { margin: 0 0 6pt; padding-left: 18pt; }
.note ul.checks { list-style: none; padding-left: 4pt; }
.note blockquote { margin: 0 0 6pt; padding-left: 10pt; border-left: 2px solid #999999; color: #333333; }
.foot { margin-top: 18pt; padding-top: 6pt; border-top: 1px solid #cccccc; color: #555555; font-size: 9pt; }
`;

/** What the printed page may load: nothing but its own pictures (data addresses) and its own style. */
export const PRINT_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'";

/** A whole page to print: its title, what goes in it (already HTML, built here), and the foot. */
function page(title: string, body: string, foot: Foot): string {
  return [
    '<!DOCTYPE html>',
    '<html lang="en-GB"><head><meta charset="utf-8">',
    // Nothing is fetched from anywhere, and no script runs: only its own style and the pages it carries.
    `<meta http-equiv="Content-Security-Policy" content="${PRINT_CSP}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${STYLE}</style>`,
    '</head><body>',
    body,
    `<p class="foot">${escapeHtml(foot.words)}</p>`,
    '</body></html>',
  ].join('');
}

/** A note's words, drawn from its tree as plain HTML: links are words with their address, never links. */
export function noteBody(source: string): string {
  const inline = (nodes: NoteInline[]): string =>
    nodes
      .map((n) => {
        switch (n.type) {
          case 'text':
            return escapeHtml(n.text);
          case 'break':
            return '<br>';
          case 'strong':
            return `<strong>${inline(n.children)}</strong>`;
          case 'em':
            return `<em>${inline(n.children)}</em>`;
          case 'strike':
            return `<s>${inline(n.children)}</s>`;
          case 'underline':
            return `<u>${inline(n.children)}</u>`;
          case 'link': {
            const words = inline(n.children);
            return words ? `${words} (${escapeHtml(n.href)})` : escapeHtml(n.href);
          }
          default:
            return '';
        }
      })
      .join('');
  const block = (b: NoteBlock): string => {
    switch (b.type) {
      case 'heading':
        // Below the page's own heading: a note's # is the printed page's h3.
        return `<h${b.level + 2}>${inline(b.children)}</h${b.level + 2}>`;
      case 'paragraph':
        return `<p>${inline(b.children)}</p>`;
      case 'quote':
        return `<blockquote>${inline(b.children)}</blockquote>`;
      case 'list': {
        const checks = b.items.some((i) => i.checked !== null);
        const items = b.items
          .map((i) => `<li>${i.checked === null ? '' : i.checked ? '☑ ' : '☐ '}${inline(i.children)}</li>`)
          .join('');
        if (checks) return `<ul class="checks">${items}</ul>`;
        return b.ordered ? `<ol start="${Math.max(0, Math.floor(b.start))}">${items}</ol>` : `<ul>${items}</ul>`;
      }
      default:
        return '';
    }
  };
  return `<div class="note">${parseNotes(source).blocks.map(block).join('')}</div>`;
}

/** Facts as a list of terms: [label, value], each escaped. */
function facts(rows: readonly (readonly [string, string])[]): string {
  if (rows.length === 0) return '';
  return `<dl class="facts">${rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>`;
}

/**
 * A document: its name, then a sheet of its details (if asked for), its note
 * on that sheet, then its pages, one to a printed page.
 */
export function documentHtml(d: {
  name: string;
  /** Under its name: whose, what kind, who can see it. */
  subline: string | null;
  /** The sheet of its details: null for none asked for. */
  details: { rows: readonly (readonly [string, string])[]; noteLabel: string; note: string | null } | null;
  /** Pages as the vault drew them (data addresses); none asked for, or none drawn. */
  pages: readonly string[];
  /** Each page's own number, where they are not 1, 2, 3… (a page missing between them). */
  pageNumbers?: readonly number[];
  /** How many pages it has in all, where more were left out than are printed. */
  total?: number;
  /** Said above the pages: those left out ("Pages 1–20 of 48"), those missing. */
  pagesSaid?: readonly string[];
  /** Each page's own words for the blind and the page itself: "Page 2 of 3". */
  pageWords: (n: number, of: number) => string;
  foot: Foot;
}): string {
  const parts = [`<h1>${escapeHtml(d.name)}</h1>`];
  if (d.subline) parts.push(`<p class="sub">${escapeHtml(d.subline)}</p>`);
  if (d.details) {
    parts.push(facts(d.details.rows));
    if (d.details.note?.trim()) parts.push(`<h2>${escapeHtml(d.details.noteLabel)}</h2>`, noteBody(d.details.note));
  }
  const pages = d.pages
    .map((uri, i) => ({ uri, n: d.pageNumbers?.[i] ?? i + 1 }))
    .filter((p) => isPagePicture(p.uri));
  const of = d.total ?? pages.length;
  for (const said of d.pagesSaid ?? []) parts.push(`<p class="sub">${escapeHtml(said)}</p>`);
  pages.forEach(({ uri, n }, i) => {
    const words = escapeHtml(d.pageWords(d.pageNumbers ? n : i + 1, d.pageNumbers || d.total ? of : pages.length));
    // The first page follows the heading when no sheet of details comes before it.
    const cls = i === 0 && !d.details ? 'page first' : 'page';
    parts.push(`<div class="${cls}"><img src="${uri}" alt="${words}"></div>`);
  });
  return page(d.name, parts.join(''), d.foot);
}

/** A note: its title, who sees it and when it changed, then its words. */
export function noteHtml(n: { title: string; lines: readonly string[]; words: string; foot: Foot }): string {
  return page(
    n.title,
    [`<h1>${escapeHtml(n.title)}</h1>`, ...n.lines.map((l) => `<p class="sub">${escapeHtml(l)}</p>`), noteBody(n.words)].join(''),
    n.foot,
  );
}

/**
 * A table: a heading, what it shows said above it (filters, days), then the
 * columns and rows — each cell text — and, if asked, a box to tick before each.
 */
export function tableHtml(tb: {
  title: string;
  said: readonly string[];
  columns: readonly string[];
  rows: readonly (readonly string[])[];
  /** A box to tick beside each row, with its column's heading. */
  tick?: string | null;
  /** Said where there are no rows. */
  none: string;
  foot: Foot;
}): string {
  const head = `${tb.tick ? `<th>${escapeHtml(tb.tick)}</th>` : ''}${tb.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}`;
  const body = tb.rows
    .map(
      (r) => `<tr>${tb.tick ? '<td class="tick">☐</td>' : ''}${r.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`,
    )
    .join('');
  return page(
    tb.title,
    [
      `<h1>${escapeHtml(tb.title)}</h1>`,
      ...tb.said.map((s) => `<p class="said">${escapeHtml(s)}</p>`),
      tb.rows.length === 0
        ? `<p class="sub">${escapeHtml(tb.none)}</p>`
        : `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`,
    ].join(''),
    tb.foot,
  );
}

/**
 * The columns worth printing: the first always (the name), and any other
 * with something in it — a column nobody is given (where originals are kept,
 * for whoever is not told) is left out, as the screen leaves it out.
 */
export function shownColumns(columns: readonly string[], rows: readonly (readonly string[])[]): {
  columns: string[];
  rows: string[][];
} {
  const keep = columns.map((_, i) => i === 0 || rows.some((r) => (r[i] ?? '').trim() !== ''));
  return {
    columns: columns.filter((_, i) => keep[i]),
    rows: rows.map((r) => r.filter((_, i) => keep[i])),
  };
}
