import type { OfflineOpen, OfflineOpensResult } from '@fdv/shared';
import type { EssentialsStore } from './store';

/** The most the vault takes in one request. */
const BATCH = 200;

/**
 * Tells the vault what was opened on the phone (4.10), oldest first, and
 * forgets each once the vault has answered for it — recorded, already
 * recorded, or dropped (about something the person can no longer see).
 * With no connection nothing is forgotten: it goes next time. Returns how
 * many were told.
 */
export async function sendOpens(
  store: EssentialsStore,
  send: (events: OfflineOpen[]) => Promise<OfflineOpensResult>,
): Promise<number> {
  let told = 0;
  for (;;) {
    const batch = (await store.opens()).slice(0, BATCH);
    if (!batch.length) return told;
    await send(
      batch.map((o) => ({
        id: o.id,
        version_id: o.version_id,
        opened_at: new Date(o.at).toISOString(),
        mode: o.mode,
        online: o.online,
      })),
    );
    await store.clearOpens(batch.map((o) => o.id));
    told += batch.length;
  }
}
