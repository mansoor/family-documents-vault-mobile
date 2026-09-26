import { Directory, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { on } from '../state/events';

/**
 * What the phone's HTTP stack kept of the vault's answers, gone.
 *
 * The app's fetch (expo/fetch) runs on React Native's OkHttp client, which
 * keeps a disk cache in the app's cache folder (`http-cache`) and ignores
 * `cache: 'no-store'`. Up to app 0.1.10, with a vault before 0.5.0, it
 * stored every answer it was allowed to — lists of documents and people
 * among them — and kept them past a sign-out. Nothing is stored now (every
 * request says `no-cache, no-store`, and the vault says `no-store`), so
 * this only removes what was. Never in the way of starting or signing out.
 */
export function forgetHttpCache(): void {
  if (Platform.OS !== 'android') return;
  try {
    const dir = new Directory(Paths.cache, 'http-cache');
    if (dir.exists) dir.delete();
  } catch {
    // Android may have cleared it already; either way there is nothing to do.
  }
}

/** Forget it now, and again whenever a session ends here. */
export function watchHttpCache(): () => void {
  forgetHttpCache();
  const offOut = on('signedOut', forgetHttpCache);
  const offEnded = on('sessionEnded', forgetHttpCache);
  return () => {
    offOut();
    offEnded();
  };
}
