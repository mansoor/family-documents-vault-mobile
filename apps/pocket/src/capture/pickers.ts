import { claimedRecordFormat } from '@fdv/shared';
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

/**
 * Health records kept as they are (the vault's 0.9.0-dev.51, H5): a C-CDA
 * document (XML), a FHIR export (JSON), a DICOM image or a ZIP of them, as
 * a phone's files app may call them. Offered only where the vault takes them.
 */
export const RECORD_TYPES = [
  'application/xml',
  'text/xml',
  'application/json',
  'application/fhir+json',
  'application/dicom',
  'application/zip',
  'application/x-zip-compressed',
  // A hospital CD's DICOM image has no ending (IM00001): the phone calls it this, and the vault knows it
  // from its bytes, as the web's picker leaves it to (a file that is nothing it keeps is refused, and said).
  'application/octet-stream',
];

/**
 * A file's type from its name, when the picker could not say. Where the
 * vault takes health records, one is the type the vault keeps it as
 * (`text/xml` is XML; a `.json` the phone calls plain text is JSON), as the
 * web's picker reads them; the vault checks the bytes bear it out.
 */
export function mimeOf(name: string, reported?: string | null, records = false): string {
  const record = records ? claimedRecordFormat(reported ?? '', name) : null;
  if (record) return record;
  if (reported && reported !== 'application/octet-stream') return reported;
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? '';
  return BY_EXTENSION[ext] ?? 'application/octet-stream';
}

/** A picker that fails (one already open, a file it cannot copy) has simply not picked anything. */
export async function pickFile(opts: { records?: boolean } = {}): Promise<ScanOutcome> {
  const records = opts.records === true;
  let r: DocumentPicker.DocumentPickerResult;
  try {
    r = await DocumentPicker.getDocumentAsync({
      type: records ? [...ACCEPTED, ...RECORD_TYPES] : ACCEPTED,
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
      mime: mimeOf(a.name, a.mimeType, records),
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
