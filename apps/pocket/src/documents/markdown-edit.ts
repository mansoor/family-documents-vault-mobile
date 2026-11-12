/**
 * The notes editor's toolbar, on the phone (the owner's ask of 12 Nov
 * 2026): the web's buttons, acting on what the note is kept as — its small
 * Markdown (@fdv/shared notes.ts) — where the cursor is, or on what is
 * selected. Pure, so each button is tested without drawing the editor.
 *
 *  - Bold `**`, Italic `*`, Underline `++` and Strikethrough `~~` wrap the
 *    selection (or put the marks either side of the cursor), and take them
 *    off again when they are already there.
 *  - Bulleted list `- `, Numbered list `1. `, Checklist `- [ ] `, Quote
 *    `> ` and Heading 1 to 3 (`# `…) set the start of each line touched,
 *    in place of any other; pressed again, take it off (Normal text).
 *  - Link writes `[words](https://)`, the address selected to type over.
 *  - Clear formatting takes every mark off the lines touched.
 */

export interface Selection {
  start: number;
  end: number;
}

export type InlineCommand = 'bold' | 'italic' | 'underline' | 'strike';
export type LineCommand = 'bullet' | 'numbered' | 'checklist' | 'quote' | 'heading1' | 'heading2' | 'heading3' | 'normal';
export type NoteCommand = InlineCommand | LineCommand | 'link' | 'clear';

export interface Edited {
  text: string;
  selection: Selection;
}

const MARKS: Record<InlineCommand, string> = { bold: '**', italic: '*', underline: '++', strike: '~~' };

/** What a line may start with, longest first, so `- [ ] ` is never read as `- `. */
const PREFIX = /^(- \[[ xX]\] |#{1,3} |> |\d+\. |[-*+] )/;

const LINE_PREFIX: Record<Exclude<LineCommand, 'normal' | 'numbered'>, string> = {
  bullet: '- ',
  checklist: '- [ ] ',
  quote: '> ',
  heading1: '# ',
  heading2: '## ',
  heading3: '### ',
};

/** Whether a line already starts as the command would make it. */
function starts(line: string, command: LineCommand): boolean {
  if (command === 'numbered') return /^\d+\. /.test(line);
  if (command === 'bullet') return /^[-*+] /.test(line) && !/^- \[[ xX]\] /.test(line);
  if (command === 'checklist') return /^- \[[ xX]\] /.test(line);
  if (command === 'normal') return false;
  if (command === 'heading1') return /^# /.test(line);
  if (command === 'heading2') return /^## /.test(line);
  if (command === 'heading3') return /^### /.test(line);
  return line.startsWith(LINE_PREFIX[command]);
}

function inline(text: string, sel: Selection, command: InlineCommand): Edited {
  const mark = MARKS[command];
  const before = text.slice(0, sel.start);
  const inside = text.slice(sel.start, sel.end);
  const after = text.slice(sel.end);
  // Already marked just outside the selection: take the marks off.
  if (before.endsWith(mark) && after.startsWith(mark) && !(command === 'italic' && (before.endsWith('**') || after.startsWith('**')))) {
    return {
      text: before.slice(0, -mark.length) + inside + after.slice(mark.length),
      selection: { start: sel.start - mark.length, end: sel.end - mark.length },
    };
  }
  // Marked inside the selection: the same.
  if (inside.length >= mark.length * 2 && inside.startsWith(mark) && inside.endsWith(mark)) {
    const bare = inside.slice(mark.length, inside.length - mark.length);
    return { text: before + bare + after, selection: { start: sel.start, end: sel.start + bare.length } };
  }
  return {
    text: before + mark + inside + mark + after,
    selection: { start: sel.start + mark.length, end: sel.end + mark.length },
  };
}

/** The lines the selection touches: where they start and end in the text. */
function linesOf(text: string, sel: Selection): { from: number; to: number } {
  const from = text.lastIndexOf('\n', sel.start - 1) + 1;
  const nl = text.indexOf('\n', sel.end > sel.start && text[sel.end - 1] === '\n' ? sel.end - 1 : sel.end);
  return { from, to: nl === -1 ? text.length : nl };
}

function lines(text: string, sel: Selection, command: LineCommand): Edited {
  const { from, to } = linesOf(text, sel);
  const block = text.slice(from, to).split('\n');
  // Pressed on lines that are all that already: back to Normal text.
  const off = command !== 'normal' && block.every((l) => l.trim() === '' || starts(l, command));
  let n = 0;
  const next = block.map((line) => {
    const bare = line.replace(PREFIX, '');
    if (line.trim() === '' && block.length > 1) return line;
    if (off || command === 'normal') return bare;
    if (command === 'numbered') return `${(n += 1)}. ${bare}`;
    return LINE_PREFIX[command] + bare;
  });
  const replaced = next.join('\n');
  const delta = replaced.length - (to - from);
  // The cursor stays at the end of what it was in; a selection grows with its lines.
  return {
    text: text.slice(0, from) + replaced + text.slice(to),
    selection:
      sel.start === sel.end
        ? { start: Math.max(from, sel.end + delta), end: Math.max(from, sel.end + delta) }
        : { start: from, end: to + delta },
  };
}

function link(text: string, sel: Selection): Edited {
  const words = text.slice(sel.start, sel.end) || 'words';
  const address = 'https://';
  const made = `[${words}](${address})`;
  const at = sel.start + words.length + 3;
  return {
    text: text.slice(0, sel.start) + made + text.slice(sel.end),
    selection: { start: at, end: at + address.length },
  };
}

function clear(text: string, sel: Selection): Edited {
  const { from, to } = linesOf(text, sel);
  const cleaned = text
    .slice(from, to)
    .split('\n')
    // No look-behind: the phone's engine is not asked for it.
    .map((l) =>
      l
        .replace(PREFIX, '')
        .replace(/\*\*|~~|\+\+|\*/g, '')
        .replace(/(^|[^\w])_([^_\n]+)_(?=[^\w]|$)/g, '$1$2'),
    )
    .join('\n');
  const delta = cleaned.length - (to - from);
  return { text: text.slice(0, from) + cleaned + text.slice(to), selection: { start: from, end: to + delta } };
}

/** One press of a toolbar button on the note's words, where the cursor or the selection is. */
export function applyCommand(text: string, sel: Selection, command: NoteCommand): Edited {
  const s = { start: Math.max(0, Math.min(sel.start, sel.end)), end: Math.min(text.length, Math.max(sel.start, sel.end)) };
  if (command === 'link') return link(text, s);
  if (command === 'clear') return clear(text, s);
  if (command in MARKS) return inline(text, s, command as InlineCommand);
  return lines(text, s, command as LineCommand);
}

/** Words put in where the cursor is (a scan read into the note): on lines of their own. */
export function insertText(text: string, sel: Selection, words: string): Edited {
  const before = text.slice(0, sel.start);
  const after = text.slice(sel.end);
  const lead = before === '' || before.endsWith('\n') ? '' : '\n';
  const tail = after === '' || after.startsWith('\n') ? '' : '\n';
  const put = lead + words.trim() + tail;
  const at = before.length + put.length;
  return { text: before + put + after, selection: { start: at, end: at } };
}
