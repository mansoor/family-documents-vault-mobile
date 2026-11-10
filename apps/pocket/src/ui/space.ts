import type { space } from '@fdv/shared';

/** A spacing on the shared scale (@fdv/shared's `space`: 4, 6, 8 … 32). */
export type Space = (typeof space)[number];

/**
 * The compact step (R1, the redesign): each value on the shared scale drawn
 * a step smaller, so every screen is denser at once — a page's 20 at the
 * sides is 12, a gap of 12 is 8 — while the code still names the spacing it
 * means on the scale the web uses.
 */
const COMPACT: Record<Space, Space> = {
  0: 0,
  4: 4,
  6: 4,
  8: 6,
  10: 8,
  12: 8,
  14: 10,
  16: 12,
  18: 12,
  20: 12,
  24: 16,
  32: 20,
};

/**
 * A padding, margin or gap, written as its value on the shared scale and
 * checked against it (P1): `sp(12)` compiles, `sp(13)` does not. Drawn at
 * the phone's compact step (R1).
 */
export const sp = (value: Space): Space => COMPACT[value];
