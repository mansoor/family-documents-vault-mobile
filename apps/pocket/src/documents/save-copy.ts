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
 *
 * A download as one ZIP (DL) can be as big as the vault allows (1 GB), so it
 * never passes through the app's memory: `download` streams it from a
 * one-time address straight into the same folder (expo-file-system's native
 * download), and it is then handed over and deleted the same way.
 */
export interface SaveCopyIo {
  write(name: string, bytes: Uint8Array): Promise<string>;
  /**
   * Streams `url` into a file of the copies folder named `name`, never
   * through the app's memory. Fails with DownloadFailed, nothing left behind.
   */
  download(url: string, name: string): Promise<string>;
  share(uri: string, mime: string): Promise<void>;
  remove(uri: string): Promise<void>;
  sweep(): Promise<void>;
}

const folder = () => new Directory(Paths.cache, 'copies');

/**
 * A download that did not finish: the vault's answer, when it gave one
 * (`status`: a ticket used or run out is 404), or none when the connection
 * went part-way (or never came).
 */
export class DownloadFailed extends Error {
  constructor(readonly status: number | null) {
    super(status === null ? 'The download did not finish.' : `The vault answered ${status}.`);
    this.name = 'DownloadFailed';
  }
}

/** The status in the native module's "Unable to download a file: response has status: 404", if any. */
export function statusOf(err: unknown): number | null {
  const m = /status:?\s*(\d{3})/i.exec(err instanceof Error ? err.message : String(err));
  return m ? Number(m[1]) : null;
}
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
  download: async (url, name) => {
    const dir = folder();
    if (!dir.exists) dir.create();
    const file = new File(dir, safeName(name));
    if (file.exists) file.delete();
    try {
      // Native, straight to disk: the bytes never cross into JavaScript.
      await File.downloadFileAsync(url, file, { idempotent: true });
    } catch (err) {
      // Android writes as it goes: half a ZIP never stays behind.
      if (file.exists) file.delete();
      throw new DownloadFailed(statusOf(err));
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
  const uri = await io.write(name, bytes);
  await handOver(uri, mime, opts);
}

/**
 * A file already in the copies folder, to the share sheet, then gone: at
 * once when that went wrong, a minute after it was handed over.
 */
export async function handOver(
  uri: string,
  mime: string,
  opts: { io?: SaveCopyIo; away?: <T>(task: () => Promise<T>) => Promise<T> } = {},
) {
  const io = opts.io ?? saveCopyIo;
  const away = opts.away ?? (<T,>(task: () => Promise<T>) => task());
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
