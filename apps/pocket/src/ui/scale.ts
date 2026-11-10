/**
 * The phone's own scale (R1, the owner's redesign of 10 Nov 2026: "more
 * condensed, smaller type, more in the view"). The web keeps @fdv/shared's
 * larger scale; the phone reads at arm's length and shows more at once.
 * Large text (×1.3) and the phone's own font size still apply on top.
 */
export const TYPE = {
  body: 14,
  secondary: 12,
  small: 11,
  display: { hero: 22, title: 18, screen: 16 },
} as const;

/** Line height for a size: titles sit tight, words to read a little looser. */
export const LINE = { display: 1.25, body: 1.35 } as const;

/** A list's row: the thumbnail's 40 and its padding. */
export const ROW = 52;
