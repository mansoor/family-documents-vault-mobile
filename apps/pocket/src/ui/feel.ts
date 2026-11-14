import * as Haptics from 'expo-haptics';
import { AccessibilityInfo } from 'react-native';
import { useEffect, useState } from 'react';

/**
 * What the phone feels like when something is done (P10): a short buzz on
 * Save, on a scan taken, and on Done. Never the only sign — each is said in
 * words on the screen too — and the phone's own touch-feedback setting
 * decides whether it is felt at all. A phone without it, or the web build,
 * feels nothing and goes on.
 *
 *  - `done`: something kept (Save, a reminder Done).
 *  - `tap`: something taken in (a scan's pages, a page added).
 */
export function feel(kind: 'done' | 'tap'): void {
  try {
    const felt =
      kind === 'done'
        ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void Promise.resolve(felt).catch(() => undefined);
  } catch {
    // Not on this phone: nothing to feel.
  }
}

/**
 * Whether the phone asks for less movement (Android's "Remove animations",
 * iOS's Reduce Motion), as it is now and as it changes (P10): screens then
 * change at once, and sheets appear without fading in.
 *
 * Each use starts from what the phone last said, and asks again. Asking
 * takes a moment: a menu opened before the answer came would start to move
 * and then be told to stand still mid-way, which once left the +'s choices
 * drawn but unseen on a busy phone (the Maestro run of 14 Nov 2026).
 */
let lastKnown = false;

export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(lastKnown);
  useEffect(() => {
    let live = true;
    const set = (on: boolean) => {
      lastKnown = on;
      if (live) setReduce(on);
    };
    AccessibilityInfo.isReduceMotionEnabled()
      .then(set)
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', set);
    return () => {
      live = false;
      sub?.remove();
    };
  }, []);
  return reduce;
}
