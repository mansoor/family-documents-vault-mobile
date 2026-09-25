import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { readPrefs, writePrefs } from '../platform/prefs';

/**
 * "Save a copy" (4.12): the file from the vault, to a temporary file, to
 * the phone's own share sheet — Files, another app — and then deleted,
 * whatever happened. What is left by a crash in between is swept at the
 * next launch. The first time, it says that the copy is outside the
 * vault's protection.
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
    file.create();
    file.write(bytes);
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

/** The copy, shared and then gone from the phone. */
export async function saveCopy(bytes: Uint8Array, name: string, mime: string, io: SaveCopyIo = saveCopyIo) {
  const uri = await io.write(name, bytes);
  try {
    await io.share(uri, mime);
  } finally {
    await io.remove(uri).catch(() => undefined);
  }
}

const WARNED = 'save-copy';
export const warnedAboutCopies = () => readPrefs<{ warned: boolean }>(WARNED, { warned: false }).warned;
export const markWarnedAboutCopies = () => writePrefs(WARNED, { warned: true });
