import { MemoryQueueStore, type QueueStore } from './store';

/**
 * The web build's queue: memory. The web build is for development and the
 * browser tests; the phone's queue is queue.db, encrypted (open.native.ts).
 */
export async function openQueue(): Promise<QueueStore> {
  return new MemoryQueueStore();
}
