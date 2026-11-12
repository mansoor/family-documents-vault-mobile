import { NOTE_KIND, NOTES_MAX, type Visibility } from '@fdv/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { noteVisibilities, secretNoteKey } from '../documents/note-write';
import { wordsFor } from '../errors/words';
import { emit } from '../state/events';
import { feel } from '../ui/feel';
import { useVault } from '../state/vault';
import { NoteEditor } from '../documents/note-editor';
import { Button, Field, Notice, Text } from '../ui';
import { Chip, ChipRow } from '../ui/chip';
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
  const insets = useSafeAreaInsets();
  const { withToken, who } = useVault();
  const [title, setTitle] = useState('');
  const [words, setWords] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('household');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const tooLong = words.length > NOTES_MAX;
  const secret = secretNoteKey(words, visibility);
  const empty = title.trim() === '' && words.trim() === '';

  const save = async () => {
    if (busy || tooLong || empty) return;
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
      router.replace({ pathname: '/document/[id]', params: { id: made.id } });
    } catch (err) {
      setProblem(wordsFor(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView
      testID="new-note"
      contentContainerStyle={[styles.page, { paddingTop: sp(20) + insets.top, paddingBottom: sp(20) + insets.bottom }]}
      keyboardShouldPersistTaps="handled"
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
      <Button
        testID="new-note-save"
        label={t('edit.save')}
        busy={busy}
        disabled={tooLong || empty}
        onPress={() => void save()}
      />
      <Button testID="new-note-cancel" kind="quiet" label={t('common.cancel')} disabled={busy} onPress={() => router.back()} />
    </ScrollView>
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    page: { padding: sp(20), gap: sp(16), backgroundColor: colours.bg },
    section: { gap: sp(8) },
  });
