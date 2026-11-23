import type { Cabinet, IssuerGroups } from '@fdv/shared';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { on } from '../state/events';
import { useVault } from '../state/vault';
import { loadFailure } from '../ui/states';
import { arrangedOf, cabinetGate, shownLayout, type Arranged } from './model';

/** The person's cabinet as last read: what is shown, and each shown folder's count (null: the vault won't count it now). */
export interface CabinetRead {
  /**
   * Null: nothing arranged yet. `by`: its levels, `hand` for arranged by
   * hand, `web` for levels this app doesn't know, or null where the vault
   * says none (`arrangedOf`).
   */
  arranged: { by: Arranged | null; cabinets: Cabinet[]; hidden: number } | null;
  counts: Record<string, number | null>;
  /**
   * What the cabinet holds in all, each paper once (a vault of 19 Nov 2026,
   * with a saved arrangement): the total, those in no shown folder, and those
   * in more than one. Undefined where the vault does not say.
   */
  documents?: number;
  unfiled?: number;
  inSeveral?: number;
}

/** How long an answer is taken as current by a screen that opens: the next level down opens on it, unasked. */
export const CABINET_FRESH_MS = 2_000;

/**
 * The last answer, for this vault and this person only, held in memory while
 * the app runs: the next level down opens at once with it. Never written to
 * the phone. One asking at a time for each: every screen showing the cabinet
 * shares it, so a change asks the vault once, however many are open.
 */
const lastRead = new Map<string, CabinetRead>();
const readAt = new Map<string, number>();
const asking = new Map<string, Promise<CabinetRead>>();
const told = new Set<(key: string, read: CabinetRead) => void>();
let generation = 0;

/** Forgotten as a session ends here, signed out or ended by the vault; an answer still on its way is let go. */
export function forgetCabinets(): void {
  lastRead.clear();
  readAt.clear();
  asking.clear();
  issuers.clear();
  generation += 1;
}
on('signedOut', forgetCabinets);
on('sessionEnded', forgetCabinets);
// A document changed: what was read is no longer current, and the next look asks again (once, for every screen).
// Listened to here, before any screen's own listener, so theirs finds it stale.
on('documentChanged', () => {
  readAt.clear();
  // Who issued it may have changed with it: the household's issuers are asked again when next needed.
  issuers.clear();
});

/**
 * The household's issuers (GET /issuers/groups, a vault of 0.9.0-dev.91),
 * for this vault and this person: asked once, by the first folder that
 * names an issuer, and shared by every one after it while the app runs.
 * Forgotten as the session ends, and when a document changes. A failure is
 * not kept: the next folder asks again.
 */
const issuers = new Map<string, Promise<IssuerGroups | null>>();

export function issuerGroupsFor(key: string, ask: () => Promise<IssuerGroups>): Promise<IssuerGroups | null> {
  const had = issuers.get(key);
  if (had) return had;
  const p: Promise<IssuerGroups | null> = ask().catch(() => {
    if (issuers.get(key) === p) issuers.delete(key);
    return null;
  });
  issuers.set(key, p);
  return p;
}

/** The cabinet for `key`: the asking under way, else a current answer (unless `force`), else asked now. */
function readCabinet(key: string, ask: () => Promise<CabinetRead>, force: boolean): Promise<CabinetRead> {
  const going = asking.get(key);
  if (going) return going;
  const had = lastRead.get(key);
  const at = readAt.get(key);
  if (!force && had && at !== undefined && Date.now() - at < CABINET_FRESH_MS) return Promise.resolve(had);
  const gen = generation;
  const p: Promise<CabinetRead> = ask()
    .then((read) => {
      if (gen === generation) {
        lastRead.set(key, read);
        readAt.set(key, Date.now());
        for (const tell of [...told]) tell(key, read);
      }
      return read;
    })
    .finally(() => {
      if (asking.get(key) === p) asking.delete(key);
    });
  asking.set(key, p);
  return p;
}

/**
 * The person's own cabinet (GET /cabinet) and its folders' counts (GET
 * /cabinet/counts), looked at on arrival, when the connection returns and
 * when a document changes — one request each, shared by every screen
 * showing it. `load` (Try again, pull to refresh) always asks. A vault
 * without cabinets is never asked.
 */
export function useCabinet() {
  const { t } = useTranslation();
  const { withToken, offline, who, caps } = useVault();
  const gate = cabinetGate(caps);
  const key = who ? `${who.origin}|${who.member_id}` : '';
  const [read, setRead] = useState<CabinetRead | null>(() => lastRead.get(key) ?? null);
  const [failed, setFailed] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Whichever screen asked, every screen showing this cabinet takes the answer.
  useEffect(() => {
    const tell = (k: string, r: CabinetRead) => {
      if (k !== key) return;
      setRead(r);
      setFailed(null);
    };
    told.add(tell);
    return () => {
      told.delete(tell);
    };
  }, [key]);

  const look = useCallback(
    async (force: boolean) => {
      if (!gate.on || !key) return;
      setLoading(true);
      try {
        const next = await readCabinet(
          key,
          async () => {
            const [view, counted] = await withToken((a, tk) =>
              Promise.all([a.cabinet(tk), a.cabinetCounts(tk).catch(() => null)]),
            );
            const cabinets = shownLayout(view.layout);
            return {
              arranged: view.layout
                ? {
                    by: arrangedOf(view.layout, { levels: gate.levels }),
                    cabinets,
                    hidden: view.layout.cabinets.length - cabinets.length,
                  }
                : null,
              counts: counted?.counts ?? {},
              ...(typeof counted?.documents === 'number' ? { documents: counted.documents } : {}),
              ...(typeof counted?.unfiled === 'number' ? { unfiled: counted.unfiled } : {}),
              ...(typeof counted?.in_several === 'number' ? { inSeveral: counted.in_several } : {}),
            };
          },
          force,
        );
        setRead(next);
        setFailed(null);
      } catch (err) {
        setFailed(loadFailure('cabinet', err, t));
      } finally {
        setLoading(false);
      }
    },
    [gate.on, gate.levels, key, withToken, t],
  );
  const load = useCallback(() => look(true), [look]);

  useEffect(() => {
    // Looked at on arrival and when the connection returns; set once the vault answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void look(false);
  }, [look, offline]);
  // A document changed (its details, the Trash): the counts may have too.
  useEffect(() => on('documentChanged', () => void look(false)), [look]);

  return { gate, read, failed, loading, load };
}
