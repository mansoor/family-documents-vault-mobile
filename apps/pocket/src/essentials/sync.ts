import type { DocumentView, OfflineGrant, OfflineItem, OfflineNote, OfflineSet } from '@fdv/shared';
import type { EssentialsStore } from './store';

/**
 * Keeping the phone's copies of the Essentials as the vault says (4.10).
 *
 * The vault sends the complete set this person's phone may keep; a sync
 * makes the stores match it, in one go:
 *
 *  1. Everything absent from the set — un-marked, made Only me, moved out
 *     of the person's sight, binned — is removed. So is a superseded
 *     version's pages.
 *  2. Every document in the set is kept, and its pages fetched (only under
 *     a grant; a page still being drawn is fetched on a later sync).
 *  3. Where the vault's clock was, and how long copies may go unchecked,
 *     are remembered: the copies' age is measured from them.
 *
 * The Only me copies are in their own store, under a key behind the
 * phone's biometrics; a sync fills them only when that store is open —
 * the person has just confirmed it is them. Without it, a sync still
 * checks them against the set by what the everyday store remembers of
 * them (document and version ids, nothing more): one gone from the set,
 * or a newer version, or no grant, and the Only me store is removed
 * whole, to be fetched again the next time it is opened.
 *
 * Essential notes (a vault of 0.9.0-dev.87) come in the set with their
 * words, by the same rules: kept in the same stores (an Only me one in the
 * Only me store), as a document with no version and no pages, its words in
 * the kept view, and removed when they leave the set. In what the Only me
 * store is remembered to hold, a note is its id alone: changed while that
 * store is closed, it is brought up to date when the store is next opened,
 * and the store is never removed for it.
 *
 * The age is recorded as soon as the set has been applied, before any
 * page is fetched: a page that fails to arrive does not make the copies
 * older than they are. A page that fails stops the fetching for this
 * sync (the next one carries on), and is returned, not thrown.
 */

export type PageFetch = Uint8Array | 'pending' | 'none';

export interface SyncDeps {
  /** The set; throws when the vault cannot be reached (and nothing is changed). */
  fetchSet(): Promise<OfflineSet>;
  fetchPage(versionId: string, n: number): Promise<PageFetch>;
  everyday: EssentialsStore;
  /** Only when the person has just opened it with their biometrics. */
  private: EssentialsStore | null;
  now(): number;
  /** Narrows what is kept (Settings, 4.15); everything the vault allows by default. */
  scope?(item: OfflineItem): boolean;
  /** Removes the Only me store whole (without its key). */
  removePrivate?(): Promise<void>;
}

export interface Checked {
  /** The vault's clock at the last complete set, and the phone's at the same moment. */
  server_time: string;
  at: number;
  max_offline_days: number;
}

export interface SyncResult {
  kept: number;
  removed: number;
  /** Pages still being drawn by the vault: fetched on a later sync. */
  pending: number;
  /** Only me Essentials in the set that are not kept here (the private store was not open, or not chosen). */
  privateNotKept: number;
  grant: OfflineGrant | null;
  truncated: boolean;
  checked: Checked;
  /** The Only me store no longer matched the set, and was removed. */
  privateRemoved: boolean;
  /** Why fetching pages stopped early, if it did (the next sync carries on). */
  pageError: unknown;
}

/** Pages the vault is still drawing: the document is kept, its pages come later. */
export const PAGES_PENDING = -1;

export const CHECKED_KEY = 'checked';
export const PRIVATE_COUNT_KEY = 'private_count';
/** What the Only me store holds, as `document@version` (ids only). */
export const PRIVATE_KEPT_KEY = 'private_kept';

const keyOf = (i: OfflineItem) => `${i.document.id}@${i.version.id}`;

/**
 * A kept note's version: a note has none, so this stands in for one — the
 * time its words last changed. Never a version the vault knows: nothing is
 * fetched or told of it.
 */
export const NOTE_VERSION_PREFIX = 'note:';
export function noteVersion(d: DocumentView): string {
  return `${NOTE_VERSION_PREFIX}${d.notes_updated_at ?? d.updated_at ?? ''}`;
}
/** Whether a kept copy is a note, by its stand-in version. */
export function isKeptNote(versionId: string): boolean {
  return versionId.startsWith(NOTE_VERSION_PREFIX);
}
/**
 * A note in what the Only me store is remembered to hold: by its id alone.
 * A note changed while that store is closed (saved on this phone, say) is
 * not a reason to remove the store: its words are brought up to date the
 * next time the store is opened and synced.
 */
const noteKey = (n: OfflineNote) => `${n.document.id}@${NOTE_VERSION_PREFIX}`;

/**
 * A note's view as it is kept: without `note_name` (its first words), so
 * nothing that names it in a list or a chip can show its words. They are in
 * `notes`, read only on its own page.
 */
function keptNoteView(d: DocumentView): string {
  const { note_name: _firstWords, ...view } = d;
  void _firstWords;
  return JSON.stringify(view);
}

/** What the everyday store remembers the Only me store holds. */
export async function privateKept(everyday: EssentialsStore): Promise<string[]> {
  try {
    const raw = await everyday.state(PRIVATE_KEPT_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

export async function syncEssentials(d: SyncDeps): Promise<SyncResult> {
  const set = await d.fetchSet();
  const now = d.now();
  const wanted = set.items.filter((i) => d.scope?.(i) ?? true);
  const result: SyncResult = {
    kept: 0,
    removed: 0,
    pending: 0,
    privateNotKept: 0,
    grant: set.grant,
    truncated: set.truncated,
    checked: { server_time: set.server_time, at: now, max_offline_days: set.max_offline_days },
    privateRemoved: false,
    pageError: null,
  };

  const privateItems = wanted.filter((i) => i.private);
  // Essential notes, words and all (0.9.0-dev.87): absent from an older vault's set.
  const notes = set.notes ?? [];
  const privateNotes = notes.filter((n) => n.private);
  const privateKeys = [...privateItems.map(keyOf), ...privateNotes.map(noteKey)];
  const tiers: [EssentialsStore, OfflineItem[], OfflineNote[]][] = [
    [d.everyday, wanted.filter((i) => !i.private), notes.filter((n) => !n.private)],
  ];
  if (d.private) tiers.push([d.private, privateItems, privateNotes]);
  else {
    result.privateNotKept = privateItems.length + privateNotes.length;
    // The Only me store, closed: checked by what it is remembered to hold.
    const kept = await privateKept(d.everyday);
    const inSet = new Set(privateKeys);
    if (kept.length > 0 && (!set.grant || kept.some((k) => !inSet.has(k)))) {
      await d.removePrivate?.();
      await d.everyday.setState(PRIVATE_KEPT_KEY, '[]');
      result.privateRemoved = true;
    }
  }

  // 1. Absence is the tombstone; 2. what is in the set, kept (its record).
  for (const [store, items, kept] of tiers) {
    const ids = new Set([...items.map((i) => i.document.id), ...kept.map((n) => n.document.id)]);
    for (const doc of await store.documents()) {
      if (ids.has(doc.id)) continue;
      await store.removeDocument(doc.id);
      result.removed += 1;
    }
    for (const item of items) {
      const drawn = item.version.preview_pages;
      await store.putDocument({
        id: item.document.id,
        version_id: item.version.id,
        view: JSON.stringify(item.document),
        pages: drawn ?? PAGES_PENDING,
        kept_at: now,
      });
    }
    // A note: its words in its view, no pages to fetch.
    for (const n of kept) {
      await store.putDocument({
        id: n.document.id,
        version_id: noteVersion(n.document),
        view: keptNoteView(n.document),
        pages: 0,
        kept_at: now,
      });
      result.kept += 1;
    }
  }

  // 3. Checked now: the copies' age counts from here.
  await d.everyday.setState(CHECKED_KEY, JSON.stringify(result.checked));
  await d.everyday.setState(PRIVATE_COUNT_KEY, String(privateItems.length + privateNotes.length));
  if (d.private) await d.everyday.setState(PRIVATE_KEPT_KEY, JSON.stringify(privateKeys));

  // 4. The pages, under a grant; one that fails stops this sync's fetching.
  if (!set.grant) return result;
  try {
    for (const [store, items] of tiers) {
      for (const item of items) {
        const drawn = item.version.preview_pages;
        if (drawn === null) {
          result.pending += 1;
          continue;
        }
        let whole = true;
        for (let n = 1; n <= drawn; n += 1) {
          if (await store.page(item.version.id, n)) continue;
          const page = await d.fetchPage(item.version.id, n);
          if (page === 'pending') {
            result.pending += 1;
            whole = false;
            break;
          }
          if (page === 'none') break;
          await store.putPage(item.version.id, n, page);
        }
        if (whole) result.kept += 1;
      }
    }
  } catch (err) {
    result.pageError = err;
  }
  return result;
}

/** When the copies were last checked with the vault, if ever. */
export async function lastChecked(store: EssentialsStore): Promise<Checked | null> {
  const raw = await store.state(CHECKED_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Checked;
  } catch {
    return null;
  }
}

const DAY = 86_400_000;
/** Warned from this many days before the copies would be removed. */
export const WARN_DAYS = 14;

export interface Age {
  /** Days left before the copies are removed for going unchecked. */
  daysLeft: number;
  /** When that is, on the phone's calendar. */
  removeAt: number;
  warn: boolean;
  expired: boolean;
}

/**
 * How long the copies have gone unchecked, measured on the vault's clock:
 * the vault's time at the last check, plus how long the phone says has
 * passed since (never less than nothing, whatever the phone's clock does).
 */
export function ageOf(checked: Checked, now: number): Age {
  const elapsed = Math.max(0, now - checked.at);
  const deadline = Date.parse(checked.server_time) + checked.max_offline_days * DAY;
  const serverNow = Date.parse(checked.server_time) + elapsed;
  const leftMs = deadline - serverNow;
  const daysLeft = Math.floor(leftMs / DAY);
  return {
    daysLeft,
    removeAt: now + leftMs,
    warn: leftMs <= WARN_DAYS * DAY,
    expired: leftMs <= 0,
  };
}
