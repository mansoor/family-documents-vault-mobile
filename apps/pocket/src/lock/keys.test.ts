import { openEverydayCopies, openPrivateCopies, type CopiesIo } from '../essentials/copies';
import type { Tier } from '../essentials/open';
import { MemoryEssentialsStore, type EssentialsStore } from '../essentials/store';
import { ESSENTIALS_KEY, KeyRing, PRIVATE_KEY, type KeyStorePort } from './keys';

/**
 * The phone's keystore, as far as the key ring uses it: plain entries, and
 * guarded ones that the system throws away when a fingerprint or face is
 * added (`enrolmentChanged`), or that the person can decline to open.
 */
function keystore(opts: { strong?: boolean } = {}) {
  const plain = new Map<string, string>();
  const guarded = new Map<string, string>();
  let made = false;
  let declines = false;
  const port: KeyStorePort = {
    get: async (k) => plain.get(k) ?? null,
    set: async (k, v) => void plain.set(k, v),
    delete: async (k) => {
      plain.delete(k);
      guarded.delete(k);
    },
    getGuarded: async (k) => {
      if (declines) throw new Error('user cancelled');
      return guarded.get(k) ?? null;
    },
    setGuarded: async (k, v) => {
      if (declines) throw new Error('user cancelled');
      guarded.set(k, v);
    },
    canUseStrong: () => opts.strong ?? true,
    privateMade: () => made,
    setPrivateMade: (m) => void (made = m),
  };
  return {
    port,
    plain,
    guarded,
    enrolmentChanged: () => guarded.clear(),
    decline: (d: boolean) => void (declines = d),
  };
}

/** Both stores in memory, and a record of which were removed. */
function copies() {
  const stores = new Map<Tier, EssentialsStore>();
  const removed: Tier[] = [];
  const io: CopiesIo = {
    open: async (tier) => {
      const existing = stores.get(tier);
      if (existing) return existing;
      const made = new MemoryEssentialsStore();
      stores.set(tier, made);
      return made;
    },
    remove: async (tier) => {
      removed.push(tier);
      stores.delete(tier);
    },
  };
  return { io, stores, removed };
}

const doc = (id: string) => ({ id, version_id: `${id}-v1`, view: '{}', pages: 1, kept_at: 1 });

describe('the offline stores’ keys', () => {
  it('keys are dropped from memory on lock, and the same key comes back after', async () => {
    const ks = keystore();
    const ring = new KeyRing(ks.port);
    expect(ring.everydayKey).toBeNull();
    const hex = await ring.openEveryday();
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
    expect(ring.everydayKey).toBe(hex);
    expect(ks.plain.get(ESSENTIALS_KEY)).toBe(hex);

    ring.drop();
    expect(ring.everydayKey).toBeNull();
    // Locked, the everyday copies cannot be opened at all.
    expect(await openEverydayCopies(ring, copies().io)).toBeNull();

    expect(await ring.openEveryday()).toBe(hex);
  });

  it('an enrolment change wipes only the Only me copies', async () => {
    const ks = keystore();
    const ring = new KeyRing(ks.port);
    const c = copies();
    await ring.openEveryday();
    const everyday = (await openEverydayCopies(ring, c.io)) as EssentialsStore;
    await everyday.putDocument(doc('passport'));
    const first = await openPrivateCopies(ring, 'Open', c.io);
    if (first.kind !== 'ok') throw new Error(`expected the Only me copies, got ${first.kind}`);
    await first.store.putDocument(doc('therapy-notes'));

    // A new fingerprint: the system throws the Only me key away.
    ks.enrolmentChanged();
    expect(await openPrivateCopies(ring, 'Open', c.io)).toEqual({ kind: 'changed' });
    expect(c.removed).toEqual(['private']);
    expect(ks.guarded.has(PRIVATE_KEY)).toBe(false);
    // The everyday copies are under their own key, untouched.
    expect((await everyday.documents()).map((d) => d.id)).toEqual(['passport']);
    expect(ks.plain.has(ESSENTIALS_KEY)).toBe(true);

    // Asked again, a new key and empty copies, to be filled online.
    const again = await openPrivateCopies(ring, 'Open', c.io);
    if (again.kind !== 'ok') throw new Error(`expected new Only me copies, got ${again.kind}`);
    expect(await again.store.documents()).toEqual([]);
  });

  it('declining the prompt changes nothing', async () => {
    const ks = keystore();
    const ring = new KeyRing(ks.port);
    const c = copies();
    const first = await openPrivateCopies(ring, 'Open', c.io);
    expect(first.kind).toBe('ok');
    ks.decline(true);
    expect(await openPrivateCopies(ring, 'Open', c.io)).toEqual({ kind: 'not_confirmed' });
    expect(c.removed).toEqual([]);
    ks.decline(false);
    expect((await openPrivateCopies(ring, 'Open', c.io)).kind).toBe('ok');
  });

  it('without strong biometrics, Only me copies cannot be kept at all', async () => {
    const ks = keystore({ strong: false });
    const ring = new KeyRing(ks.port);
    expect(await openPrivateCopies(ring, 'Open', copies().io)).toEqual({ kind: 'unavailable' });
    expect(ks.guarded.size).toBe(0);
  });

  it('a new installation keeps none of the old one’s keys', async () => {
    const ks = keystore();
    const ring = new KeyRing(ks.port);
    await ring.openEveryday();
    await ring.openPrivate('Open');
    await ring.forget();
    expect(ring.everydayKey).toBeNull();
    expect(ks.plain.size + ks.guarded.size).toBe(0);
    expect(ks.port.privateMade()).toBe(false);
  });
});
