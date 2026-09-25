import { deleteDatabaseAsync, openDatabaseAsync } from 'expo-sqlite';
import type { SqlDb } from '../queue/sqlite-store';
import { SqliteEssentialsStore } from './sqlite-store';
import type { EssentialsStore } from './store';

export type Tier = 'everyday' | 'private';
const NAMES: Record<Tier, string> = { everyday: 'essentials.db', private: 'essentials-private.db' };

/**
 * One of the offline stores, under its key: SQLCipher with the raw key,
 * temporary tables in memory only, and deleted rows overwritten. A file
 * that is not a database under this key (its key was lost, or replaced)
 * cannot be read by anybody: it is removed and made again, empty, to be
 * filled online.
 */
export async function openEssentials(tier: Tier, hex: string): Promise<EssentialsStore> {
  const keyed = async (): Promise<SqlDb> => {
    const db = await openDatabaseAsync(NAMES[tier]);
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
  };
  let db: SqlDb;
  try {
    db = await keyed();
  } catch (err) {
    if (!/file is not a database/i.test(String((err as Error | undefined)?.message ?? err))) throw err;
    await deleteDatabaseAsync(NAMES[tier]).catch(() => undefined);
    db = await keyed();
  }
  return SqliteEssentialsStore.over(db);
}

/** Gone: the Only me copies after an enrolment change, or everything on a new installation. */
export async function deleteEssentials(tier: Tier): Promise<void> {
  await deleteDatabaseAsync(NAMES[tier]).catch(() => undefined);
}
