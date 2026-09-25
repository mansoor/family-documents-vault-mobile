import type { SqlDb } from '../queue/sqlite-store';
import type { EssentialsStore, OfflineDocument, OfflineOpenRecord } from './store';

/**
 * The stores' schema, one step per app version that changes it, applied in
 * order and counted in PRAGMA user_version (as queue.db's is).
 */
const STEPS = [
  `create table if not exists offline_document (
     id text primary key,
     version_id text not null,
     view text not null,
     pages integer not null,
     kept_at integer not null
   );
   create table if not exists offline_page (
     version_id text not null,
     n integer not null,
     jpeg blob not null,
     primary key (version_id, n)
   );
   create table if not exists offline_open (
     document_id text not null,
     at integer not null
   );
   create table if not exists sync_state (
     key text primary key,
     value text not null
   );`,
  // 0.1.5: an opening carries what the vault is told — its own id, the
  // version, how it was opened and whether there was a connection. Nothing
  // wrote the old table.
  `drop table if exists offline_open;
   create table offline_open (
     id text primary key,
     document_id text not null,
     version_id text not null,
     at integer not null,
     mode text not null check (mode in ('view', 'show')),
     online integer not null
   );`,
];

export class SqliteEssentialsStore implements EssentialsStore {
  private constructor(private readonly db: SqlDb) {}

  static async over(db: SqlDb): Promise<SqliteEssentialsStore> {
    const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []);
    for (let v = row?.user_version ?? 0; v < STEPS.length; v += 1) {
      const step = STEPS[v] as string;
      await db.withTransactionAsync(async () => {
        await db.execAsync(step);
        await db.execAsync(`PRAGMA user_version = ${v + 1}`);
      });
    }
    return new SqliteEssentialsStore(db);
  }

  documents() {
    return this.db.getAllAsync<OfflineDocument>('select * from offline_document order by id', []);
  }

  document(id: string) {
    return this.db.getFirstAsync<OfflineDocument>('select * from offline_document where id = ?', [id]);
  }

  async putDocument(doc: OfflineDocument) {
    await this.db.withTransactionAsync(async () => {
      // A new version's pages replace the old version's.
      await this.db.runAsync(
        `delete from offline_page where version_id in
           (select version_id from offline_document where id = ? and version_id <> ?)`,
        [doc.id, doc.version_id],
      );
      await this.db.runAsync(
        `insert into offline_document (id, version_id, view, pages, kept_at) values (?, ?, ?, ?, ?)
           on conflict (id) do update set version_id = excluded.version_id, view = excluded.view,
             pages = excluded.pages, kept_at = excluded.kept_at`,
        [doc.id, doc.version_id, doc.view, doc.pages, doc.kept_at],
      );
    });
  }

  async removeDocument(id: string) {
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(
        'delete from offline_page where version_id in (select version_id from offline_document where id = ?)',
        [id],
      );
      await this.db.runAsync('delete from offline_document where id = ?', [id]);
    });
  }

  async page(versionId: string, n: number) {
    const row = await this.db.getFirstAsync<{ jpeg: Uint8Array }>(
      'select jpeg from offline_page where version_id = ? and n = ?',
      [versionId, n],
    );
    return row ? new Uint8Array(row.jpeg) : null;
  }

  async putPage(versionId: string, n: number, jpeg: Uint8Array) {
    await this.db.runAsync(
      `insert into offline_page (version_id, n, jpeg) values (?, ?, ?)
         on conflict (version_id, n) do update set jpeg = excluded.jpeg`,
      [versionId, n, jpeg],
    );
  }

  async recordOpen(open: OfflineOpenRecord) {
    await this.db.runAsync(
      `insert into offline_open (id, document_id, version_id, at, mode, online) values (?, ?, ?, ?, ?, ?)
         on conflict (id) do nothing`,
      [open.id, open.document_id, open.version_id, open.at, open.mode, open.online ? 1 : 0],
    );
  }

  async opens() {
    const rows = await this.db.getAllAsync<Omit<OfflineOpenRecord, 'online'> & { online: number }>(
      'select id, document_id, version_id, at, mode, online from offline_open order by at',
      [],
    );
    return rows.map((r) => ({ ...r, online: r.online === 1 }));
  }

  async clearOpens(ids: string[]) {
    if (!ids.length) return;
    await this.db.runAsync(`delete from offline_open where id in (${ids.map(() => '?').join(', ')})`, ids);
  }

  async state(key: string) {
    const row = await this.db.getFirstAsync<{ value: string }>('select value from sync_state where key = ?', [key]);
    return row?.value ?? null;
  }

  async setState(key: string, value: string) {
    await this.db.runAsync(
      'insert into sync_state (key, value) values (?, ?) on conflict (key) do update set value = excluded.value',
      [key, value],
    );
  }

  async close() {
    await (this.db as unknown as { closeAsync?: () => Promise<void> }).closeAsync?.();
  }
}
