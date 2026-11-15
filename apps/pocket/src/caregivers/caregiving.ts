import { mayGiveCare, type DocumentView } from '@fdv/shared';
import { useCallback, useEffect, useState } from 'react';
import { on } from '../state/events';
import { useVault } from '../state/vault';
import { caregiversOn, isCaregiverPaper } from './rules';

const NONE: ReadonlyMap<string, DocumentView> = new Map();

/** How many of one person's papers are asked for: a list, one request a person. */
const PER_PERSON = 200;

/**
 * The papers the person sees only as somebody's caregiver (H1b), by id: for
 * marking a search's hits, which do not say so, and keeping them out of
 * what would be refused or is not theirs (a collection's Add documents, the
 * Only me filter, Home's counts and Essentials).
 *
 * Asked as lists — one GET /documents?member_id= for each person of the
 * person's live grants — never one paper at a time: the vault writes down a
 * look at a paper opened through a grant (GET /documents/{id}), and the
 * person it belongs to reads who looked. A list is no look. Whatever the
 * vault marks `caregiver: true` counts, whoever can see it otherwise.
 *
 * Kept while the screen is, and asked again when a document or a grant
 * changes on the phone (`documentChanged`). Nothing on an older vault, for
 * a role that is never a caregiver, without a connection, or when the
 * vault does not say.
 */
export function useCaregiving(): ReadonlyMap<string, DocumentView> {
  const { caps, who, offline, withTokenQuick } = useVault();
  const asks = caregiversOn(caps) && mayGiveCare(who?.role);
  const [papers, setPapers] = useState<ReadonlyMap<string, DocumentView>>(NONE);
  const [again, setAgain] = useState(0);
  const load = useCallback(
    () =>
      withTokenQuick(async (a, tk) => {
        const mine = await a.myCaregivers(tk);
        const people = [...new Set(mine.for_others.map((g) => g.person_member_id))];
        const lists = await Promise.all(people.map((id) => a.documents(tk, { member_id: id, limit: PER_PERSON })));
        return new Map(lists.flatMap((l) => l.items.filter((d) => isCaregiverPaper(d)).map((d) => [d.id, d] as const)));
      }),
    [withTokenQuick],
  );
  useEffect(() => {
    if (!asks || offline) return;
    let stopped = false;
    load()
      .then((found) => {
        if (!stopped) setPapers(found);
      })
      .catch(() => undefined);
    return () => {
      stopped = true;
    };
  }, [asks, offline, load, again]);
  // A grant revoked or given up, or a paper changed, here: asked again.
  useEffect(() => on('documentChanged', () => setAgain((n) => n + 1)), []);
  return asks ? papers : NONE;
}
