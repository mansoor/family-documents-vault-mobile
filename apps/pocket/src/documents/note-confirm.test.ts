import { ApiRequestError } from '@fdv/client';
import type { DocumentView } from '@fdv/shared';
import { isStepUpRequired, keepWords, noteAsks, notesConfirm } from './note-confirm';

const note = (over: Partial<DocumentView> = {}) =>
  ({ id: 'n1', type_key: 'note', visibility: 'household', is_essential: false, notes: 'Words', ...over }) as DocumentView;

describe('notes that ask "Confirm it\'s you" (0.9.0-dev.87)', () => {
  it('a save whose answer withholds the words keeps those shown, and drops the mark that they wait', () => {
    const had = note({ notes: 'The code is 4821.' });
    const answered = note({ notes: null, is_essential: true, confirm_to_read: 'open_essential' });
    const kept = keepWords(had, answered);
    expect(kept.notes).toBe('The code is 4821.');
    expect(kept.is_essential).toBe(true);
    expect(kept.confirm_to_read).toBeUndefined();
  });

  it('an answer with its words, another note, or nothing shown before: the answer as it is', () => {
    const answered = note({ notes: null, confirm_to_read: 'open_essential' });
    expect(keepWords(note({ notes: 'x' }), note({ notes: 'y' })).notes).toBe('y');
    expect(keepWords(note({ id: 'other', notes: 'x' }), answered)).toBe(answered);
    expect(keepWords(null, answered)).toBe(answered);
    expect(keepWords(note({ notes: null }), answered)).toBe(answered);
  });

  it('only an Only me or an Essential note asks; Sensitive alone, or a document, never', () => {
    expect(noteAsks(note({ visibility: 'private' }))).toBe(true);
    expect(noteAsks(note({ is_essential: true }))).toBe(true);
    expect(noteAsks(note({ sensitive: true }))).toBe(false);
    expect(noteAsks(note({ type_key: 'passport', visibility: 'private' }))).toBe(false);
    expect(noteAsks(null)).toBe(false);
  });

  it('the vault says so by notes_confirm; without it, by auto_lock, which came with notes that ask', () => {
    const f = (features: Record<string, unknown>) => ({ features }) as never;
    expect(notesConfirm(f({ notes_confirm: true }))).toBe(true);
    expect(notesConfirm(f({ notes_confirm: false, auto_lock: true }))).toBe(false);
    expect(notesConfirm(f({ auto_lock: true }))).toBe(true);
    expect(notesConfirm(f({}))).toBe(false);
    expect(notesConfirm(null)).toBe(false);
  });

  it('tells a step-up asked for from anything else', () => {
    expect(isStepUpRequired(new ApiRequestError(403, 'step_up_required', 'x', 'open_essential'))).toBe(true);
    expect(isStepUpRequired(new Error('step_up_required'))).toBe(false);
  });
});
