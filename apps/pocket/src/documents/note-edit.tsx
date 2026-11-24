import { ApiRequestError } from '@fdv/client';
import {
  can,
  NOTES_MAX,
  SENSITIVE_LABEL,
  SENSITIVE_MEANS,
  stopSharingWords,
  TEEN_KEEPS_SENSITIVE,
  type DocumentView,
} from '@fdv/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Switch, View } from 'react-native';
import { NoteEditor } from './note-editor';
import { notesConfirm } from './note-confirm';
import { TagsEditor } from './tags-edit';
import { wordsFor } from '../errors/words';
import { StillSharedSheet } from '../sharing/sensitive-confirm';
import { emit } from '../state/events';
import { useStepUp } from '../state/step-up';
import { useVault } from '../state/vault';
import { Field, Notice, Text } from '../ui';
import { EditorFrame } from '../ui/editor-frame';
import { feel } from '../ui/feel';
import { sp } from '../ui/space';
import { useColours } from '../ui/theme';
import { secretNoteKey } from './note-write';

/**
 * What a note's save sends of Sensitive (the owner's request of 24 Nov
 * 2026): only a switch moved from how the note was as the edit began, and
 * only where the note is not so already — never somebody else's change put
 * back by a switch left alone — and never made not sensitive by a teen.
 */
export function sensitiveToSend(p: {
  offered: boolean;
  began: boolean;
  chosen: boolean;
  /** As the vault last said, for the note being saved over. */
  now: boolean;
  teen: boolean;
}): boolean | undefined {
  if (!p.offered || p.chosen === p.began || p.chosen === p.now) return undefined;
  if (!p.chosen && p.teen) return undefined;
  return p.chosen;
}

/**
 * A note, edited (the owner's gaps review, 11 Nov 2026: a note could be
 * made on the phone, never changed): its title and its words, as the web
 * edits one. The title is sent only when this edit changed it, and only by
 * the note's owner, so a save of the words never puts back a title somebody
 * changed meanwhile; anybody else who may change it changes its words.
 * Changed somewhere else since it was opened: nothing is saved, what was
 * typed stays here, and Save again replaces theirs.
 *
 * A note already in the vault is changed only with an answer from it: with
 * none, this says so plainly (0.13.0) — a new note can be written offline,
 * and is sent later, but a change is never kept to send.
 *
 * Its Sensitive is switched here, where the vault has notes that ask
 * (0.9.0-dev.87) and Sensitive, for whoever may change the note (the owner's
 * request of 24 Nov 2026: never while it is only read). It is sent with the
 * words, in the one save — so an Only me or an Essential note confirms it's
 * you once for both — and only when switched (`sensitiveToSend`). A teen
 * may make a note sensitive, never not. Made sensitive while links outside
 * the family still give it, the person is asked whether to end them once it
 * is saved, then the screen goes back. Not saved, nothing changes: Cancel
 * puts the switch back with the rest.
 */
export function NoteEdit(props: { doc: DocumentView; onStale: () => Promise<void> }) {
  const { t } = useTranslation();
  const router = useRouter();
  const colours = useColours();
  const { who, offline, caps } = useVault();
  const { guarded } = useStepUp();
  const { doc } = props;
  const own = !!who && doc.owner_member_id === who.member_id;
  const teen = who?.role === 'teen';
  // Sensitive, for whoever may change the note, where the vault offers it on a note.
  const sensitiveOffered =
    notesConfirm(caps) &&
    caps?.features.sensitive_documents === true &&
    !!who &&
    can(who.role, 'document.edit') &&
    (!teen || own);
  const sensitiveNow = doc.sensitive_effective === true;
  const [sensitiveBegan, setSensitiveBegan] = useState(sensitiveNow);
  const [sensitive, setSensitive] = useState(sensitiveNow);
  // The note read again after somebody else's change (409): Sensitive starts from what it is now. A
  // switch left alone shows it; one the person moved keeps their choice.
  if (sensitiveNow !== sensitiveBegan) {
    if (sensitive === sensitiveBegan) setSensitive(sensitiveNow);
    setSensitiveBegan(sensitiveNow);
  }
  // A teen may make a note sensitive, never not: from where it starts now.
  const teenKeeps = teen && sensitiveBegan;
  // Saved, and still shared outside the family though now sensitive: asked, then gone back.
  const [stillShared, setStillShared] = useState<{ links: number; done: () => void } | null>(null);
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
  const changed =
    titleChanged || words.trim() !== (doc.notes ?? '').trim() || tagsChanged || sensitive !== sensitiveBegan;

  const save = async (): Promise<(() => void) | null> => {
    if (busy || tooLong || empty) return null;
    setBusy(true);
    setProblem(null);
    try {
      const sends = sensitiveToSend({
        offered: sensitiveOffered,
        began: sensitiveBegan,
        chosen: sensitive,
        now: doc.sensitive_effective === true,
        teen,
      });
      const body = {
        notes: words.trim() || null,
        ...(own && titleChanged ? { title: title.trim() || null } : {}),
        ...(tagsChanged ? { tags } : {}),
        ...(sends !== undefined ? { sensitive: sends } : {}),
      };
      const saved = await guarded((a, tk) => a.updateDocument(tk, doc.id, body, doc.etag));
      if (saved === null) return null;
      feel('done');
      emit('documentChanged', saved.id, saved.is_essential);
      const shared = saved.warnings?.find((w) => w.code === 'sensitive_still_shared');
      if (shared?.links) {
        const links = shared.links;
        await new Promise<void>((done) => setStillShared({ links, done }));
        setStillShared(null);
      }
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
      {offline ? (
        <Notice tone="warn" testID="edit-note-offline">
          {t('edit.noteOffline')}
        </Notice>
      ) : null}
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
      {sensitiveOffered ? (
        <View style={styles.row} testID="edit-note-sensitive">
          <View style={styles.flex}>
            <Text weight="600">{SENSITIVE_LABEL}</Text>
            <Text tone="soft" variant="small">
              {teenKeeps ? TEEN_KEEPS_SENSITIVE : SENSITIVE_MEANS}
            </Text>
          </View>
          <Switch
            testID="edit-note-sensitive-switch"
            accessibilityLabel={SENSITIVE_LABEL}
            value={sensitive}
            disabled={busy || teenKeeps}
            onValueChange={setSensitive}
            trackColor={{ true: colours.accent, false: colours.borderInput }}
          />
        </View>
      ) : null}
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
      {stillShared ? (
        <StillSharedSheet
          links={stillShared.links}
          testID="edit-still-shared"
          onEnd={async () => {
            const r = await guarded((a, tk) => a.stopSharing(tk, doc.id));
            if (!r) return t('sensitive.nothingChanged');
            emit('sharesChanged');
            return stopSharingWords(r);
          }}
          onDone={stillShared.done}
        />
      ) : null}
    </EditorFrame>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: sp(12), minHeight: 48 },
  flex: { flex: 1, gap: sp(4) },
});
