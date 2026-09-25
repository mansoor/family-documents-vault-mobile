import { AccessibilityInfo, Platform } from 'react-native';

/**
 * What Show mode (4.11) does to the phone: the screen's brightness, staying
 * awake, turning with the phone, the system bars — and whether a screen
 * reader is on. The phone's own in platform.native.ts; the web build only
 * knows about the screen reader.
 */
export interface ShowPlatform {
  /** The screen's brightness now (0 to 1). */
  brightness(): Promise<number>;
  setBrightness(value: number): Promise<void>;
  /** Back to what it was: the system's own on Android, the value saved elsewhere. */
  restoreBrightness(saved: number): Promise<void>;
  keepAwake(on: boolean): Promise<void>;
  /** Free to turn with the phone, or held landscape or portrait. */
  orientation(to: 'free' | 'landscape' | 'portrait'): Promise<void>;
  /** The navigation bar hidden (true) or back (false); the status bar is the screen's own. */
  immersive(on: boolean): Promise<void>;
  /** A screen reader, or (Android) any service that works the screen for the person — Switch Access, Voice Access. */
  screenReader(): Promise<boolean>;
  onScreenReader(listener: (on: boolean) => void): () => void;
}

export function screenReaderOf(): Pick<ShowPlatform, 'screenReader' | 'onScreenReader'> {
  const now = async (): Promise<boolean> => {
    if (await AccessibilityInfo.isScreenReaderEnabled()) return true;
    return Platform.OS === 'android' ? AccessibilityInfo.isAccessibilityServiceEnabled() : false;
  };
  return {
    screenReader: now,
    // Services are turned on in the phone's settings — leaving the app, which
    // ends Show mode — so the screen reader's changes are the ones to follow.
    onScreenReader: (listener) => {
      const sub = AccessibilityInfo.addEventListener('screenReaderChanged', () => {
        void now().then(listener, () => undefined);
      });
      return () => sub.remove();
    },
  };
}
