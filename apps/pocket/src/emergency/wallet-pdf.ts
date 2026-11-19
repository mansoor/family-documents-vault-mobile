import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';

/**
 * The wallet card as a PDF (app 0.19.0; the vault's H4), made on the phone
 * from what is on the screen, as the web prints it: a card the size of a
 * bank card (85.6 × 54 mm, taller when there is more on it), each part's
 * name beside what was typed, the line that it is not medical advice at
 * its foot — on an A4 page, so printed at its actual size it is the size of
 * the card. Nothing on it needs the vault: no link, no code to scan. More
 * than a page holds goes on to a second card, "continued".
 *
 * Light whatever the app's theme, black on white, in the PDF's own
 * Helvetica. No metadata of its own: no title, no author, no date.
 */

export interface CardRow {
  label: string;
  lines: string[];
}

export interface CardContent {
  /** "Emergency information". */
  heading: string;
  /** Whose: their name as the family has it. */
  name: string;
  /** Said on a card that carries on from the one before: "(continued)". */
  continued: string;
  rows: CardRow[];
  /** The line every card carries: entered by the family, not medical advice. */
  foot: string;
}

const MM = 72 / 25.4;
const PAGE = { width: 210 * MM, height: 297 * MM };
const MARGIN = 15 * MM;
const CARD_WIDTH = 85.6 * MM;
const CARD_MIN_HEIGHT = 54 * MM;
const PAD = 3 * MM;
const RADIUS = 3 * MM;
const LABEL_WIDTH = 22 * MM;
const GAP = 2 * MM;
const ROW_GAP = 1 * MM;
const SIZE = 8;
const LINE = SIZE * 1.25;
const FOOT_SIZE = 6.5;
const FOOT_LINE = FOOT_SIZE * 1.25;
const FOOT_GAP = 1.5 * MM;
const BETWEEN_CARDS = 6 * MM;
const INK = rgb(0.1, 0.1, 0.12);
const MUTED = rgb(0.38, 0.38, 0.42);
const BORDER = rgb(0.55, 0.55, 0.6);

/** The letters the PDF's Helvetica cannot draw: shown on the card as "?". */
export async function lettersNotOnTheCard(texts: readonly string[]): Promise<string[]> {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const set = new Set(font.getCharacterSet());
  const missing = new Set<string>();
  for (const text of texts) {
    for (const ch of text) {
      if (ch === '\n' || ch === '\r' || ch === '\t') continue;
      const code = ch.codePointAt(0);
      if (code !== undefined && !set.has(code)) missing.add(ch);
    }
  }
  return [...missing];
}

/**
 * Only what the font draws: anything else as "?". A line break stays one
 * (wrap starts a new line there; the font has no such letter, and it is
 * never drawn); a tab is a space.
 */
export function drawable(text: string, set: Set<number>): string {
  let out = '';
  for (const ch of text.replace(/\r\n?/g, '\n').replace(/\t/g, ' ')) {
    const code = ch.codePointAt(0);
    out += ch === '\n' || (code !== undefined && set.has(code)) ? ch : '?';
  }
  return out;
}

/** Text in lines no wider than `width`: at spaces where it can, inside a long word where it must. */
export function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/ +/).filter((w) => w !== '');
    if (words.length === 0) {
      out.push('');
      continue;
    }
    let line = '';
    for (const word of words) {
      const tryLine = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(tryLine, size) <= width) {
        line = tryLine;
        continue;
      }
      if (line) out.push(line);
      // A word wider than the line on its own: cut where it fills it.
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > width) {
        let n = rest.length - 1;
        while (n > 1 && font.widthOfTextAtSize(rest.slice(0, n), size) > width) n -= 1;
        out.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      line = rest;
    }
    out.push(line);
  }
  return out;
}

export interface Laid {
  label: string[];
  value: string[];
  height: number;
}

/** A line of the heading: "Emergency information" in bold, the name after it where it fits. */
interface HeadLine {
  bold: string;
  regular: string;
}

/** Where a line's baseline sits below its top. */
const ascent = (size: number) => size * 0.8;

/** A card drawn from its top: its rounded edge, its heading, its rows, its foot. */
function drawCard(
  page: PDFPage,
  top: number,
  height: number,
  head: HeadLine[],
  rows: Laid[],
  foot: string[],
  fonts: { regular: PDFFont; bold: PDFFont },
): void {
  const left = MARGIN;
  const w = CARD_WIDTH;
  const r = RADIUS;
  page.drawSvgPath(
    `M ${r} 0 H ${w - r} A ${r} ${r} 0 0 1 ${w} ${r} V ${height - r} A ${r} ${r} 0 0 1 ${w - r} ${height} H ${r} A ${r} ${r} 0 0 1 0 ${height - r} V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`,
    { x: left, y: top, borderColor: BORDER, borderWidth: 0.75 },
  );
  const x = left + PAD;
  let at = top - PAD;
  for (const line of head) {
    const y = at - ascent(SIZE);
    if (line.bold) page.drawText(line.bold, { x, y, size: SIZE, font: fonts.bold, color: INK });
    if (line.regular) {
      const after = line.bold ? fonts.bold.widthOfTextAtSize(line.bold, SIZE) : 0;
      page.drawText(line.regular, { x: x + after, y, size: SIZE, font: fonts.regular, color: INK });
    }
    at -= LINE;
  }
  at -= ROW_GAP;
  for (const row of rows) {
    const lines = Math.max(row.label.length, row.value.length);
    for (let i = 0; i < lines; i += 1) {
      const y = at - i * LINE - ascent(SIZE);
      const label = row.label[i];
      const value = row.value[i];
      if (label) page.drawText(label, { x, y, size: SIZE, font: fonts.bold, color: INK });
      if (value) page.drawText(value, { x: x + LABEL_WIDTH + GAP, y, size: SIZE, font: fonts.regular, color: INK });
    }
    at -= row.height;
  }
  at -= FOOT_GAP;
  for (const line of foot) {
    page.drawText(line, { x, y: at - ascent(FOOT_SIZE), size: FOOT_SIZE, font: fonts.regular, color: MUTED });
    at -= FOOT_LINE;
  }
}

/** Each part's name and what was typed, in the lines they are drawn in: a line break starts a line. */
export function layRows(rows: readonly CardRow[], fonts: { regular: PDFFont; bold: PDFFont }): Laid[] {
  const set = new Set(fonts.regular.getCharacterSet());
  const valueWidth = CARD_WIDTH - PAD * 2 - LABEL_WIDTH - GAP;
  return rows.map((row) => {
    const label = wrap(drawable(row.label, set), fonts.bold, SIZE, LABEL_WIDTH);
    const value = row.lines.flatMap((l) => wrap(drawable(l, set), fonts.regular, SIZE, valueWidth));
    return { label, value, height: Math.max(label.length, value.length) * LINE + ROW_GAP };
  });
}

/** The card, as a PDF to print or keep. */
export async function buildWalletCard(card: CardContent): Promise<Uint8Array<ArrayBuffer>> {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const set = new Set(regular.getCharacterSet());
  const fonts = { regular, bold };
  const inner = CARD_WIDTH - PAD * 2;

  const laid = layRows(card.rows, fonts);
  const foot = wrap(drawable(card.foot, set), regular, FOOT_SIZE, inner);
  const heading = drawable(card.heading, set);
  /** The heading's lines: the name beside it where it fits, below it otherwise. */
  const headFor = (more: boolean): HeadLine[] => {
    const rest = drawable(`— ${card.name}${more ? ` ${card.continued}` : ''}`, set);
    const beside = ` ${rest}`;
    if (bold.widthOfTextAtSize(heading, SIZE) + regular.widthOfTextAtSize(beside, SIZE) <= inner) {
      return [{ bold: heading, regular: beside }];
    }
    return [{ bold: heading, regular: '' }, ...wrap(rest, regular, SIZE, inner).map((l) => ({ bold: '', regular: l }))];
  };
  const fixed = (more: boolean) => PAD * 2 + headFor(more).length * LINE + ROW_GAP + FOOT_GAP + foot.length * FOOT_LINE;

  // As many rows to a card as a page holds; the rest on cards of their own, "continued".
  const room = PAGE.height - MARGIN * 2;
  // A part longer than a card of its own holds is cut into pieces that each fit one.
  const most = Math.max(1, Math.floor((room - fixed(true) - ROW_GAP) / LINE));
  const pieces: Laid[] = laid.flatMap((row) => {
    const lines = Math.max(row.label.length, row.value.length);
    if (lines <= most) return [row];
    const out: Laid[] = [];
    for (let i = 0; i < lines; i += most) {
      const label = row.label.slice(i, i + most);
      const value = row.value.slice(i, i + most);
      out.push({ label, value, height: Math.max(label.length, value.length) * LINE + ROW_GAP });
    }
    return out;
  });
  const cards: Laid[][] = [];
  let now: Laid[] = [];
  let used = fixed(false);
  for (const row of pieces) {
    if (now.length > 0 && used + row.height > room) {
      cards.push(now);
      now = [];
      used = fixed(true);
    }
    now.push(row);
    used += row.height;
  }
  cards.push(now);

  let page = pdf.addPage([PAGE.width, PAGE.height]);
  let top = PAGE.height - MARGIN;
  cards.forEach((rows, i) => {
    const more = i > 0;
    const height = Math.max(CARD_MIN_HEIGHT, fixed(more) + rows.reduce((n, r) => n + r.height, 0));
    if (top - height < MARGIN) {
      page = pdf.addPage([PAGE.width, PAGE.height]);
      top = PAGE.height - MARGIN;
    }
    drawCard(page, top, height, headFor(more), rows, foot, fonts);
    top -= height + BETWEEN_CARDS;
  });
  return new Uint8Array(await pdf.save({ useObjectStreams: false }));
}
