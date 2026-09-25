import * as ScreenCapture from 'expo-screen-capture';
import type { ScreenGuardPort } from './types';

/**
 * expo-screen-capture: FLAG_SECURE on Android, which also blanks the app in
 * the recent apps view. It counts the names that ask, and protects the
 * screen while any does.
 */
export function defaultScreenGuard(): ScreenGuardPort {
  return {
    prevent: (name) => ScreenCapture.preventScreenCaptureAsync(name).catch(() => undefined),
    allow: (name) => ScreenCapture.allowScreenCaptureAsync(name).catch(() => undefined),
  };
}
