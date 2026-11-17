import { ApiRequestError, NetworkError, type Api, type ResponseLike } from '@fdv/client';
import { ZIP_MAX_BYTES, ZIP_MAX_DOCUMENTS, type ZipTicket } from '@fdv/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { wordsFor } from '../errors/words';
import { useLock } from '../state/lock';
import { useStepUp } from '../state/step-up';
import { useVault } from '../state/vault';
import { Button, Text } from '../ui';
import { Sheet } from '../ui/sheet';
import { DownloadFailed, handOver, markWarnedAboutCopies, saveCopy, saveCopyIo, warnedAboutCopies } from './save-copy';

/**
 * Downloads as one ZIP (a vault of 0.9.0-dev.48, DL; the owner's ask of 15
 * Nov 2026: "add it to the phone app too"): ticked documents, or a whole
 * collection, as the web gives them — each file as its own download gives
 * it, a note as its words, and an index saying what each is.
 *
 * As the web does it: a ticket first (`downloadZipTicket`,
 * `collectionZipTicket`), through the step-up, so whatever the ZIP would
 * refuse or ask is answered there — a Sensitive document among them asks to
 * confirm it is you (`download_sensitive`), as an Only me or an Essential
 * one does; too many for one ZIP, or nothing with a file, is said in words.
 * Then the ticket's one-time address is streamed by the phone itself
 * straight into a file (save-copy.ts `download`): a ZIP may be 1 GB, and it
 * never passes through the app's memory. The ticket was asked through the
 * vault's own gate a moment before, and holds no token. A ticket used or
 * run out (404) is asked for once more. The file then goes the phone's
 * usual way for a file — the share sheet, then gone from the phone; the
 * first time, it says the copy is outside the vault.
 *
 * One document as itself (`fetch`) stays as Save a copy does it: the vault
 * may ask to confirm it is you for its content, which only a request the
 * app makes itself can answer, and one file is no more than the vault's
 * upload limit.
 */
export type DownloadJob = {
  /** Its name in the share sheet. */
  name: string;
  /** What to say for `422 nothing_to_zip`, in this place's words. */
  nothing?: string;
  /** Handed over to the phone, or why not; nothing for a step-up cancelled. */
  onDone?: (outcome: { saved: true } | { failed: string }) => void;
} & (
  | { ticket: (a: Api, token: string) => Promise<ZipTicket>; fetch?: never; mime?: never }
  | { fetch: (a: Api, token: string) => Promise<ResponseLike>; mime: string; ticket?: never }
);

/** The name the vault gave a file (`attachment; filename*=UTF-8''…`), else null. */
export function attachmentName(disposition: string | null | undefined): string | null {
  if (!disposition) return null;
  const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(disposition)?.[1];
  if (star) {
    try {
      return decodeURIComponent(star.trim());
    } catch {
      // Not encoded as it says: the plain name, if there is one.
    }
  }
  return /filename\s*=\s*"?([^";]+)"?/i.exec(disposition)?.[1]?.trim() ?? null;
}

export function useDownload() {
  const { t } = useTranslation();
  const { guarded } = useStepUp();
  const { api } = useVault();
  const lock = useLock();
  const [waiting, setWaiting] = useState<DownloadJob | null>(null);
  const [busy, setBusy] = useState(false);

  /** A ZIP: its ticket, then streamed to a file; a ticket gone by then is asked for once more. Null: not confirmed. */
  const zip = async (ticketFor: (a: Api, token: string) => Promise<ZipTicket>, name: string): Promise<string | null> => {
    for (let tries = 0; ; tries += 1) {
      const ticket = await guarded(ticketFor);
      if (!ticket || !api) return null;
      try {
        return await saveCopyIo.download(api.downloadTicketUrl(ticket), name);
      } catch (err) {
        if (err instanceof DownloadFailed && err.status === 404 && tries === 0) continue;
        throw err;
      }
    }
  };

  const run = async (job: DownloadJob) => {
    setWaiting(null);
    setBusy(true);
    try {
      if (job.ticket) {
        const uri = await zip(job.ticket, job.name);
        if (uri === null) return; // not confirmed: nothing done
        await handOver(uri, 'application/zip', { away: lock.away });
      } else if (job.fetch) {
        const res = await guarded(job.fetch);
        if (!res) return;
        const name = attachmentName(res.headers.get('content-disposition')) ?? job.name;
        await saveCopy(new Uint8Array(await res.arrayBuffer()), name, job.mime, { away: lock.away });
      }
      markWarnedAboutCopies();
      job.onDone?.({ saved: true });
    } catch (err) {
      const words =
        err instanceof NetworkError || (err instanceof DownloadFailed && err.status === null)
          ? t('download.needsConnection')
          : err instanceof DownloadFailed
            ? t(err.status === 404 ? 'download.ticketGone' : 'download.failed')
            : err instanceof ApiRequestError && err.code === 'nothing_to_zip' && job.nothing
              ? job.nothing
              : err instanceof ApiRequestError && err.code === 'zip_too_large'
                ? t('download.tooLarge', { documents: ZIP_MAX_DOCUMENTS, gb: Math.round(ZIP_MAX_BYTES / 1024 ** 3) })
                : wordsFor(err, t, 'download.failed');
      job.onDone?.({ failed: words });
    } finally {
      setBusy(false);
    }
  };

  /** Asked once, the first time a copy leaves the vault (as Save a copy asks). */
  const start = (job: DownloadJob) => {
    if (busy) return;
    if (!warnedAboutCopies()) setWaiting(job);
    else void run(job);
  };

  const sheet = (
    <Sheet visible={waiting !== null} onClose={() => setWaiting(null)} testID="download-warning">
      <Text variant="screen">{t('download.warningTitle')}</Text>
      <Text>{t('document.saveWarning')}</Text>
      <Button label={t('document.saveAnyway')} onPress={() => waiting && void run(waiting)} testID="download-anyway" />
      <Button kind="quiet" label={t('document.saveCancel')} onPress={() => setWaiting(null)} testID="download-not-now" />
    </Sheet>
  );
  return { start, busy, sheet };
}
