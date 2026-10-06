import { ApiRequestError, NetworkError, type Api } from '@fdv/client';
import type { DocumentView, VersionView } from '@fdv/shared';
import type { TFunction } from 'i18next';
import { wordsFor } from '../errors/words';
import { holdForShow } from '../show/handoff';
import { openOnline } from './online';
import { markWarnedAboutCopies, saveCopy } from './save-copy';

/**
 * What a document's page does, and its row's ⋯ (5.36) does the same way:
 * Show, Save a copy, and making it an Essential or not. Each answers the
 * catalogue's words for what went wrong, or null when it went (or was not
 * confirmed, which is an answer, not a failure).
 */

type WithToken = <T>(fn: (a: Api, token: string) => Promise<T>) => Promise<T>;
type Guarded = <T>(fn: (a: Api, token: string) => Promise<T>) => Promise<T | null>;

export interface ActionDeps {
  withToken: WithToken;
  /** Through the step-up: the vault may ask to confirm it is you. */
  guarded: Guarded;
  offline: boolean;
  /** Which version of it this phone keeps, if any (asked of the store itself). */
  keptVersion: (id: string) => Promise<string | null>;
  /** To Show mode. */
  push: (to: { pathname: '/show/[id]'; params: { id: string; online?: string } }) => void;
  /** Around the share sheet: it is the app's own, not leaving the app (the lock waits). */
  away: <T>(task: () => Promise<T>) => Promise<T>;
}

/**
 * The copy kept on the phone, when it is the current one (or there is no
 * way to know better, offline): from there, asking nothing.
 */
export async function keptIsCurrent(deps: ActionDeps, id: string, latestId: string | null): Promise<boolean> {
  const kept = await deps.keptVersion(id);
  return !!kept && (deps.offline || !latestId || latestId === kept);
}

/**
 * Show mode never asks anybody to confirm it is them: for a copy not kept
 * here, the pages are confirmed and fetched first, and handed over.
 */
export async function showDocument(deps: ActionDeps, id: string, latestId: string | null): Promise<string | null> {
  if (await keptIsCurrent(deps, id, latestId)) {
    deps.push({ pathname: '/show/[id]', params: { id } });
    return null;
  }
  if (deps.offline) return 'document.needsConnection';
  try {
    const copy = await openOnline(deps.withToken, deps.guarded, id);
    if (copy === null) return 'document.pageFailed';
    if (copy === 'unconfirmed') return 'document.notConfirmed';
    const uris: string[] = [];
    for (let n = 1; n <= copy.pages; n += 1) {
      const uri = await copy.page(n);
      if (uri === null) return 'document.notConfirmed';
      uris.push(uri);
    }
    holdForShow(id, { ...copy, page: async (n) => uris[n - 1] ?? null });
    deps.push({ pathname: '/show/[id]', params: { id, online: '1' } });
    return null;
  } catch (err) {
    return err instanceof NetworkError ? 'document.needsConnection' : 'document.pageFailed';
  }
}

export type SaveOutcome = 'saved' | 'unconfirmed' | { failed: string };

/**
 * The version's file, to the phone's share sheet, and then gone from the
 * phone (save-copy.ts). Warned about once a copy has really gone out, not
 * before.
 */
export async function saveVersion(deps: ActionDeps, version: VersionView): Promise<SaveOutcome> {
  try {
    const res = await deps.guarded((a, token) => a.content(token, version.id));
    if (!res) return 'unconfirmed'; // nothing done
    await saveCopy(new Uint8Array(await res.arrayBuffer()), version.filename, version.mime, { away: deps.away });
    markWarnedAboutCopies();
    return 'saved';
  } catch (err) {
    return { failed: err instanceof NetworkError ? 'document.needsConnection' : 'document.saveFailed' };
  }
}

export type EssentialOutcome =
  | { kind: 'saved'; doc: DocumentView }
  /** Not confirmed: nothing changed. */
  | { kind: 'unconfirmed' }
  /** Changed meanwhile by somebody else: theirs is to be shown, not overwritten. */
  | { kind: 'conflict' }
  | { kind: 'failed'; words: string };

/**
 * An Essential or not (online only). Turning it off takes a check away, so
 * a vault of 0.5.3 or later asks who it is first.
 */
export async function setEssential(
  deps: ActionDeps,
  doc: DocumentView,
  value: boolean,
  t: TFunction,
): Promise<EssentialOutcome> {
  if (deps.offline) return { kind: 'failed', words: t('document.needsConnection') };
  try {
    const saved = await deps.guarded((a, token) => a.updateDocument(token, doc.id, { is_essential: value }, doc.etag));
    return saved ? { kind: 'saved', doc: saved } : { kind: 'unconfirmed' };
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 409) return { kind: 'conflict' };
    if (err instanceof NetworkError) return { kind: 'failed', words: t('document.needsConnection') };
    return { kind: 'failed', words: wordsFor(err, t, 'document.failed') };
  }
}
