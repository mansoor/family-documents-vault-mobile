import type { TFunction } from 'i18next';

/**
 * What to say after "Scan the new one" or "Add a new version" (4.12):
 * every result the capture can give, in the words Home uses. Null when
 * there is nothing to say (cancelled, or going on to the card).
 */
export function renewWords(outcome: string, t: TFunction): { tone: 'ok' | 'warn'; text: string } | null {
  switch (outcome) {
    case 'saved':
      return { tone: 'ok', text: t('home.savedRenewal') };
    case 'failed':
      return { tone: 'warn', text: t('home.scannerFailed') };
    case 'too_big':
      return { tone: 'warn', text: t('capture.tooBig') };
    case 'no_space':
      return { tone: 'warn', text: t('capture.noSpace') };
    case 'queue_unavailable':
      return { tone: 'warn', text: t('capture.queueUnavailable') };
    case 'unreadable':
    case 'too_many_pages':
      return { tone: 'warn', text: t('capture.unreadable') };
    case 'not_allowed':
      return { tone: 'warn', text: t('capture.notAllowed') };
    default:
      return null;
  }
}
