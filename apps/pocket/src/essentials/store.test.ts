import { nodeSqlDb } from '../test-support/node-sqlite';
import { SqliteEssentialsStore } from './sqlite-store';
import { MemoryEssentialsStore, type EssentialsStore } from './store';

/**
 * The same behaviour from both stores: the memory one the web build and the
 * other tests use, and the SQL the phone runs (over Node's SQLite here;
 * SQLCipher itself is checked on the phone by the probes and Maestro).
 */
const makers: [string, () => Promise<EssentialsStore>][] = [
  ['in memory', async () => new MemoryEssentialsStore()],
  ['in SQLite', async () => SqliteEssentialsStore.over(nodeSqlDb())],
];

const jpeg = (n: number) => new Uint8Array([0xff, 0xd8, 0xff, n, 0xff, 0xd9]);

describe.each(makers)('the offline Essentials store, %s', (_name, make) => {
  it('keeps a document and its pages', async () => {
    const s = await make();
    await s.putDocument({ id: 'passport', version_id: 'v1', view: '{"title":"Passport"}', pages: 2, kept_at: 10 });
    await s.putPage('v1', 1, jpeg(1));
    await s.putPage('v1', 2, jpeg(2));
    expect(await s.document('passport')).toEqual({
      id: 'passport',
      version_id: 'v1',
      view: '{"title":"Passport"}',
      pages: 2,
      kept_at: 10,
    });
    expect(await s.page('v1', 2)).toEqual(jpeg(2));
    expect(await s.page('v1', 3)).toBeNull();
  });

  it('a new version’s pages replace the old version’s', async () => {
    const s = await make();
    await s.putDocument({ id: 'passport', version_id: 'v1', view: '{}', pages: 1, kept_at: 1 });
    await s.putPage('v1', 1, jpeg(1));
    await s.putDocument({ id: 'passport', version_id: 'v2', view: '{}', pages: 1, kept_at: 2 });
    await s.putPage('v2', 1, jpeg(9));
    expect(await s.page('v1', 1)).toBeNull();
    expect(await s.page('v2', 1)).toEqual(jpeg(9));
    expect((await s.documents()).map((d) => d.version_id)).toEqual(['v2']);
  });

  it('removing a document removes its pages', async () => {
    const s = await make();
    await s.putDocument({ id: 'a', version_id: 'va', view: '{}', pages: 1, kept_at: 1 });
    await s.putDocument({ id: 'b', version_id: 'vb', view: '{}', pages: 1, kept_at: 1 });
    await s.putPage('va', 1, jpeg(1));
    await s.putPage('vb', 1, jpeg(2));
    await s.removeDocument('a');
    expect(await s.page('va', 1)).toBeNull();
    expect(await s.page('vb', 1)).toEqual(jpeg(2));
    expect((await s.documents()).map((d) => d.id)).toEqual(['b']);
  });

  it('remembers what was opened offline until it has been told', async () => {
    const s = await make();
    await s.recordOpen('a', 5);
    await s.recordOpen('b', 7);
    await s.recordOpen('a', 9);
    expect(await s.opens()).toEqual([
      { document_id: 'a', at: 5 },
      { document_id: 'b', at: 7 },
      { document_id: 'a', at: 9 },
    ]);
    await s.clearOpens(7);
    expect(await s.opens()).toEqual([{ document_id: 'a', at: 9 }]);
  });

  it('keeps where syncing got to', async () => {
    const s = await make();
    expect(await s.state('since')).toBeNull();
    await s.setState('since', '2026-09-25T10:00:00Z');
    await s.setState('since', '2026-09-25T11:00:00Z');
    expect(await s.state('since')).toBe('2026-09-25T11:00:00Z');
  });
});

describe('the store’s schema', () => {
  it('is applied once, and counted', async () => {
    const db = nodeSqlDb();
    await SqliteEssentialsStore.over(db);
    await SqliteEssentialsStore.over(db);
    expect(await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version', [])).toEqual({ user_version: 1 });
  });
});
