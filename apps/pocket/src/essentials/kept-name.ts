import { documentName, NOTE_KIND, type DocumentView } from '@fdv/shared';
import type { TFunction } from 'i18next';

/**
 * A kept copy's name in a list or a chip (Home, On this phone, the
 * viewer's heading). A note is named by its title alone, or "Untitled
 * note": never by its first words, which are behind "Confirm it's you" for
 * an Essential or Only me note everywhere the vault lists it, and so are
 * here too. Anything else as everywhere.
 */
export function keptName(d: Pick<DocumentView, 'title' | 'type_key' | 'note_name'>, t: TFunction): string {
  if (d.type_key === NOTE_KIND) return d.title?.trim() || t('notesList.untitled');
  return documentName(d, t('document.untitled'));
}
