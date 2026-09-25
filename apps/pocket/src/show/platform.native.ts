import * as Brightness from 'expo-brightness';
import * as KeepAwake from 'expo-keep-awake';
import * as NavigationBar from 'expo-navigation-bar';
import * as ScreenOrientation from 'expo-screen-orientation';
import { Platform } from 'react-native';
// Not './platform': on the phone that name is this very file (a self-import
// that left defaultShowPlatform throwing, found in 4.11's review).
import { screenReaderOf, type ShowPlatform } from './types';

export type { ShowPlatform } from './types';

const TAG = 'fdv-show';

/**
 * The phone's own. Brightness is the app's window only (never the system
 * setting): on Android, restoring hands it back to the system's value; on
 * iOS the screen's brightness is the system's, so the value saved before
 * is set again.
 */
export function defaultShowPlatform(): ShowPlatform {
  return {
    brightness: () => Brightness.getBrightnessAsync(),
    setBrightness: (value) => Brightness.setBrightnessAsync(value),
    restoreBrightness: (saved) =>
      Platform.OS === 'android' ? Brightness.restoreSystemBrightnessAsync() : Brightness.setBrightnessAsync(saved),
    keepAwake: async (on) => {
      if (on) await KeepAwake.activateKeepAwakeAsync(TAG);
      else await KeepAwake.deactivateKeepAwake(TAG);
    },
    orientation: async (to) => {
      if (to === 'free') await ScreenOrientation.unlockAsync();
      else
        await ScreenOrientation.lockAsync(
          to === 'landscape'
            ? ScreenOrientation.OrientationLock.LANDSCAPE
            : ScreenOrientation.OrientationLock.PORTRAIT_UP,
        );
    },
    immersive: async (on) => {
      if (Platform.OS !== 'android') return;
      await NavigationBar.setVisibilityAsync(on ? 'hidden' : 'visible');
    },
    ...screenReaderOf(),
  };
}
