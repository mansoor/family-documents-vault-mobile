import type { DocumentView, OfflineItem, OfflineSet } from '@fdv/shared';
import { sendOpens } from './opens';
import { MemoryEssentialsStore } from './store';
import { ageOf, lastChecked, syncEssentials, type PageFetch } from './sync';
import { endWipes } from './wipe';

const GRANT = { granted_at: '2026-09-25T10:00:00Z', expires_at: '2026-10-25T10:00:00Z', include_private: false };
const jpeg = (n: number) => new Uint8Array([0xff, 0xd8, 0xff, n, 0xff, 0xd9]);

function item(id: string, over: { version?: string; pages?: number | null; private?: boolean } = {}): OfflineItem {
  return {
    document: { id, title: `Doc ${id}` } as DocumentView,
    version: {
      id: over.version ?? `${id}-v1`,
      mime: 'application/pdf',
      page_count: over.pages ?? 1,
      preview_pages: over.pages === undefined ? 1 : over.pages,
      preview_state: over.pages === null ? 'queued' : 'ready',
    },
    private: over.private ?? false,
  };
}

function vault(items: OfflineItem[], opts: { grant?: boolean; serverTime?: string; maxDays?: number } = {}) {
  const fetched: string[] = [];
  const pending = new Set<string>();
  return {
    fetched,
    pending,
    items,
    fetchSet: async (): Promise<OfflineSet> => ({
      items,
      grant: opts.grant === false ? null : GRANT,
      max_offline_days: opts.maxDays ?? 90,
      server_time: opts.serverTime ?? '2026-09-25T12:00:00Z',
      truncated: false,
    }),
    fetchPage: async (versionId: string, n: number): Promise<PageFetch> => {
      fetched.push(`${versionId}/${n}`);
      return pending.has(versionId) ? 'pending' : jpeg(n);
    },
  };
}

describe('keeping the Essentials as the vault says', () => {
  it('a document dropped from the set is gone from the phone within one sync', async () => {
    const everyday = new MemoryEssentialsStore();
    const v = vault([item('passport'), item('will')]);
    await syncEssentials({ ...v, everyday, private: null, now: () => 1 });
    expect((await everyday.documents()).map((d) => d.id)).toEqual(['passport', 'will']);

    const later = vault([item('passport')]);
    const r = await syncEssentials({ ...later, everyday, private: null, now: () => 2 });
    expect(r.removed).toBe(1);
    expect((await everyday.documents()).map((d) => d.id)).toEqual(['passport']);
    expect(await everyday.page('will-v1', 1)).toBeNull();
  });

  it('a new version replaces the old pages', async () => {
    const everyday = new MemoryEssentialsStore();
    await syncEssentials({ ...vault([item('passport')]), everyday, private: null, now: () => 1 });
    expect(await everyday.page('passport-v1', 1)).toEqual(jpeg(1));
    await syncEssentials({
      ...vault([item('passport', { version: 'passport-v2', pages: 2 })]),
      everyday,
      private: null,
      now: () => 2,
    });
    expect(await everyday.page('passport-v1', 1)).toBeNull();
    expect(await everyday.page('passport-v2', 2)).toEqual(jpeg(2));
    expect((await everyday.document('passport'))?.version_id).toBe('passport-v2');
  });

  it('a page still being drawn is fetched on a later sync, and pages already here are not fetched again', async () => {
    const everyday = new MemoryEssentialsStore();
    const first = vault([item('passport', { pages: null })]);
    const r1 = await syncEssentials({ ...first, everyday, private: null, now: () => 1 });
    expect(r1.pending).toBe(1);
    expect(first.fetched).toEqual([]);
    const second = vault([item('passport', { pages: 2 })]);
    second.pending.add('passport-v1');
    expect((await syncEssentials({ ...second, everyday, private: null, now: () => 2 })).pending).toBe(1);
    const third = vault([item('passport', { pages: 2 })]);
    const r3 = await syncEssentials({ ...third, everyday, private: null, now: () => 3 });
    expect(r3).toMatchObject({ pending: 0, kept: 1 });
    expect(third.fetched).toEqual(['passport-v1/1', 'passport-v1/2']);
    const fourth = vault([item('passport', { pages: 2 })]);
    await syncEssentials({ ...fourth, everyday, private: null, now: () => 4 });
    expect(fourth.fetched).toEqual([]);
  });

  it('the scope setting narrows what is kept', async () => {
    const everyday = new MemoryEssentialsStore();
    await syncEssentials({
      ...vault([item('passport'), item('will')]),
      everyday,
      private: null,
      now: () => 1,
      scope: (i) => i.document.id !== 'will',
    });
    expect((await everyday.documents()).map((d) => d.id)).toEqual(['passport']);
  });

  it('without a grant the vault says keep nothing, and what was kept goes in that sync', async () => {
    const everyday = new MemoryEssentialsStore();
    await syncEssentials({ ...vault([item('passport')]), everyday, private: null, now: () => 1 });
    expect(await everyday.documents()).toHaveLength(1);
    // The grant ended (or a password changed): the vault's set is empty.
    const v = vault([], { grant: false });
    const r = await syncEssentials({ ...v, everyday, private: null, now: () => 2 });
    expect(r.grant).toBeNull();
    expect(await everyday.documents()).toEqual([]);
    expect(await everyday.page('passport-v1', 1)).toBeNull();
  });

  it('a set listed without a grant (an older vault) fetches no page', async () => {
    const everyday = new MemoryEssentialsStore();
    const v = vault([item('passport')], { grant: false });
    const r = await syncEssentials({ ...v, everyday, private: null, now: () => 1 });
    expect(v.fetched).toEqual([]);
    expect(r.grant).toBeNull();
  });

  it('Only me copies go to their own store, only when it is open', async () => {
    const everyday = new MemoryEssentialsStore();
    const privateStore = new MemoryEssentialsStore();
    const set = [item('passport'), item('adoption', { private: true })];
    const closed = await syncEssentials({ ...vault(set), everyday, private: null, now: () => 1 });
    expect(closed.privateNotKept).toBe(1);
    expect((await everyday.documents()).map((d) => d.id)).toEqual(['passport']);
    await syncEssentials({ ...vault(set), everyday, private: privateStore, now: () => 2 });
    expect((await privateStore.documents()).map((d) => d.id)).toEqual(['adoption']);
    expect((await everyday.documents()).map((d) => d.id)).toEqual(['passport']);
  });

  it('a network error changes nothing', async () => {
    const everyday = new MemoryEssentialsStore();
    await syncEssentials({ ...vault([item('passport')]), everyday, private: null, now: () => 1 });
    await expect(
      syncEssentials({
        fetchSet: async () => {
          throw new TypeError('Network request failed');
        },
        fetchPage: async () => 'none',
        everyday,
        private: null,
        now: () => 2,
      }),
    ).rejects.toThrow();
    expect((await everyday.documents()).map((d) => d.id)).toEqual(['passport']);
    expect(await everyday.page('passport-v1', 1)).toEqual(jpeg(1));
  });
});

describe('how long copies may go unchecked', () => {
  const DAY = 86_400_000;
  it('measured on server time, warned from 14 days before, removed at the limit', async () => {
    const everyday = new MemoryEssentialsStore();
    const phoneNow = 1_000_000_000_000;
    await syncEssentials({
      ...vault([item('passport')], { serverTime: '2026-09-25T12:00:00Z', maxDays: 90 }),
      everyday,
      private: null,
      now: () => phoneNow,
    });
    const checked = (await lastChecked(everyday))!;
    expect(ageOf(checked, phoneNow)).toMatchObject({ daysLeft: 90, warn: false, expired: false });
    expect(ageOf(checked, phoneNow + 75 * DAY)).toMatchObject({ daysLeft: 15, warn: false });
    expect(ageOf(checked, phoneNow + 77 * DAY)).toMatchObject({ daysLeft: 13, warn: true, expired: false });
    expect(ageOf(checked, phoneNow + 90 * DAY)).toMatchObject({ expired: true });
    // A phone clock turned back never makes copies younger than when they were checked.
    expect(ageOf(checked, phoneNow - 30 * DAY).daysLeft).toBe(90);
  });
});

describe('what was opened, told once', () => {
  it('each open is logged once and uploaded once', async () => {
    const store = new MemoryEssentialsStore();
    const open = (id: string) => ({
      id,
      document_id: 'passport',
      version_id: 'passport-v1',
      at: 5,
      mode: 'view' as const,
      online: false,
    });
    await store.recordOpen(open('a'));
    await store.recordOpen(open('a'));
    await store.recordOpen(open('b'));
    const sent: string[][] = [];
    const told = await sendOpens(store, async (events) => {
      sent.push(events.map((e) => e.id));
      return { accepted: events.length, duplicates: 0, dropped: 0 };
    });
    expect(told).toBe(2);
    expect(sent).toEqual([['a', 'b']]);
    expect(await sendOpens(store, async () => ({ accepted: 0, duplicates: 0, dropped: 0 }))).toBe(0);
  });

  it('with no connection, nothing is forgotten', async () => {
    const store = new MemoryEssentialsStore();
    await store.recordOpen({ id: 'a', document_id: 'd', version_id: 'v', at: 1, mode: 'show', online: false });
    await expect(
      sendOpens(store, async () => {
        throw new TypeError('Network request failed');
      }),
    ).rejects.toThrow();
    expect((await store.opens()).map((o) => o.id)).toEqual(['a']);
  });
});

describe('when a session ends', () => {
  it('only an expiry keeps the copies', () => {
    expect(endWipes('expired')).toBe(false);
    for (const reason of ['revoked', 'reused', 'removed', 'malformed']) expect(endWipes(reason)).toBe(true);
  });
});
