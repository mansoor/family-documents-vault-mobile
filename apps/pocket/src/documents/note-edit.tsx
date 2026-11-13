import { ApiRequestError } from '@fdv/client';
import { NOTES_MAX, type DocumentView } from '@fdv/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NoteEditor } from './note-editor';
import { TagsEditor } from './tags-edit';
import { wordsFor } from '../errors/words';
import { emit } from '../state/events';
import { useStepUp } from '../state/step-up';
import { useVault } from '../state/vault';
import { Field, Notice, Text } from '../ui';
import { EditorFrame } from '../ui/editor-frame';
import { feel } from '../ui/feel';
import { secretNoteKey } from './note-write';

/**
 * A note, edited (the owner's gaps review, 11 Nov 2026: a note could be
 * made on the phone, never changed): its title and its words, as the web
 * edits one. The title is sent only when this edit changed it, and only by
 * the note's owner, so a save of the words never puts back a title somebody
 * changed meanwhile; anybody else who may change it changes its words.
 * Changed somewhere else since it was opened: nothing is saved, what was
 * typed stays here, and Save again replaces theirs.
 */
export function NoteEdit(props: { doc: DocumentView; onStale: () => Promise<void> }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { who } = useVault();
  const { guarded } = useStepUp();
  const { doc } = props;
  const own = !!who && doc.owner_member_id === who.member_id;
  const [title, setTitle] = useState(doc.title ?? '');
  const [words, setWords] = useState(doc.notes ?? '');
  // Its tags, as a document's are (the owner's tidy-up of 11 Nov 2026): sent only when changed.
  const [tags, setTags] = useState<string[]>(doc.tags ?? []);
  const tagsChanged = JSON.stringify(tags) !== JSON.stringify(doc.tags ?? []);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const tooLong = words.length > NOTES_MAX;
  const secret = secretNoteKey(words, doc.visibility);
  const titleChanged = title.trim() !== (doc.title ?? '').trim();
  const empty = title.trim() === '' && words.trim() === '';
  const changed = titleChanged || words.trim() !== (doc.notes ?? '').trim() || tagsChanged;

  const save = async (): Promise<(() => void) | null> => {
    if (busy || tooLong || empty) return null;
    setBusy(true);
    setProblem(null);
    try {
      const body = {
        notes: words.trim() || null,
        ...(own && titleChanged ? { title: title.trim() || null } : {}),
        ...(tagsChanged ? { tags } : {}),
      };
      const saved = await guarded((a, tk) => a.updateDocument(tk, doc.id, body, doc.etag));
      if (saved === null) return null;
      feel('done');
      emit('documentChanged', saved.id);
      return () => router.back();
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 409) {
        setProblem(t('edit.changedNote'));
        // Its newer copy, for the next Save; what was typed stays.
        await props.onStale();
      } else {
        setProblem(wordsFor(err, t));
      }
      return null;
    } finally {
      setBusy(false);
    }
  };

  return (
    <EditorFrame
      testID="edit"
      changed={changed}
      busy={busy}
      save={{ testID: 'edit-save', label: t('edit.save'), disabled: tooLong || empty, onPress: save }}
      cancelID="edit-cancel"
    >
      <Text variant="hero">{t('edit.noteTitle')}</Text>
      {own ? (
        <Field
          label={t('newNote.name')}
          value={title}
          onChangeText={setTitle}
          maxLength={200}
          autoCapitalize="sentences"
          testID="edit-note-title"
        />
      ) : (
        <Text weight="600" testID="edit-note-title-fixed">
          {doc.title ?? t('document.untitled')}
        </Text>
      )}
      <NoteEditor label={t('newNote.words')} value={words} onChange={setWords} testID="edit-note-words" />
      <Text variant="secondary" tone={tooLong ? 'danger' : 'muted'} testID="edit-note-count">
        {tooLong ? t('newNote.tooLong', { count: words.length }) : t('newNote.notFor')}
      </Text>
      <TagsEditor tags={tags} onChange={setTags} />
      {secret ? (
        <Notice tone="warn" testID="edit-note-secret">
          {t(secret)}
        </Notice>
      ) : null}
      {problem ? (
        <Notice tone="warn" testID="edit-problem">
          {problem}
        </Notice>
      ) : null}
    </EditorFrame>
  );
}
