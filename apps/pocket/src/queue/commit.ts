import type { CaptureMetadata } from '@fdv/shared';
import { buildPdf, type JpegPage } from '../pdf/build';
import { jpegSize } from '../pdf/jpeg-size';
import type { QueueItem } from './item';
import type { QueueStore } from './store';

/** A page the scanner made: a JPEG file in the app's cache. */
export interface PageRef {
  uri: string;
}

/** A file chosen from the phone: a photo, a PDF, a Word or Excel file. */
export interface PickedFile {
  uri: string;
  name: string;
  mime: string;
  /** As the picker reported it; null when it could not say. */
  size: number | null;
}

export type CaptureSource = { kind: 'pages'; pages: PageRef[] } | { kind: 'file'; file: PickedFile };

/** One PDF holds at most this many pages; Add page stops there. */
export const MAX_PAGES = 20;
/** The largest file the phone takes; bigger ones are added from a computer. */
export const MAX_PHONE_FILE_BYTES = 25 * 1024 * 1024;

export type CommitProblem = 'too_big' | 'too_many_pages' | 'no_space' | 'unreadable';

export class CommitError extends Error {
  constructor(
    readonly problem: CommitProblem,
    cause?: unknown,
  ) {
    super(problem);
    this.name = 'CommitError';
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

export interface CommitDeps {
  store: QueueStore;
  read(uri: string): Promise<Uint8Array>;
  /** Deletes a file the scanner or the picker left; never throws. */
  discard(uri: string): Promise<void>;
  uuid(): string;
  now(): number;
}

/** The URIs a capture's source leaves behind on the phone. */
export function sourceFiles(source: CaptureSource): string[] {
  return source.kind === 'pages' ? source.pages.map((p) => p.uri) : [source.file.uri];
}

const UNSAFE = /[\\/:*?"<>|\u0000-\u001f]+/g;

/** A file name from the document's name: what the vault shows as the original's. */
export function scanFilename(title: string | null | undefined): string {
  const base = (title ?? '').replace(UNSAFE, ' ').replace(/\s+/g, ' ').trim().slice(0, 100).trim();
  return `${base || 'Scan'}.pdf`;
}

/**
 * Save (or Skip): the scan becomes one queue item — one PDF of its pages,
 * or the picked file as it is — with the card's details and an idempotency
 * key made here, once. Then the scanner's and the picker's own copies are
 * deleted: from now on the scan exists only in the encrypted queue, until
 * the vault has it.
 */
export async function commitCapture(
  input: {
    source: CaptureSource;
    metadata: CaptureMetadata | null;
    origin: string;
    account: string;
    /** A new version of this document (a renewal), rather than a new document. */
    renews?: string | null;
    /** The card's names for the type's own details it sends, by field key. */
    labels?: Record<string, string> | null;
  },
  deps: CommitDeps,
): Promise<QueueItem> {
  const { source, metadata, labels } = input;
  let bytes: Uint8Array;
  let filename: string;
  let mime: string;
  if (source.kind === 'pages') {
    if (source.pages.length === 0 || source.pages.length > MAX_PAGES) throw new CommitError('too_many_pages');
    let pages: JpegPage[];
    try {
      pages = await Promise.all(
        source.pages.map(async (p) => {
          const jpeg = await deps.read(p.uri);
          return { bytes: jpeg, ...jpegSize(jpeg) };
        }),
      );
    } catch (err) {
      throw new CommitError('unreadable', err);
    }
    bytes = await buildPdf(pages);
    filename = scanFilename(metadata?.title);
    mime = 'application/pdf';
  } else {
    if (source.file.size !== null && source.file.size > MAX_PHONE_FILE_BYTES) throw new CommitError('too_big');
    try {
      bytes = await deps.read(source.file.uri);
    } catch (err) {
      throw new CommitError('unreadable', err);
    }
    if (bytes.length > MAX_PHONE_FILE_BYTES) throw new CommitError('too_big');
    filename = source.file.name.replace(UNSAFE, ' ').trim() || 'File';
    mime = source.file.mime || 'application/octet-stream';
  }

  const item: QueueItem = {
    id: deps.uuid(),
    kind: input.renews ? 'version' : 'capture',
    target: input.renews ?? null,
    key: deps.uuid(),
    origin: input.origin,
    account: input.account,
    createdAt: deps.now(),
    state: 'waiting',
    metadata,
    filename,
    mime,
    size: bytes.length,
    attempts: 0,
    nextAt: 0,
    askFirst: false,
    problem: null,
    lastCode: null,
    ...(labels && Object.keys(labels).length > 0 ? { labels } : {}),
  };
  try {
    await deps.store.add(item, bytes);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new CommitError(/full|ENOSPC|no space/i.test(message) ? 'no_space' : 'unreadable', err);
  }
  await Promise.all(sourceFiles(source).map((uri) => deps.discard(uri)));
  return item;
}
