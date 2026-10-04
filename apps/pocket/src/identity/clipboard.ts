import { Platform } from 'react-native';

/**
 * Copying an identity number (5.31): the app's own native module
 * (modules/clipboard), on Android only. The copy is marked sensitive, so
 * Android 13 and later show dots, not the number, in the preview it puts
 * over the screen and in a keyboard's clipboard suggestions; and it is
 * cleared after a minute, unless something else has been copied since.
 *
 * Two clocks clear it, each enough alone: the native one, which runs while
 * the app is at the back (where the number is pasted), and this one, which
 * runs while it is in front. Neither keeps the number anywhere: it is
 * passed to the clipboard and forgotten.
 */
export interface ClipboardPort {
  /** Puts `text` on the clipboard marked sensitive, and clears it after `clearAfterMs`; false if it could not. */
  copySensitive(text: string, clearAfterMs: number): boolean;
  /** Clears the clipboard, unless what is on it now is somebody else's copy; true if it cleared. */
  clearIfOurs(): boolean;
}

/** How long a copied number stays on the clipboard. */
export const CLEAR_AFTER_MS = 60_000;

let found: ClipboardPort | null | undefined;

/** The module, or null where there is none (an iPhone, the web build, the tests): Copy is not offered. */
export function nativeClipboard(): ClipboardPort | null {
  if (found !== undefined) return found;
  found = null;
  if (Platform.OS !== 'android') return found;
  try {
    // Loaded when first asked for: the tests and the web build never do.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { requireOptionalNativeModule } = require('expo') as typeof import('expo');
    found = requireOptionalNativeModule<ClipboardPort>('FdvClipboard');
  } catch {
    found = null;
  }
  return found;
}

let timer: ReturnType<typeof setTimeout> | null = null;

/** Copies a number for a minute: marked sensitive, then cleared. False if the phone would not copy it. */
export function copyForAMinute(port: ClipboardPort, value: string): boolean {
  let copied = false;
  try {
    copied = port.copySensitive(value, CLEAR_AFTER_MS);
  } catch {
    copied = false;
  }
  if (!copied) return false;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    try {
      port.clearIfOurs();
    } catch {
      // The native clock clears it too.
    }
  }, CLEAR_AFTER_MS);
  return true;
}
