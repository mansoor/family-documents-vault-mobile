import { NOTE_KIND, NOTES_MAX, type Visibility } from '@fdv/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { noteVisibilities, secretNoteKey } from '../documents/note-write';
import { wordsFor } from '../errors/words';
import { emit } from '../state/events';
import { feel } from '../ui/feel';
import { useVault } from '../state/vault';
import { NoteEditor } from '../documents/note-editor';
import { Field, Notice, Text } from '../ui';
import { Chip, ChipRow } from '../ui/chip';
import { EditorFrame } from '../ui/editor-frame';
import { sp } from '../ui/space';
import { useStyles, type Palette } from '../ui/theme';

/**
 * New note (P9), as the web writes one: its title, who can see it, and
 * its words; nothing is kept until Save. Its title is only ever what was
 * typed — nothing of its words goes into it, as they may be sealed — and
 * Only me says so beside it. A note that looks as if it holds a password
 * says so too, and is saved all the same. Saved, it opens as any document.
 */
export default function NewNoteScreen() {
  const styles = useStyles(makeStyles);
  const { t } = useTranslation();
  const router = useRouter();
  const { withToken, who } = useVault();
  const [title, setTitle] = useState('');
  const [words, setWords] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('household');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const tooLong = words.length > NOTES_MAX;
  const secret = secretNoteKey(words, visibility);
  const empty = title.trim() === '' && words.trim() === '';

  const save = async (): Promise<(() => void) | null> => {
    if (busy || tooLong || empty) return null;
    setBusy(true);
    setProblem(null);
    try {
      const made = await withToken((a, tk) =>
        a.createDocument(tk, {
          type_key: NOTE_KIND,
          title: title.trim() || null,
          notes: words.trim() || null,
          visibility,
          owner_member_id: who?.member_id ?? null,
        }),
      );
      feel('done');
      emit('documentChanged', made.id);
      // New note replaced by the note: Back never finds an empty New note.
      return () => router.replace({ pathname: '/document/[id]', params: { id: made.id } });
    } catch (err) {
      setProblem(wordsFor(err, t));
      return null;
    } finally {
      setBusy(false);
    }
  };

  return (
    <EditorFrame
      testID="new-note"
      changed={!empty}
      busy={busy}
      save={{ testID: 'new-note-save', label: t('edit.save'), disabled: tooLong || empty, onPress: save }}
      cancelID="new-note-cancel"
    >
      <Text variant="hero">{t('newNote.title')}</Text>
      <View style={styles.section}>
        <Field
          label={t('newNote.name')}
          value={title}
          onChangeText={setTitle}
          maxLength={200}
          autoCapitalize="sentences"
          testID="new-note-title"
        />
        {visibility === 'private' ? (
          <Text variant="secondary" tone="soft" testID="new-note-only-me">
            {t('newNote.onlyMeTitle')}
          </Text>
        ) : null}
      </View>
      <View style={styles.section}>
        <Text variant="secondary" weight="600" tone="soft">
          {t('visibility.title')}
        </Text>
        <ChipRow label={t('visibility.title')}>
          {noteVisibilities(who?.role).map((v) => (
            <Chip
              key={v}
              label={t(`document.visibility_${v}`)}
              selected={visibility === v}
              onPress={() => setVisibility(v)}
              testID={`new-note-${v}`}
            />
          ))}
        </ChipRow>
      </View>
      <NoteEditor label={t('newNote.words')} value={words} onChange={setWords} testID="new-note-words" />
      <Text variant="secondary" tone={tooLong ? 'danger' : 'muted'} testID="new-note-count">
        {tooLong ? t('newNote.tooLong', { count: words.length }) : t('newNote.notFor')}
      </Text>
      {secret ? (
        <Notice tone="warn" testID="new-note-secret">
          {t(secret)}
        </Notice>
      ) : null}
      {problem ? (
        <Notice tone="warn" testID="new-note-problem">
          {problem}
        </Notice>
      ) : null}
    </EditorFrame>
  );
}

const makeStyles = (_colours: Palette) =>
  StyleSheet.create({
    section: { gap: sp(8) },
  });
