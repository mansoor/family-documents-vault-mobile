/**
 * How long a scan takes, stage by stage: the numbers the spike is judged
 * on. Only names and milliseconds are kept (and counts, such as bytes per
 * page) — never an address, a name or anything read off a page — so a
 * timeline can be exported and shared as it is.
 */
export const MARKS = ['tap', 'scannerShown', 'pagesAccepted', 'pdfBuilt', 'created201'] as const;
export type Mark = (typeof MARKS)[number];

export interface TimelineExport {
  marks: { mark: Mark; ms: number }[];
  numbers: Record<string, number>;
}

export class Timeline {
  private readonly marks: { mark: Mark; at: number }[] = [];
  private readonly numbers: Record<string, number> = {};

  constructor(private readonly now: () => number = () => Date.now()) {}

  mark(mark: Mark): void {
    this.marks.push({ mark, at: this.now() });
  }

  /** A count or a duration that belongs to the run: bytes per page, PDF milliseconds. */
  note(key: string, value: number): void {
    if (!Number.isFinite(value)) throw new Error(`${key} must be a number`);
    this.numbers[key] = value;
  }

  /** Milliseconds since the first mark, in the order they happened. */
  export(): TimelineExport {
    const start = this.marks[0]?.at ?? 0;
    return {
      marks: this.marks.map(({ mark, at }) => ({ mark, ms: at - start })),
      numbers: { ...this.numbers },
    };
  }

  /** Milliseconds between two marks, if both happened. */
  between(from: Mark, to: Mark): number | null {
    const a = this.marks.find((m) => m.mark === from);
    const b = this.marks.find((m) => m.mark === to);
    return a && b ? b.at - a.at : null;
  }
}
