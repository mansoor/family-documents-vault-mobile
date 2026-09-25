import { readPrefs, writePrefs } from '../platform/prefs';

/**
 * How long a capture takes, stage by stage, kept on the phone so the
 * owner can read the numbers the 20-second promise is measured by (the
 * Timings screen: tap the version seven times). Milliseconds and stage
 * names only — never a name, a title or anything read off a page — so a
 * run can be shared as it is.
 */
export const STAGES = ['tap', 'scanner_shown', 'pages_accepted', 'card_shown', 'save', 'queued', 'created'] as const;
export type Stage = (typeof STAGES)[number];

export interface TimingRun {
  /** When it started, ISO. */
  at: string;
  kind: 'scan' | 'file' | 'photo';
  pages: number;
  /** Milliseconds from the tap. */
  marks: Partial<Record<Stage, number>>;
  /** The queue item it became, to match the vault's answer; dropped from exports. */
  item?: string;
}

const PREF = 'timings';
const KEEP = 20;

export function loadRuns(): TimingRun[] {
  return readPrefs<TimingRun[]>(PREF, []);
}

function store(runs: TimingRun[]): void {
  writePrefs(PREF, runs.slice(-KEEP));
}

/** The run under way, from the tap to the Save. */
export class TimingRecorder {
  private run: (TimingRun & { start: number }) | null = null;

  constructor(private readonly now: () => number = () => Date.now()) {}

  start(kind: TimingRun['kind']): void {
    const start = this.now();
    this.run = {
      at: new Date(start).toISOString(),
      kind,
      pages: 0,
      marks: { tap: 0 },
      start,
    };
  }

  mark(stage: Stage, pages?: number): void {
    if (!this.run || this.run.marks[stage] !== undefined) return;
    this.run.marks[stage] = this.now() - this.run.start;
    if (pages !== undefined) this.run.pages = pages;
  }

  /** Queued: the run is kept, waiting for the vault's 201. */
  queued(itemId: string): void {
    if (!this.run) return;
    this.mark('queued');
    const { start: _start, ...run } = this.run;
    store([...loadRuns(), { ...run, item: itemId }]);
    this.pending.set(itemId, this.run.start);
    this.run = null;
  }

  cancel(): void {
    this.run = null;
  }

  private readonly pending = new Map<string, number>();

  /** The vault has it. */
  created(itemId: string): void {
    const start = this.pending.get(itemId);
    if (start === undefined) return;
    this.pending.delete(itemId);
    const runs = loadRuns();
    const run = runs.find((r) => r.item === itemId);
    if (!run) return;
    run.marks.created = this.now() - start;
    store(runs);
  }
}

/** A run's stages as durations, for the screen: the human part is card shown → save. */
export function split(run: TimingRun): { from: Stage; to: Stage; ms: number }[] {
  const out: { from: Stage; to: Stage; ms: number }[] = [];
  let prev: Stage | null = null;
  for (const s of STAGES) {
    const at = run.marks[s];
    if (at === undefined) continue;
    if (prev !== null) out.push({ from: prev, to: s, ms: at - (run.marks[prev] ?? 0) });
    prev = s;
  }
  return out;
}

/**
 * What is shared: the runs without anything that could tie them to a
 * document — no queue item, and the day only, not the moment, which with
 * the stages would give the time the document reached the vault.
 */
export function exportRuns(runs: TimingRun[]): string {
  return JSON.stringify(
    runs.map(({ item: _item, at, ...r }) => ({ ...r, day: at.slice(0, 10) })),
    null,
    2,
  );
}
