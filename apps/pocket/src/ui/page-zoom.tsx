import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import {
  atOwnSize,
  clampOffset,
  DOUBLE_TAP_ZOOM,
  fitted,
  MIN_ZOOM,
  pinchScale,
  settleScale,
  swipeFollow,
  swipeOutcome,
  zoomAbout,
} from './zoom';

const SETTLE = { duration: 180 };
const BOUNCE = { damping: 18, stiffness: 220 };

/**
 * A page under the fingers (0.7.1), on Gesture Handler and Reanimated, so
 * the touches are the page's own and not the picture's or a scroll view's
 * (PanResponder never saw them on a real phone). A pinch makes it larger or
 * smaller about the fingers, 1× to 4×; larger, one finger moves it about
 * within its edges; a double tap goes between 1× and 2.5× where tapped; at
 * its own size a sideways swipe turns the page (left: next), following the
 * finger a little and bouncing at the first or last. `level` is the zoom
 * the buttons ask for; `onLevel` is where the fingers left it. A new `page`
 * starts at its own size.
 */
export function PageZoom(props: {
  children: ReactNode;
  level: number;
  onLevel: (level: number) => void;
  page: number;
  canPrevious: boolean;
  canNext: boolean;
  onTurn: (direction: 1 | -1) => void;
  /** Show mode: a swipe down ends it. */
  onSwipeDown?: () => void;
  /** The page's width over its height, once the picture has said. */
  aspect?: number;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { level, page, canPrevious, canNext, aspect, testID } = props;
  const scale = useSharedValue(1);
  // Where the scale is going: a level asked for that it is already going to is no news.
  const target = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const swipe = useSharedValue(0);
  const frame = useSharedValue({ w: 0, h: 0 });
  const shape = useSharedValue(0);
  const edges = useSharedValue({ previous: false, next: false });
  const pinch = useSharedValue({ from: 1, x: 0, y: 0, fx: 0, fy: 0 });
  const moving = useSharedValue(false);

  // The handlers the gestures call back on the JS thread, kept current
  // without making the gestures anew on every render.
  const latest = useRef({ onLevel: props.onLevel, onTurn: props.onTurn, onSwipeDown: props.onSwipeDown });
  useEffect(() => {
    latest.current = { onLevel: props.onLevel, onTurn: props.onTurn, onSwipeDown: props.onSwipeDown };
  });
  const settled = useCallback((s: number) => latest.current.onLevel(s), []);
  const turned = useCallback((d: 1 | -1) => latest.current.onTurn(d), []);
  const down = useCallback(() => latest.current.onSwipeDown?.(), []);
  const leaves = props.onSwipeDown !== undefined;

  useEffect(() => {
    edges.set({ previous: canPrevious, next: canNext });
  }, [edges, canPrevious, canNext]);
  useEffect(() => {
    shape.set(aspect ?? 0);
  }, [shape, aspect]);

  // Another page: at its own size, in the middle.
  useEffect(() => {
    scale.set(1);
    target.set(1);
    x.set(0);
    y.set(0);
    swipe.set(0);
  }, [page, scale, target, x, y, swipe]);

  // The buttons (or Fit page) ask for a level: made so about the middle.
  useEffect(() => {
    if (Math.abs(target.get() - level) < 0.001) return;
    const from = scale.get();
    target.set(level);
    const f = frame.get();
    const c = fitted(f.w, f.h, shape.get());
    scale.set(withTiming(level, SETTLE));
    x.set(withTiming(clampOffset(zoomAbout(0, x.get(), from, level), level, c.w, f.w), SETTLE));
    y.set(withTiming(clampOffset(zoomAbout(0, y.get(), from, level), level, c.h, f.h), SETTLE));
  }, [level, scale, target, x, y, frame, shape]);

  // The gestures call settled, turned and down on a touch, never while
  // rendering; the compiler cannot see that from here.
  /* eslint-disable react-hooks/refs */
  const gesture = useMemo(() => {
    const pinching = Gesture.Pinch()
      .onStart((e) => {
        const f = frame.get();
        pinch.set({ from: scale.get(), x: x.get(), y: y.get(), fx: e.focalX - f.w / 2, fy: e.focalY - f.h / 2 });
        swipe.set(withTiming(0, SETTLE));
      })
      .onUpdate((e) => {
        const p = pinch.get();
        const f = frame.get();
        const c = fitted(f.w, f.h, shape.get());
        const s = pinchScale(p.from * e.scale);
        // About where the fingers began, and moved with them as they move.
        const dx = e.focalX - f.w / 2 - p.fx;
        const dy = e.focalY - f.h / 2 - p.fy;
        scale.set(s);
        x.set(clampOffset(zoomAbout(p.fx, p.x, p.from, s) + dx, s, c.w, f.w));
        y.set(clampOffset(zoomAbout(p.fy, p.y, p.from, s) + dy, s, c.h, f.h));
      })
      .onEnd(() => {
        const f = frame.get();
        const c = fitted(f.w, f.h, shape.get());
        const s = settleScale(scale.get());
        target.set(s);
        scale.set(withTiming(s, SETTLE));
        x.set(withTiming(clampOffset(x.get(), s, c.w, f.w), SETTLE));
        y.set(withTiming(clampOffset(y.get(), s, c.h, f.h), SETTLE));
        scheduleOnRN(settled, s);
      });

    const panning = Gesture.Pan()
      .maxPointers(1)
      .minDistance(10)
      .onStart(() => {
        moving.set(!atOwnSize(scale.get()));
      })
      .onChange((e) => {
        if (moving.get()) {
          const s = scale.get();
          const f = frame.get();
          const c = fitted(f.w, f.h, shape.get());
          x.set(clampOffset(x.get() + e.changeX, s, c.w, f.w));
          y.set(clampOffset(y.get() + e.changeY, s, c.h, f.h));
          return;
        }
        const ends = edges.get();
        swipe.set(swipeFollow(e.translationX, e.translationY, ends.previous, ends.next));
      })
      .onEnd((e, success) => {
        if (moving.get()) return;
        swipe.set(withSpring(0, BOUNCE));
        if (!success) return;
        const outcome = swipeOutcome(e.translationX, e.translationY, e.velocityX, leaves);
        const ends = edges.get();
        if (outcome === 'down') scheduleOnRN(down);
        else if (outcome === 1 && ends.next) scheduleOnRN(turned, 1);
        else if (outcome === -1 && ends.previous) scheduleOnRN(turned, -1);
      });

    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .onEnd((e, success) => {
        if (!success) return;
        const f = frame.get();
        const c = fitted(f.w, f.h, shape.get());
        const from = scale.get();
        const to = atOwnSize(from) ? DOUBLE_TAP_ZOOM : MIN_ZOOM;
        target.set(to);
        const fx = e.x - f.w / 2;
        const fy = e.y - f.h / 2;
        scale.set(withTiming(to, SETTLE));
        x.set(withTiming(clampOffset(zoomAbout(fx, x.get(), from, to), to, c.w, f.w), SETTLE));
        y.set(withTiming(clampOffset(zoomAbout(fy, y.get(), from, to), to, c.h, f.h), SETTLE));
        scheduleOnRN(settled, to);
      });

    // Named for the tests, which drive them with Gesture Handler's own helpers.
    if (testID) {
      pinching.withTestId(`${testID}-pinch`);
      panning.withTestId(`${testID}-pan`);
      doubleTap.withTestId(`${testID}-double-tap`);
    }
    return Gesture.Race(doubleTap, Gesture.Simultaneous(pinching, panning));
  }, [scale, target, x, y, swipe, frame, shape, edges, pinch, moving, settled, turned, down, leaves, testID]);
  /* eslint-enable react-hooks/refs */

  const moved = useAnimatedStyle(() => ({
    transform: [{ translateX: x.get() + swipe.get() }, { translateY: y.get() }, { scale: scale.get() }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        style={[styles.frame, props.style]}
        onLayout={(e) => frame.set({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      >
        <Animated.View testID={testID} style={[styles.page, moved]}>
          {props.children}
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, overflow: 'hidden' },
  page: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
