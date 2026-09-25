import type { SqlDb } from '../queue/sqlite-store';

/**
 * expo-sqlite's database, as far as the queue uses it, over Node's own
 * SQLite: the queue's SQL runs for real in the tests. Node's SQLite has no
 * SQLCipher, and ignores PRAGMA key like any pragma it does not know.
 */
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

export function nodeSqlDb(path = ':memory:'): SqlDb & { close(): void } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
  const db = new DatabaseSync(path);
  const plain = (row: unknown) =>
    row && typeof row === 'object'
      ? Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Uint8Array ? new Uint8Array(v) : v]))
      : row;
  return {
    async execAsync(source) {
      db.exec(source);
    },
    async runAsync(source, params) {
      await tick();
      return db.prepare(source).run(...params);
    },
    async getAllAsync<T>(source: string, params: (string | number | null | Uint8Array)[]) {
      return db
        .prepare(source)
        .all(...params)
        .map(plain) as T[];
    },
    async getFirstAsync<T>(source: string, params: (string | number | null | Uint8Array)[]) {
      return (plain(db.prepare(source).get(...params)) ?? null) as T | null;
    },
    // As expo-sqlite does it: BEGIN inside the try, each step a turn of
    // the event loop, and ROLLBACK on any failure — so overlapping
    // transactions on the one connection fail here as they would there.
    async withTransactionAsync(task) {
      try {
        await tick();
        db.exec('begin');
        await task();
        await tick();
        db.exec('commit');
      } catch (err) {
        try {
          db.exec('rollback');
        } catch {
          // Nothing to roll back.
        }
        throw err;
      }
    },
    close: () => db.close(),
  };
}
