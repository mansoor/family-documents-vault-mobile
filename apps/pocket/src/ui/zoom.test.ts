import {
  atOwnSize,
  clampOffset,
  fitted,
  MAX_ZOOM,
  maxOffset,
  MIN_ZOOM,
  pinchScale,
  settleScale,
  stepZoom,
  swipeFollow,
  swipeOutcome,
  zoomAbout,
  ZOOM_STEPS,
} from './zoom';

describe('a page under the fingers (0.7.1)', () => {
  it('the buttons step 1, 1.5, 2, 3, 4, from wherever the fingers left it', () => {
    expect(ZOOM_STEPS).toEqual([1, 1.5, 2, 3, 4]);
    expect(stepZoom(1, 1)).toBe(1.5);
    expect(stepZoom(1.5, 1)).toBe(2);
    expect(stepZoom(3, 1)).toBe(4);
    expect(stepZoom(4, 1)).toBe(MAX_ZOOM);
    expect(stepZoom(4, -1)).toBe(3);
    expect(stepZoom(1.5, -1)).toBe(1);
    expect(stepZoom(1, -1)).toBe(MIN_ZOOM);
    // Pinched to 2.3: + goes to 3, − to 2.
    expect(stepZoom(2.3, 1)).toBe(3);
    expect(stepZoom(2.3, -1)).toBe(2);
  });

  it('a pinch may go a little past either end while held, and settles within 1× to 4×', () => {
    expect(pinchScale(0.2)).toBe(0.7);
    expect(pinchScale(9)).toBe(5);
    expect(pinchScale(2.2)).toBe(2.2);
    expect(settleScale(0.8)).toBe(1);
    expect(settleScale(4.6)).toBe(4);
    expect(settleScale(2.2)).toBe(2.2);
    expect(atOwnSize(1)).toBe(true);
    expect(atOwnSize(1.005)).toBe(true);
    expect(atOwnSize(1.5)).toBe(false);
  });

  it('the page is fitted to the frame by its shape, or fills it until the shape is known', () => {
    expect(fitted(300, 600, 0)).toEqual({ w: 300, h: 600 });
    // A portrait page, a little taller than wide: as wide as the frame.
    expect(fitted(300, 600, 0.75)).toEqual({ w: 300, h: 400 });
    // A landscape card in a wide frame: as high as the frame.
    expect(fitted(800, 300, 1.5)).toEqual({ w: 450, h: 300 });
  });

  it('it moves no further than its own edges, and smaller than the frame it stays centred', () => {
    expect(maxOffset(1, 300, 300)).toBe(0);
    expect(maxOffset(2, 300, 300)).toBe(150);
    expect(maxOffset(1.5, 100, 300)).toBe(0);
    expect(clampOffset(400, 2, 300, 300)).toBe(150);
    expect(clampOffset(-400, 2, 300, 300)).toBe(-150);
    expect(clampOffset(40, 2, 300, 300)).toBe(40);
    expect(clampOffset(40, 1, 300, 300)).toBe(0);
  });

  it('made larger about the fingers, the point under them stays there', () => {
    // From 1× at the middle, about a point 100 to the right, to 2×: that point
    // of the page (100 from its middle) is drawn at 2 × 100 − 100 = 100.
    const offset = zoomAbout(100, 0, 1, 2);
    expect(offset).toBe(-100);
    expect(offset + 2 * 100).toBe(100);
    // About the middle, the offset only grows with the scale.
    expect(zoomAbout(0, 30, 1, 2)).toBe(60);
    // Back to 1×: about the middle, back to the middle.
    expect(zoomAbout(0, 60, 2, 1)).toBe(30);
    expect(clampOffset(zoomAbout(0, 60, 2, 1), 1, 300, 300)).toBe(0);
  });

  it('a sideways swipe turns the page — left for the next, right for the previous', () => {
    expect(swipeOutcome(-80, 5, 0)).toBe(1);
    expect(swipeOutcome(80, -5, 0)).toBe(-1);
    // A quick flick needs less distance.
    expect(swipeOutcome(-30, 0, -900)).toBe(1);
    expect(swipeOutcome(-30, 0, 900)).toBeNull();
  });

  it('a short drag, or one more up and down than across, does not turn it', () => {
    expect(swipeOutcome(-40, 0, -100)).toBeNull();
    expect(swipeOutcome(-80, 70, 0)).toBeNull();
    expect(swipeOutcome(0, 200, 0)).toBeNull();
  });

  it('down ends Show mode, only where asked', () => {
    expect(swipeOutcome(10, 150, 0, true)).toBe('down');
    expect(swipeOutcome(10, 150, 0, false)).toBeNull();
    expect(swipeOutcome(-90, 150, 0, true)).toBeNull();
  });

  it('the page follows a sideways finger a little, and less towards a page that is not there', () => {
    expect(swipeFollow(-100, 0, true, true)).toBe(-40);
    expect(swipeFollow(-100, 0, true, false)).toBeCloseTo(-12);
    expect(swipeFollow(100, 0, false, true)).toBeCloseTo(12);
    expect(swipeFollow(10, 50, true, true)).toBe(0);
  });
});
