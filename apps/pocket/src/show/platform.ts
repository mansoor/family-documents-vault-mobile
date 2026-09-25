import { screenReaderOf, type ShowPlatform } from './types';

export type { ShowPlatform } from './types';

/** The web build: none of it, beyond the screen reader. */
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
