import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import type { ScanOutcome } from './scanner';

/** The kinds of file the vault keeps. */
export const ACCEPTED = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
  'image/tiff',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

const BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  heic: 'image/heic',
  heif: 'image/heif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  docx: ACCEPTED[6] as string,
  xlsx: ACCEPTED[7] as string,
};

/** A file's type from its name, when the picker could not say. */
export function mimeOf(name: string, reported?: string | null): string {
  if (reported && reported !== 'application/octet-stream') return reported;
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? '';
  return BY_EXTENSION[ext] ?? 'application/octet-stream';
}

/** A picker that fails (one already open, a file it cannot copy) has simply not picked anything. */
export async function pickFile(): Promise<ScanOutcome> {
  let r: DocumentPicker.DocumentPickerResult;
  try {
    r = await DocumentPicker.getDocumentAsync({
      type: ACCEPTED,
      copyToCacheDirectory: true,
      multiple: false,
    });
  } catch {
    return { kind: 'cancelled' };
  }
  const a = r.canceled ? undefined : r.assets[0];
  if (!a) return { kind: 'cancelled' };
  return {
    kind: 'file',
    file: {
      uri: a.uri,
      name: a.name,
      mime: mimeOf(a.name, a.mimeType),
      size: a.size ?? null,
    },
  };
}

export async function pickPhoto(): Promise<ScanOutcome> {
  let r: ImagePicker.ImagePickerResult;
  try {
    r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      allowsMultipleSelection: false,
    });
  } catch {
    return { kind: 'cancelled' };
  }
  const a = r.canceled ? undefined : r.assets[0];
  if (!a) return { kind: 'cancelled' };
  const name = a.fileName ?? `Photo.${a.mimeType === 'image/png' ? 'png' : 'jpg'}`;
  return {
    kind: 'file',
    file: {
      uri: a.uri,
      name,
      mime: mimeOf(name, a.mimeType),
      size: a.fileSize ?? null,
    },
  };
}
