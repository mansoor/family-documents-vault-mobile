import { Timeline } from './timeline';

describe('Timeline', () => {
  it('marks keep their order and export timings only', () => {
    let t = 1_000;
    const timeline = new Timeline(() => t);
    timeline.mark('tap');
    t += 1_200;
    timeline.mark('scannerShown');
    t += 6_400;
    timeline.mark('pagesAccepted');
    t += 300;
    timeline.mark('pdfBuilt');
    timeline.note('pdfMs', 280);
    timeline.note('page1Bytes', 412_000);
    t += 900;
    timeline.mark('created201');

    const out = timeline.export();
    expect(out.marks.map((m) => m.mark)).toEqual([
      'tap',
      'scannerShown',
      'pagesAccepted',
      'pdfBuilt',
      'created201',
    ]);
    expect(out.marks.map((m) => m.ms)).toEqual([0, 1_200, 7_600, 7_900, 8_800]);
    expect(timeline.between('tap', 'pagesAccepted')).toBe(7_600);
    // Nothing but names and numbers leaves a timeline.
    const values = [...out.marks.map((m) => m.ms), ...Object.values(out.numbers)];
    expect(values.every((v) => typeof v === 'number')).toBe(true);
    expect(JSON.stringify(out)).not.toMatch(/https?:|@|\//);
  });

  it('refuses a note that is not a number', () => {
    expect(() => new Timeline().note('x', Number.NaN)).toThrow('must be a number');
  });

  it('a stage that never happened has no duration', () => {
    const timeline = new Timeline();
    timeline.mark('tap');
    expect(timeline.between('tap', 'created201')).toBeNull();
  });
});
