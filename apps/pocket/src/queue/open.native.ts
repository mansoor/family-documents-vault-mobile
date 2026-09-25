import { deleteDatabaseAsync, openDatabaseAsync } from 'expo-sqlite';
import { log } from '../log';
import { secureDelete } from '../platform/secure';
import { QUEUE_KEY, queueKey } from './key';
import { SqliteQueueStore, type SqlDb } from './sqlite-store';
import type { QueueStore } from './store';

const NAME = 'queue.db';

async function keyed(hex: string): Promise<SqlDb> {
  const db = await openDatabaseAsync(NAME);
  try {
    // First, before anything else touches the file.
    await db.execAsync(`PRAGMA key = "x'${hex}'";`);
    await db.execAsync('PRAGMA secure_delete = ON; PRAGMA temp_store = MEMORY;');
    // Reading anything proves the key: a wrong one fails here.
    await db.getFirstAsync('select count(*) as n from sqlite_master');
    return db as unknown as SqlDb;
  } catch (err) {
    await db.closeAsync().catch(() => undefined);
    throw err;
  }
}

/** SQLite's own words for a file that is not a database under this key (SQLITE_NOTADB). */
const notADatabase = (err: unknown) =>
  /file is not a database/i.test(String((err as Error | undefined)?.message ?? err));

/** The queue key; a keystore entry that cannot be read is a key that is gone. */
async function readKey(): Promise<{ hex: string; made: boolean }> {
  try {
    return await queueKey();
  } catch {
    log.error('queue.key_unreadable', {});
    await secureDelete(QUEUE_KEY).catch(() => undefined);
    return queueKey();
  }
}

/**
 * The phone's queue: queue.db under the queue key. When the key is new (a
 * first run, or a keystore that was wiped) any queue.db from before cannot
 * be read by anybody, so it is removed and a new one made; the same when
 * SQLite says the file is not a database under the key it has. Any other
 * failure — busy, I/O, out of space — leaves queue.db alone and is thrown:
 * the next try may well open it, with every scan still in it. (The web
 * build's queue is memory: open.ts.)
 */
export async function openQueue(): Promise<QueueStore> {
  const { hex, made } = await readKey();
  if (made) await deleteDatabaseAsync(NAME).catch(() => undefined);
  let db: SqlDb;
  try {
    db = await keyed(hex);
  } catch (err) {
    if (!notADatabase(err)) throw err;
    log.error('queue.unreadable', {});
    await deleteDatabaseAsync(NAME).catch(() => undefined);
    db = await keyed(hex);
  }
  return SqliteQueueStore.over(db);
}
