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
 */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => {
        if (live) setReduce(on);
      })
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      live = false;
      sub?.remove();
    };
  }, []);
  return reduce;
}
