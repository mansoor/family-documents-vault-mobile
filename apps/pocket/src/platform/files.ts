import { File } from 'expo-file-system';
import { Platform } from 'react-native';

/**
 * The scanner's and the pickers' files: read once into the queue, then
 * deleted. On the web build a picked file is a blob: URL.
 */
const web = Platform.OS === 'web';

export async function readBytes(uri: string): Promise<Uint8Array> {
  if (web) return new Uint8Array(await (await fetch(uri)).arrayBuffer());
  return new File(uri).bytes();
}

/** Deletes a file the scanner or a picker left behind; never throws. */
export async function discard(uri: string): Promise<void> {
  try {
    if (web) {
      if (uri.startsWith('blob:')) URL.revokeObjectURL(uri);
      return;
    }
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // Already gone, or not ours to delete: the OS clears the cache in time.
  }
}
