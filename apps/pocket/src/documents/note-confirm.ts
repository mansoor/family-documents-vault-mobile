import { ApiRequestError } from '@fdv/client';
import { noteConfirm, type Capabilities, type DocumentView } from '@fdv/shared';

/**
 * Notes that ask "Confirm it's you" (a vault of 0.9.0-dev.87), as
 * documents' files do: an Only me note, and an Essential one. Sensitive
 * alone never asks. Their words are read, and changes saved, only within
 * five minutes of confirming; lists give their title and date alone.
 */

/**
 * Whether this vault has notes that ask, and so offers Essential and
 * Sensitive on a note: its own `features.notes_confirm`, where it lists one
 * (a vault after 0.9.0-dev.87). Not listed, its pre-release part is not
 * compared by the version helpers, so the fallback is `features.auto_lock`,
 * which came in the same release as notes that ask (0.9.0-dev.87) and
 * which every vault since lists.
 */
export function notesConfirm(caps: Pick<Capabilities, 'features'> | null | undefined): boolean {
  const own = (caps?.features as Record<string, unknown> | undefined)?.notes_confirm;
  if (typeof own === 'boolean') return own;
  // Fallback, until the vault lists notes_confirm: auto_lock came with notes that ask.
  return caps?.features.auto_lock === true;
}

/**
 * Whether a note's words are behind "Confirm it's you" (an Only me or an
 * Essential note): its page and its editor are then never captured, as a
 * kept Essential's pages are not.
 */
export function noteAsks(d: Pick<DocumentView, 'type_key' | 'visibility' | 'is_essential'> | null | undefined): boolean {
  if (!d) return false;
  return noteConfirm({ type_key: d.type_key ?? null, visibility: d.visibility, is_essential: d.is_essential === true }) !== null;
}

/** The vault asks to confirm it's you first. */
export function isStepUpRequired(err: unknown): boolean {
  return err instanceof ApiRequestError && err.code === 'step_up_required';
}

/**
 * A note as the vault answered a change to it, with the words kept that the
 * answer may withhold (an Essential or Only me note's, outside the five
 * minutes): what was shown stays shown, never emptied by a save of a switch.
 */
export function keepWords(had: DocumentView | null, next: DocumentView): DocumentView {
  if (next.notes !== null || !next.confirm_to_read || !had || had.id !== next.id || had.notes === null) return next;
  const { confirm_to_read: _withheld, ...rest } = next;
  void _withheld;
  return { ...rest, notes: had.notes };
}
