import { can, looksSecret, noteFirstWords, notesPlainText, type NoteSummary, type Role, type Visibility } from '@fdv/shared';

/**
 * Notes on the phone (P9), by the web's rules (0.9.0, N1). Pure, so the
 * rules are tested without drawing a screen.
 */

/** A note in the list: its title, or its first words, or `untitled`. */
export function noteListName(n: Pick<NoteSummary, 'title' | 'preview'>, untitled: string): string {
  return n.title?.trim() || noteFirstWords(n.preview) || untitled;
}

/**
 * Who can see a new note: Everyone in the family, Only me, and Adults only
 * for whoever sees adults' documents — never a teen's to choose.
 */
export function noteVisibilities(role: Role | null | undefined): Visibility[] {
  return role && can(role, 'document.see_adults') ? ['household', 'adults', 'private'] : ['household', 'private'];
}

/**
 * Whether a note looks as if it holds a password or a PIN, and so what is
 * said before it is saved: never refused (a note is not a password manager,
 * and the family can read and search one that is not Only me). The words of
 * each line are looked at as a tag's are: "wifi password: …", "the PIN is
 * 4821". Null when nothing looks secret; else the i18n key to say.
 */
export function secretNoteKey(words: string, visibility: Visibility): string | null {
  const lines = notesPlainText(words.slice(0, 4_000)).split('\n').slice(0, 200);
  if (!lines.some((line) => looksSecret(line.slice(0, 80)))) return null;
  return visibility === 'private' ? 'newNote.secretOnlyMe' : 'newNote.secret';
}
