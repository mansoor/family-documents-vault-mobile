import type { QueueItem } from './item';

/**
 * Where captures wait. On the phone it is queue.db, encrypted
 * (sqlite-store.ts); on the web build, which is for development and the
 * browser tests only, and in the unit tests, it is memory.
 */
export interface QueueStore {
  /** The item and its bytes together, or neither. */
  add(item: QueueItem, bytes: Uint8Array): Promise<void>;
  /** Every item, oldest first, without their bytes. */
  list(): Promise<QueueItem[]>;
  bytes(id: string): Promise<Uint8Array | null>;
  update(id: string, patch: Partial<Omit<QueueItem, 'id'>>): Promise<void>;
  /**
   * New bytes for an item, and the item changed with them, together (a note
   * changed before it was sent, 0.13.0) — never while a try is sending it
   * ('sending'), unless the uploader itself asks (`evenIfSending`). 'gone'
   * when the item is: sent meanwhile, or removed.
   */
  replaceBytes(
    id: string,
    bytes: Uint8Array,
    patch: Partial<Omit<QueueItem, 'id'>>,
    opts?: { evenIfSending?: boolean },
  ): Promise<ChangeOutcome>;
  /** The item, its bytes and its key, gone — unless a try is sending it now (a note deleted, 0.13.0). */
  removeIdle(id: string): Promise<ChangeOutcome>;
  /** The item, its bytes and its key, gone. */
  remove(id: string): Promise<void>;
  /**
   * What the card needs to work offline — the kinds of document, the
   * household's people — as last seen from each vault and account.
   */
  cached<T>(key: string): Promise<T | null>;
  cache(key: string, value: unknown): Promise<void>;
  /** Everything cached under keys that start so (a vault forgotten, 4.15). */
  forgetCached(prefix: string): Promise<void>;
}

/** What became of a change asked of an item: made, the item gone, or refused while a try sends it. */
export type ChangeOutcome = 'ok' | 'gone' | 'sending';

export class MemoryQueueStore implements QueueStore {
  private readonly items = new Map<string, { item: QueueItem; bytes: Uint8Array }>();

  async add(item: QueueItem, bytes: Uint8Array): Promise<void> {
    this.items.set(item.id, { item: { ...item }, bytes });
  }

  async list(): Promise<QueueItem[]> {
    return [...this.items.values()]
      .map((e) => ({ ...e.item }))
      .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
  }

  async bytes(id: string): Promise<Uint8Array | null> {
    return this.items.get(id)?.bytes ?? null;
  }

  async update(id: string, patch: Partial<Omit<QueueItem, 'id'>>): Promise<void> {
    const e = this.items.get(id);
    if (e) e.item = { ...e.item, ...patch };
  }

  async replaceBytes(
    id: string,
    bytes: Uint8Array,
    patch: Partial<Omit<QueueItem, 'id'>>,
    opts: { evenIfSending?: boolean } = {},
  ): Promise<ChangeOutcome> {
    const e = this.items.get(id);
    if (!e) return 'gone';
    if (e.item.state === 'sending' && !opts.evenIfSending) return 'sending';
    this.items.set(id, { item: { ...e.item, ...patch }, bytes });
    return 'ok';
  }

  async removeIdle(id: string): Promise<ChangeOutcome> {
    const e = this.items.get(id);
    if (!e) return 'gone';
    if (e.item.state === 'sending') return 'sending';
    this.items.delete(id);
    return 'ok';
  }

  async remove(id: string): Promise<void> {
    this.items.delete(id);
  }

  private readonly kept = new Map<string, string>();

  async cached<T>(key: string): Promise<T | null> {
    const v = this.kept.get(key);
    return v === undefined ? null : (JSON.parse(v) as T);
  }

  async cache(key: string, value: unknown): Promise<void> {
    this.kept.set(key, JSON.stringify(value));
  }

  async forgetCached(prefix: string): Promise<void> {
    for (const key of [...this.kept.keys()]) if (key.startsWith(prefix)) this.kept.delete(key);
  }
}
