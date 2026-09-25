import { ApiRequestError, type Api } from '@fdv/client';
import type { VersionView } from '@fdv/shared';
import { jpegDataUri } from '../essentials/base64';
import type { OpenCopy } from '../state/essentials';

type WithToken = <T>(fn: (a: Api, token: string) => Promise<T>) => Promise<T>;
type Guarded = <T>(fn: (a: Api, token: string) => Promise<T>) => Promise<T | null>;

/** The version the vault shows now: the latest. */
export function latestOf(versions: VersionView[]): VersionView | null {
  return [...versions].sort((x, y) => y.version_no - x.version_no)[0] ?? null;
}

/**
 * A document's pages from the vault (4.12), in the shape a kept copy has:
 * for the viewer and Show mode when it is not kept on the phone. Each page
 * is fetched through the step-up (an Essential or an Only me document asks
 * to confirm it is you, once for a while); a page never touches the disk.
 * Pages the vault has not drawn yet are asked for, which starts them.
 */
export async function openOnline(
  withToken: WithToken,
  guarded: Guarded,
  id: string,
): Promise<OpenCopy | 'unconfirmed' | null> {
  const [document, versions] = await withToken((a, token) =>
    Promise.all([a.document(token, id), a.versions(token, id)]),
  );
  const latest = latestOf(versions.items);
  const page = async (n: number): Promise<string | null> => {
    if (!latest) return null;
    const res = await guarded((a, token) => a.page(token, latest.id, n));
    return res ? jpegDataUri(new Uint8Array(await res.arrayBuffer())) : null;
  };
  let pages = latest?.preview_pages ?? 0;
  let pending = !!latest && latest.preview_pages == null;
  if (latest && pending) {
    // Not drawn yet: asking for the first page starts it, or finds it done.
    try {
      // Not confirmed: that is the answer, not asked again straight away.
      if ((await guarded((a, token) => a.page(token, latest.id, 1))) === null) return 'unconfirmed';
      const again = latestOf((await withToken((a, token) => a.versions(token, id))).items);
      pages = again?.preview_pages ?? 1;
      pending = false;
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'no_preview') pending = false;
      else if (!(err instanceof ApiRequestError && err.code === 'preview_pending')) throw err;
    }
  }
  return {
    document,
    versionId: latest?.id ?? '',
    pages,
    pending,
    status: document.status,
    page,
  };
}
