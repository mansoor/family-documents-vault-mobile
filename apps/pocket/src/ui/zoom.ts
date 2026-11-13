/**
 * The arithmetic of a page under the fingers (0.7.1): how far it may be
 * made larger, where it may be moved to, and when a swipe turns it. Plain
 * functions, so they are tested on their own; each is also a worklet, so
 * the gestures call them on the UI thread while the fingers move.
 */

/** A page at its own size; the buttons go no further than the fingers settle. */
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;
/** What a double tap makes it, at the point tapped. */
export const DOUBLE_TAP_ZOOM = 2.5;
/** The − and + buttons' steps. */
export const ZOOM_STEPS = [1, 1.5, 2, 3, 4] as const;
/** While the fingers are down they may go a little past either end; let go, it settles. */
export const PINCH_MIN = 0.7;
export const PINCH_MAX = 5;
/** Sideways, past this far (or a quick flick past FLICK_DISTANCE), the page turns. */
export const TURN_DISTANCE = 60;
export const FLICK_DISTANCE = 25;
export const FLICK_SPEED = 500;
/** Down, past this far and no further across, Show mode ends. */
export const DOWN_DISTANCE = 120;

/** Close enough to its own size to count as it. */
export function atOwnSize(scale: number): boolean {
  'worklet';
  return scale <= MIN_ZOOM + 0.01;
}

export function clamp(value: number, lo: number, hi: number): number {
  'worklet';
  return Math.min(hi, Math.max(lo, value));
}

/** Where a pinch may take it while the fingers are still down. */
export function pinchScale(scale: number): number {
  'worklet';
  return clamp(scale, PINCH_MIN, PINCH_MAX);
}

/** Where it comes to rest when the fingers let go: back to 1× if below it, to 4× if above. */
export function settleScale(scale: number): number {
  'worklet';
  return clamp(scale, MIN_ZOOM, MAX_ZOOM);
}

/** The next of the buttons' steps up (+1) or down (−1) from wherever the fingers left it. */
export function stepZoom(scale: number, direction: 1 | -1): number {
  const steps: readonly number[] = ZOOM_STEPS;
  if (direction > 0) return steps.find((s) => s > scale + 0.01) ?? MAX_ZOOM;
  return [...steps].reverse().find((s) => s < scale - 0.01) ?? MIN_ZOOM;
}

/**
 * The page's size at 1×, drawn to fit the frame (contentFit="contain"):
 * the frame itself until the picture says what shape it is.
 */
export function fitted(frameW: number, frameH: number, aspect: number): { w: number; h: number } {
  'worklet';
  if (!(aspect > 0) || !(frameW > 0) || !(frameH > 0)) return { w: frameW, h: frameH };
  const w = Math.min(frameW, frameH * aspect);
  return { w, h: w / aspect };
}

/**
 * How far it may be moved from the middle, either way, at a scale: no
 * further than its own edges. Smaller than the frame, it stays centred.
 */
export function maxOffset(scale: number, content: number, frame: number): number {
  'worklet';
  return Math.max(0, (content * scale - frame) / 2);
}

/** An offset kept within the page's edges. */
export function clampOffset(offset: number, scale: number, content: number, frame: number): number {
  'worklet';
  const most = maxOffset(scale, content, frame);
  return clamp(offset, -most, most);
}

/**
 * Made larger or smaller about a point (the fingers' focal point, or the
 * tap), measured from the frame's middle: that point of the page stays
 * under the fingers. The offset before is at scale `from`; the one
 * returned is at scale `to`, not yet kept within the edges.
 */
export function zoomAbout(focal: number, offset: number, from: number, to: number): number {
  'worklet';
  if (!(from > 0)) return 0;
  return focal - (to / from) * (focal - offset);
}

/**
 * What a one-finger swipe at the page's own size does when it lets go:
 * 1 the next page (it went left), −1 the previous, 'down' (where asked) to
 * leave, or nothing — a short drag, or one more up and down than across.
 */
export function swipeOutcome(dx: number, dy: number, vx: number, down = false): 1 | -1 | 'down' | null {
  'worklet';
  if (down && dy > DOWN_DISTANCE && Math.abs(dx) < TURN_DISTANCE) return 'down';
  if (Math.abs(dx) <= Math.abs(dy) * 1.5) return null;
  const far = Math.abs(dx) > TURN_DISTANCE;
  const flicked = Math.abs(dx) > FLICK_DISTANCE && Math.abs(vx) > FLICK_SPEED && Math.sign(vx) === Math.sign(dx);
  if (!far && !flicked) return null;
  return dx < 0 ? 1 : -1;
}

/**
 * How far the page follows a sideways finger at its own size: a little,
 * and less still towards a page that is not there (it bounces back).
 */
export function swipeFollow(dx: number, dy: number, canPrevious: boolean, canNext: boolean): number {
  'worklet';
  if (Math.abs(dx) <= Math.abs(dy)) return 0;
  const there = dx < 0 ? canNext : canPrevious;
  return dx * (there ? 0.4 : 0.12);
}
