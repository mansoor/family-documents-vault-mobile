import type { QueueItem } from './item';
import type { QueueStore } from './store';

/**
 * queue.db: captures waiting for the vault, encrypted with SQLCipher under
 * the queue key (queue/key.ts). The bytes sit in a table of their own, so
 * listing the queue never reads a scan.
 */

type SqlParam = string | number | null | Uint8Array;

/** The part of expo-sqlite's database this store uses. */
export interface SqlDb {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, params: SqlParam[]): Promise<unknown>;
  getAllAsync<T>(source: string, params: SqlParam[]): Promise<T[]>;
  getFirstAsync<T>(source: string, params: SqlParam[]): Promise<T | null>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}

/**
 * queue.db's schema, one step per app version that changed it, applied in
 * order and counted in PRAGMA user_version. Step 1 is 0.1.2's (it did not
 * count, so it is written to be safe to run again).
 */
const STEPS = [
  `
create table if not exists queue_item (
  id text primary key,
  key text not null,
  origin text not null,
  account text not null,
  created_at integer not null,
  state text not null,
  metadata text,
  filename text not null,
  mime text not null,
  size integer not null,
  attempts integer not null,
  next_at integer not null,
  ask_first integer not null,
  problem text
);
create table if not exists queue_bytes (
  id text primary key,
  bytes blob not null
);
`,
  // 0.1.3: renewals (new versions), the last try's reason, the card's cache.
  `
alter table queue_item add column kind text not null default 'capture';
alter table queue_item add column target text;
alter table queue_item add column last_code text;
create table card_cache (
  key text primary key,
  value text not null,
  saved_at integer not null
);
`,
  // 0.2.1: the card's names for a scan's details, and those left out to file it.
  `
alter table queue_item add column labels text;
alter table queue_item add column dropped text;
`,
];

interface Row {
  id: string;
  key: string;
  origin: string;
  account: string;
  created_at: number;
  state: QueueItem['state'];
  metadata: string | null;
  filename: string;
  mime: string;
  size: number;
  attempts: number;
  next_at: number;
  ask_first: number;
  problem: string | null;
  kind: QueueItem['kind'];
  target: string | null;
  last_code: string | null;
  labels: string | null;
  dropped: string | null;
}

const COLUMNS: Record<Exclude<keyof QueueItem, 'id'>, keyof Row> = {
  kind: 'kind',
  target: 'target',
  lastCode: 'last_code',
  labels: 'labels',
  dropped: 'dropped',
  key: 'key',
  origin: 'origin',
  account: 'account',
  createdAt: 'created_at',
  state: 'state',
  metadata: 'metadata',
  filename: 'filename',
  mime: 'mime',
  size: 'size',
  attempts: 'attempts',
  nextAt: 'next_at',
  askFirst: 'ask_first',
  problem: 'problem',
};

/** Kept as JSON; absent (the optional ones) as null. */
const JSON_FIELDS = new Set<keyof QueueItem>(['metadata', 'problem', 'labels', 'dropped']);

function toParam(field: Exclude<keyof QueueItem, 'id'>, value: unknown): SqlParam {
  if (JSON_FIELDS.has(field)) return value === null || value === undefined ? null : JSON.stringify(value);
  if (field === 'askFirst') return value ? 1 : 0;
  return value as SqlParam;
}

function fromRow(r: Row): QueueItem {
  return {
    id: r.id,
    kind: r.kind,
    target: r.target,
    lastCode: r.last_code,
    key: r.key,
    origin: r.origin,
    account: r.account,
    createdAt: r.created_at,
    state: r.state,
    metadata: r.metadata === null ? null : (JSON.parse(r.metadata) as QueueItem['metadata']),
    filename: r.filename,
    mime: r.mime,
    size: r.size,
    attempts: r.attempts,
    nextAt: r.next_at,
    askFirst: r.ask_first === 1,
    problem: r.problem === null ? null : (JSON.parse(r.problem) as QueueItem['problem']),
    ...(r.labels === null ? {} : { labels: JSON.parse(r.labels) as Record<string, string> }),
    ...(r.dropped === null ? {} : { dropped: JSON.parse(r.dropped) as string[] }),
  };
}

/**
 * One connection, one statement at a time. expo-sqlite's transactions are
 * plain BEGIN … COMMIT on the shared connection, so a Save and the
 * uploader's clean-up after a 201 must never overlap: one would roll back
 * the other. (Its exclusive transactions open a second connection, which
 * would not have the SQLCipher key.)
 */
export class SqliteQueueStore implements QueueStore {
  private tail: Promise<unknown> = Promise.resolve();

  private constructor(private readonly db: SqlDb) {}

  /** A store over a database already opened and keyed. */
  static async over(db: SqlDb): Promise<SqliteQueueStore> {
    const at = (await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []))?.user_version ?? 0;
    for (let step = at; step < STEPS.length; step += 1) {
      // A step and its count together, or neither: an upgrade stopped
      // halfway (a full phone, the app killed) is simply run again.
      await db.withTransactionAsync(async () => {
        await db.execAsync(STEPS[step] as string);
        await db.execAsync(`PRAGMA user_version = ${step + 1}`);
      });
    }
    // Bytes whose item is gone: never sent, never shown, only taking room.
    await db.runAsync('delete from queue_bytes where id not in (select id from queue_item)', []);
    return new SqliteQueueStore(db);
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    this.tail = run.catch(() => undefined);
    return run;
  }

  add(item: QueueItem, bytes: Uint8Array): Promise<void> {
    const fields = Object.keys(COLUMNS) as Exclude<keyof QueueItem, 'id'>[];
    return this.serial(() =>
      this.db.withTransactionAsync(async () => {
        await this.db.runAsync(
          `insert into queue_item (id, ${fields.map((f) => COLUMNS[f]).join(', ')}) values (?${', ?'.repeat(fields.length)})`,
          [item.id, ...fields.map((f) => toParam(f, item[f]))],
        );
        await this.db.runAsync('insert into queue_bytes (id, bytes) values (?, ?)', [item.id, bytes]);
      }),
    );
  }

  list(): Promise<QueueItem[]> {
    return this.serial(async () =>
      (await this.db.getAllAsync<Row>('select * from queue_item order by created_at, id', [])).map(fromRow),
    );
  }

  bytes(id: string): Promise<Uint8Array | null> {
    return this.serial(async () => {
      const row = await this.db.getFirstAsync<{ bytes: Uint8Array }>('select bytes from queue_bytes where id = ?', [
        id,
      ]);
      return row ? new Uint8Array(row.bytes) : null;
    });
  }

  update(id: string, patch: Partial<Omit<QueueItem, 'id'>>): Promise<void> {
    const fields = (Object.keys(patch) as Exclude<keyof QueueItem, 'id'>[]).filter((f) => f in COLUMNS);
    if (fields.length === 0) return Promise.resolve();
    return this.serial(async () => {
      await this.db.runAsync(
        `update queue_item set ${fields.map((f) => `${COLUMNS[f]} = ?`).join(', ')} where id = ?`,
        [...fields.map((f) => toParam(f, patch[f])), id],
      );
    });
  }

  cached<T>(key: string): Promise<T | null> {
    return this.serial(async () => {
      const row = await this.db.getFirstAsync<{ value: string }>('select value from card_cache where key = ?', [key]);
      return row ? (JSON.parse(row.value) as T) : null;
    });
  }

  cache(key: string, value: unknown): Promise<void> {
    return this.serial(async () => {
      await this.db.runAsync(
        `insert into card_cache (key, value, saved_at) values (?, ?, ?)
         on conflict (key) do update set value = excluded.value, saved_at = excluded.saved_at`,
        [key, JSON.stringify(value), Date.now()],
      );
    });
  }

  forgetCached(prefix: string): Promise<void> {
    return this.serial(async () => {
      await this.db.runAsync('delete from card_cache where substr(key, 1, ?) = ?', [prefix.length, prefix]);
    });
  }

  remove(id: string): Promise<void> {
    return this.serial(() =>
      this.db.withTransactionAsync(async () => {
        await this.db.runAsync('delete from queue_bytes where id = ?', [id]);
        await this.db.runAsync('delete from queue_item where id = ?', [id]);
      }),
    );
  }
}
