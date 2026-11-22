import * as Print from 'expo-print';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';
import { log } from '../log';
import { exactWords, useFamilyZone } from '../state/family-time';
import { useLock } from '../state/lock';
import { useVault } from '../state/vault';
import type { Foot } from './html';

/**
 * The platform's print (0.21.0): Android's print screen, where a printer is
 * chosen or the page saved as a PDF, and the same on an iPhone. The app's
 * lock waits while it is open, as it does round the share sheet: the print
 * screen is the phone's own, not somebody leaving the app.
 *
 * In the browser build, the page is printed from a frame of its own, so
 * nothing of the app is printed with it.
 */

export type PrintOutcome = 'printed' | 'failed';

/** The browser build: a frame holding only the page, printed and then taken away. */
async function printInBrowser(html: string): Promise<void> {
  const doc = (globalThis as { document?: Document }).document;
  if (!doc) throw new Error('no page to print from');
  const frame = doc.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.position = 'fixed';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  frame.srcdoc = html;
  await new Promise<void>((resolve) => {
    frame.onload = () => resolve();
    doc.body.appendChild(frame);
  });
  frame.contentWindow?.focus();
  frame.contentWindow?.print();
  setTimeout(() => frame.remove(), 1_000);
}

/** Printing, and the words at the foot of each page: the vault's name and the time, on the family's clock. */
export function usePrint() {
  const { t } = useTranslation();
  const zone = useFamilyZone();
  const { caps } = useVault();
  const lock = useLock();
  const vaultName = caps?.branding.display_name?.trim() || t('print.theVault');

  const foot = useCallback(
    (): Foot => ({ words: t('print.foot', { vault: vaultName, when: exactWords(new Date().toISOString(), zone) }) }),
    [t, vaultName, zone],
  );

  const print = useCallback(
    async (html: string): Promise<PrintOutcome> => {
      try {
        if (Platform.OS === 'web') await printInBrowser(html);
        else await lock.away(() => Print.printAsync({ html }));
        return 'printed';
      } catch (err) {
        // Closing the print screen is not a failure; anything else is said, never what was printed.
        const words = String((err as Error | undefined)?.message ?? err);
        if (/cancel/i.test(words)) return 'printed';
        log.warn('print.failed', { kind: 'platform' });
        return 'failed';
      }
    },
    [lock],
  );

  return { print, foot };
}
