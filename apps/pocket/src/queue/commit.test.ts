import { rmSync } from 'fs';
import { tmpdir } from 'os';
import { PDFDocument } from 'pdf-lib';
import { captureVault, jpeg } from '../test-support/capture';
import { nodeSqlDb } from '../test-support/node-sqlite';
import { commitCapture, CommitError, MAX_PHONE_FILE_BYTES, scanFilename, type CommitDeps } from './commit';
import { SqliteQueueStore } from './sqlite-store';
import { MemoryQueueStore, type QueueStore } from './store';
import { Uploader } from './uploader';

/** The phone's files, as far as a commit sees them. */
function phone(store: QueueStore, files: Record<string, Uint8Array>) {
  const disk = new Map(Object.entries(files));
  let n = 0;
  const deps: CommitDeps = {
    store,
    read: async (uri) => {
      const f = disk.get(uri);
      if (!f) throw new Error(`no such file ${uri}`);
      return f;
    },
    discard: async (uri) => {
      disk.delete(uri);
    },
    uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    now: () => 1_000,
  };
  return { deps, disk };
}

const PAGES = {
  'cache:/scan/1.jpg': jpeg('letter-with-exif.jpg'),
  'cache:/scan/2.jpg': jpeg('card.jpg'),
};

describe('commit', () => {
  it('one capture has one key, made at Save and reused for every retry', async () => {
    const store = new MemoryQueueStore();
    const { deps } = phone(store, PAGES);
    const item = await commitCapture(
      {
        source: {
          kind: 'pages',
          pages: [{ uri: 'cache:/scan/1.jpg' }, { uri: 'cache:/scan/2.jpg' }],
        },
        metadata: { type_key: 'passport', title: "Aisha's passport" },
        origin: 'https://vault.test',
        account: 'fake-member',
      },
      deps,
    );
    // Two tries: the first never reaches the vault.
    const cv = await captureVault();
    cv.turns.push('offline');
    const keys: string[] = [];
    let now = 0;
    const uploader = new Uploader(
      cv.deps(store, {
        now: () => now,
        send: async (i, bytes) => {
          keys.push(i.key);
          return cv.deps(store).send(i, bytes);
        },
        status: async (i) => {
          keys.push(i.key);
          return cv.deps(store).status(i);
        },
      }),
    );
    await uploader.kick();
    now = 60_000;
    await uploader.kick();
    // Sent, asked about, sent again: always the same key.
    expect(keys).toEqual([item.key, item.key, item.key]);
    expect(cv.vault.state.documents).toHaveLength(1);
    expect(await store.list()).toEqual([]);
  });

  it('the key survives a restart', async () => {
    // queue.db's own SQL, closed and opened again as a restart would.
    const path = `${tmpdir()}/fdv-queue-${Date.now()}.db`;
    const first = nodeSqlDb(path);
    const store = await SqliteQueueStore.over(first);
    const { deps } = phone(store, PAGES);
    const item = await commitCapture(
      {
        source: { kind: 'pages', pages: [{ uri: 'cache:/scan/1.jpg' }] },
        metadata: null,
        origin: 'https://vault.test',
        account: 'fake-member',
      },
      deps,
    );
    first.close();

    const again = nodeSqlDb(path);
    const reopened = await SqliteQueueStore.over(again);
    const [kept] = await reopened.list();
    expect(kept?.key).toBe(item.key);
    const pdf = await PDFDocument.load((await reopened.bytes(item.id)) as Uint8Array);
    expect(pdf.getPageCount()).toBe(1);
    again.close();
    rmSync(path, { force: true });
  });

  it('scanner temp files are gone after commit', async () => {
    const store = new MemoryQueueStore();
    const { deps, disk } = phone(store, PAGES);
    await commitCapture(
      {
        source: {
          kind: 'pages',
          pages: [{ uri: 'cache:/scan/1.jpg' }, { uri: 'cache:/scan/2.jpg' }],
        },
        metadata: null,
        origin: 'https://vault.test',
        account: 'fake-member',
      },
      deps,
    );
    expect([...disk.keys()]).toEqual([]);
    const [item] = await store.list();
    expect(item).toMatchObject({
      filename: 'Scan.pdf',
      mime: 'application/pdf',
      state: 'waiting',
      metadata: null,
    });
    const pdf = await PDFDocument.load((await store.bytes(item?.id ?? '')) as Uint8Array);
    expect(pdf.getPageCount()).toBe(2);
  });

  it('a picked file goes as it is, under its own name', async () => {
    const store = new MemoryQueueStore();
    const docx = new Uint8Array([0x50, 0x4b, 3, 4]);
    const { deps, disk } = phone(store, { 'cache:/picked/lease.docx': docx });
    const item = await commitCapture(
      {
        source: {
          kind: 'file',
          file: {
            uri: 'cache:/picked/lease.docx',
            name: 'Lease.docx',
            mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            size: 4,
          },
        },
        metadata: { title: 'Lease' },
        origin: 'https://vault.test',
        account: 'fake-member',
      },
      deps,
    );
    expect(item).toMatchObject({ filename: 'Lease.docx', size: 4 });
    expect(await store.bytes(item.id)).toEqual(docx);
    expect(disk.size).toBe(0);
  });

  it('a file over 25 MB is refused before anything is kept', async () => {
    const store = new MemoryQueueStore();
    const { deps, disk } = phone(store, {
      'cache:/picked/big.pdf': new Uint8Array(1),
    });
    await expect(
      commitCapture(
        {
          source: {
            kind: 'file',
            file: {
              uri: 'cache:/picked/big.pdf',
              name: 'big.pdf',
              mime: 'application/pdf',
              size: MAX_PHONE_FILE_BYTES + 1,
            },
          },
          metadata: null,
          origin: 'https://vault.test',
          account: 'fake-member',
        },
        deps,
      ),
    ).rejects.toEqual(new CommitError('too_big'));
    expect(await store.list()).toEqual([]);
    // Left for the person to choose again, or to go with the picker's own clean-up.
    expect(disk.size).toBe(1);
  });

  it('a phone out of space says so, and keeps the scan to try again', async () => {
    class Full extends MemoryQueueStore {
      override async add(): Promise<void> {
        throw new Error('database or disk is full');
      }
    }
    const full = new Full();
    const { deps, disk } = phone(full, PAGES);
    await expect(
      commitCapture(
        {
          source: { kind: 'pages', pages: [{ uri: 'cache:/scan/1.jpg' }] },
          metadata: null,
          origin: 'https://vault.test',
          account: 'fake-member',
        },
        deps,
      ),
    ).rejects.toEqual(new CommitError('no_space'));
    expect(disk.has('cache:/scan/1.jpg')).toBe(true);
  });

  it('names the PDF after the document, safely', () => {
    expect(scanFilename("Aisha's passport")).toBe("Aisha's passport.pdf");
    expect(scanFilename('Bills: 2026/09')).toBe('Bills 2026 09.pdf');
    expect(scanFilename(null)).toBe('Scan.pdf');
    expect(scanFilename('   ')).toBe('Scan.pdf');
  });
});
