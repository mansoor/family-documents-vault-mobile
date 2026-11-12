import { applyCommand, insertText } from './markdown-edit';

/** The toolbar's buttons on a note's words (12 Nov 2026): what each makes, where the cursor is. */
describe('the notes toolbar', () => {
  const at = (n: number) => ({ start: n, end: n });

  it('wraps the selection, and unwraps it pressed again; marks either side of the cursor', () => {
    const bold = applyCommand('pay the bill', { start: 4, end: 7 }, 'bold');
    expect(bold).toEqual({ text: 'pay **the** bill', selection: { start: 6, end: 9 } });
    expect(applyCommand(bold.text, bold.selection, 'bold').text).toBe('pay the bill');
    expect(applyCommand('ab', at(1), 'underline')).toEqual({ text: 'a++++b', selection: at(3) });
    expect(applyCommand('x', { start: 0, end: 1 }, 'strike').text).toBe('~~x~~');
    expect(applyCommand('x', { start: 0, end: 1 }, 'italic').text).toBe('*x*');
  });

  it('starts each line touched as a list, a checklist, a quote or a heading; pressed again, plain', () => {
    const text = 'milk\neggs\nbread';
    const all = { start: 0, end: text.length };
    expect(applyCommand(text, all, 'bullet').text).toBe('- milk\n- eggs\n- bread');
    expect(applyCommand(text, all, 'numbered').text).toBe('1. milk\n2. eggs\n3. bread');
    const ticks = applyCommand(text, all, 'checklist');
    expect(ticks.text).toBe('- [ ] milk\n- [ ] eggs\n- [ ] bread');
    expect(applyCommand(ticks.text, ticks.selection, 'checklist').text).toBe(text);
    // One kind in place of another, never both.
    expect(applyCommand('- [ ] milk', at(3), 'bullet').text).toBe('- milk');
    expect(applyCommand('## Boiler', at(4), 'heading1').text).toBe('# Boiler');
    expect(applyCommand('Boiler', at(2), 'heading3').text).toBe('### Boiler');
    expect(applyCommand('> said', at(2), 'quote').text).toBe('said');
  });

  it('a link with its address selected to type over; Clear takes every mark off', () => {
    const made = applyCommand('see the site', { start: 8, end: 12 }, 'link');
    expect(made.text).toBe('see the [site](https://)');
    expect(made.text.slice(made.selection.start, made.selection.end)).toBe('https://');
    expect(applyCommand('- **milk** and ~~eggs~~ ++now++ _please_', at(3), 'clear').text).toBe(
      'milk and eggs now please',
    );
  });

  it('scanned words go in on lines of their own, where the cursor is', () => {
    expect(insertText('Shopping', at(8), 'Milk\nEggs ')).toEqual({ text: 'Shopping\nMilk\nEggs', selection: at(18) });
    expect(insertText('a\nb', at(2), 'x')).toEqual({ text: 'a\nx\nb', selection: at(4) });
  });
});
