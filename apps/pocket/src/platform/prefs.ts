import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

/**
 * Things the app remembers that are not secret: which vault it connects
 * to, which http vaults the person approved and their installation ids,
 * Large text. A JSON file in the app's own documents folder (never backed
 * up: see with-data-extraction); localStorage on the web build.
 */
const web = Platform.OS === 'web';

/**
 * A name as a file name: what a file name may not hold made an underscore
 * (R4: a vault's address in a name, "http://…|…", threw on Android and
 * took Home down with it). Every plain name stays as it is.
 */
export const fileNameOf = (name: string) => `${name.replace(/[^A-Za-z0-9._-]/g, '_')}.json`;

export function readPrefs<T>(name: string, fallback: T): T {
  try {
    if (web) {
      const raw = globalThis.localStorage?.getItem(`prefs.${name}`);
      return raw ? (JSON.parse(raw) as T) : fallback;
    }
    const f = new File(Paths.document, fileNameOf(name));
    return f.exists ? (JSON.parse(f.textSync()) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writePrefs(name: string, value: unknown): void {
  const text = JSON.stringify(value);
  if (web) {
    globalThis.localStorage?.setItem(`prefs.${name}`, text);
    return;
  }
  const f = new File(Paths.document, fileNameOf(name));
  if (f.exists) f.delete();
  f.create();
  f.write(text);
}

/** True once per installation: the first launch after the app was installed. */
export function firstLaunch(): boolean {
  if (web) return false;
  const marker = new File(Paths.document, 'installed');
  if (marker.exists) return false;
  marker.create();
  return true;
}
