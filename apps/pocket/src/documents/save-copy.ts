import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { readPrefs, writePrefs } from '../platform/prefs';

/**
 * "Save a copy" (4.12): the file from the vault, to a temporary file, to
 * the phone's own share sheet — Files, another app — and then deleted,
 * whatever happened: at once when it went wrong, and a minute after it was
 * handed over (the app it went to may still be reading it). What is left by
 * the app stopping in between is swept at the next launch. The first time,
 * it says that the copy is outside the vault's protection.
 */
export interface SaveCopyIo {
  write(name: string, bytes: Uint8Array): Promise<string>;
  share(uri: string, mime: string): Promise<void>;
  remove(uri: string): Promise<void>;
  sweep(): Promise<void>;
}

const folder = () => new Directory(Paths.cache, 'copies');
/** Only what a filename may safely be. */
const safeName = (name: string) => name.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'document';

export const saveCopyIo: SaveCopyIo = {
  write: async (name, bytes) => {
    const dir = folder();
    if (!dir.exists) dir.create();
    const file = new File(dir, safeName(name));
    if (file.exists) file.delete();
    try {
      file.create();
      file.write(bytes);
    } catch (err) {
      // Nothing half-written stays behind.
      if (file.exists) file.delete();
      throw err;
    }
    return file.uri;
  },
  share: async (uri, mime) => {
    await Sharing.shareAsync(uri, { mimeType: mime });
  },
  remove: async (uri) => {
    const file = new File(uri);
    if (file.exists) file.delete();
  },
  sweep: async () => {
    const dir = folder();
    if (dir.exists) dir.delete();
  },
};

/** How long a copy handed over stays, for the app it went to; the launch sweep is the backstop. */
export const copySettings = { graceMs: 60_000 };

/**
 * The copy, shared and then gone from the phone. `away` wraps the share
 * sheet: it is the app's own, not leaving the app (the lock waits).
 */
export async function saveCopy(
  bytes: Uint8Array,
  name: string,
  mime: string,
  opts: { io?: SaveCopyIo; away?: <T>(task: () => Promise<T>) => Promise<T> } = {},
) {
  const io = opts.io ?? saveCopyIo;
  const away = opts.away ?? (<T,>(task: () => Promise<T>) => task());
  const uri = await io.write(name, bytes);
  let handed = false;
  try {
    await away(() => io.share(uri, mime));
    handed = true;
  } finally {
    const remove = () => void io.remove(uri).catch(() => undefined);
    if (handed && copySettings.graceMs > 0) setTimeout(remove, copySettings.graceMs);
    else remove();
  }
}

const WARNED = 'save-copy';
export const warnedAboutCopies = () => readPrefs<{ warned: boolean }>(WARNED, { warned: false }).warned;
export const markWarnedAboutCopies = () => writePrefs(WARNED, { warned: true });
