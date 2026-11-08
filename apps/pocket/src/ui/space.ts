import type { space } from '@fdv/shared';

/** A spacing on the shared scale (@fdv/shared's `space`: 4, 6, 8 … 32). */
export type Space = (typeof space)[number];

/**
 * A padding, margin or gap, written as its value and checked against the
 * shared scale (P1): `sp(12)` compiles, `sp(13)` does not. So the phone
 * spaces things as the web and the prototype do, and reads as it looks.
 */
export const sp = (value: Space): Space => value;
