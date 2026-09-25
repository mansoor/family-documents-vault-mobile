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
  /** The item, its bytes and its key, gone. */
  remove(id: string): Promise<void>;
}

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

  async remove(id: string): Promise<void> {
    this.items.delete(id);
  }
}
