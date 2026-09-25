import { AccessibilityInfo } from 'react-native';

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
  screenReader(): Promise<boolean>;
  onScreenReader(listener: (on: boolean) => void): () => void;
}

export function screenReaderOf(): Pick<ShowPlatform, 'screenReader' | 'onScreenReader'> {
  return {
    screenReader: () => AccessibilityInfo.isScreenReaderEnabled(),
    onScreenReader: (listener) => {
      const sub = AccessibilityInfo.addEventListener('screenReaderChanged', listener);
      return () => sub.remove();
    },
  };
}

export function defaultShowPlatform(): ShowPlatform {
  return {
    brightness: async () => 1,
    setBrightness: async () => undefined,
    restoreBrightness: async () => undefined,
    keepAwake: async () => undefined,
    orientation: async () => undefined,
    immersive: async () => undefined,
    ...screenReaderOf(),
  };
}
