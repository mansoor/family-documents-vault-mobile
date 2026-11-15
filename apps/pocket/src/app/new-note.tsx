import { NOTES_MAX, type Visibility } from '@fdv/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { noteVisibilities, secretNoteKey } from '../documents/note-write';
import { wordsFor } from '../errors/words';
import type { NotePayload } from '../queue/note';
import { useCapture, type NoteOutcome } from '../state/capture';
import { emit } from '../state/events';
import { feel } from '../ui/feel';
import { useVault } from '../state/vault';
import { NoteEditor } from '../documents/note-editor';
import { arrivedWhyKey } from '../documents/note-outbox';
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
 *
 * With no answer from the vault (0.13.0) it is saved all the same: on this
 * phone, in the encrypted queue the scans wait in, with who can see it as
 * chosen, and sent by itself once the vault answers (Notes shows it,
 * "Waiting to send"). A save that went and got no answer may be in the
 * vault already: kept as "Might already be in your vault", and never sent
 * again but by its person (Send again in Notes).
 *
 * Opened from Notes with `queued`: that note, not sent yet, changed here —
 * and not sent while it is open. Already on its way, or arrived, its change
 * can't go with it: said so, and Save as a new note keeps what was typed.
 * One sent once under its Idempotency-Key (0.13.1) says that its change
 * waits until the vault has said whether that try landed.
 */
export default function NewNoteScreen() {
  const styles = useStyles(makeStyles);
  const { t } = useTranslation();
  const router = useRouter();
  const { queued } = useLocalSearchParams<{ queued?: string }>();
  const { who, offline } = useVault();
  const capture = useCapture();
  const kept = queued ? capture.notes.find((n) => n.id === queued) : undefined;
  const was = kept?.payload ?? null;
  const [title, setTitle] = useState(was?.title ?? '');
  const [words, setWords] = useState(was?.notes ?? '');
  const [visibility, setVisibility] = useState<Visibility>(was?.visibility ?? 'household');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Its change could not be kept with it (on its way, or arrived): kept as a new note instead, if the person says so.
  const [asNew, setAsNew] = useState(false);
  const tooLong = words.length > NOTES_MAX;
  const secret = secretNoteKey(words, visibility);
  const empty = title.trim() === '' && words.trim() === '';
  const changed = was
    ? title !== (was.title ?? '') || words !== (was.notes ?? '') || visibility !== was.visibility
    : !empty;

  // A queued note found after the screen opened (the queue still loading): what it says, once.
  const filled = useRef(!!was);
  useEffect(() => {
    if (!was || filled.current) return;
    filled.current = true;
    // Once, from the phone's queue: what the person types afterwards is theirs.
    setTitle(was.title ?? '');
    setWords(was.notes ?? '');
    setVisibility(was.visibility);
  }, [was]);

  // Not sent while it is being changed; let go when the screen goes.
  const { holdNote, releaseNote } = capture;
  useEffect(() => {
    if (!queued) return;
    holdNote(queued);
    return () => releaseNote(queued);
  }, [queued, holdNote, releaseNote]);

  const payload = (): NotePayload => ({ title: title.trim() || null, notes: words.trim() || null, visibility });

  /** Kept on the phone: back to where it was written from. */
  const onKept = (out: NoteOutcome): (() => void) | null => {
    if (out.kind === 'refused') {
      setProblem(t(out.problem === 'not_allowed' ? 'capture.notAllowed' : 'newNote.notKept'));
      return null;
    }
    feel('done');
    return () => router.back();
  };

  const saveQueued = async (id: string): Promise<(() => void) | null> => {
    const out = await capture.changeNote(id, payload());
    if (out === 'done') {
      feel('done');
      return () => router.back();
    }
    // On its way as it was, or already there: this change didn't go with it.
    setProblem(t(out === 'sending' ? 'newNote.notWithItSending' : 'newNote.notWithItGone'));
    setAsNew(true);
    return null;
  };

  const save = async (): Promise<(() => void) | null> => {
    if (busy || tooLong || empty) return null;
    setBusy(true);
    setProblem(null);
    try {
      if (queued) return await saveQueued(queued);
      const out = await capture.saveNewNote(payload());
      if (out.kind === 'hidden') {
        // In the vault, and private to the person it's about: Notes says so.
        feel('done');
        return () => router.back();
      }
      if (out.kind !== 'made') return onKept(out);
      feel('done');
      emit('documentChanged', out.id);
      // New note replaced by the note: Back never finds an empty New note.
      return () => router.replace({ pathname: '/document/[id]', params: { id: out.id } });
    } catch (err) {
      setProblem(wordsFor(err, t));
      return null;
    } finally {
      setBusy(false);
    }
  };

  /** "Save as a new note": what was typed, kept to send by itself. */
  const saveAsNew = async (): Promise<(() => void) | null> => {
    if (busy || tooLong || empty) return null;
    setBusy(true);
    try {
      return onKept(await capture.writeNote(payload()));
    } finally {
      setBusy(false);
    }
  };

  const sending = kept?.state === 'sending';
  const unsure = kept?.state === 'unsure';
  const arrived = kept?.state === 'arrived';
  // Sent once under its key, not settled yet: a change waits until the vault says whether that landed (0.13.1).
  const sentOnce = !!kept?.payload?.sent && !unsure && !arrived;
  const unreadable = !!kept && !kept.payload;
  const gone = !!queued && !kept;
  // Arrived while open, or its change refused: what was typed can still be kept, as a new note.
  const newOne = asNew || gone;
  const notice = gone
    ? 'newNote.gone'
    : unreadable
      ? 'notesList.unreadable'
      : sending
        ? 'newNote.sendingNow'
        : unsure
          ? 'notesList.unsureWhy'
          : arrived
            ? arrivedWhyKey(kept?.problem?.code)
            : sentOnce
              ? 'newNote.sentOnce'
              : 'newNote.queuedHint';

  return (
    <EditorFrame
      testID="new-note"
      changed={changed}
      busy={busy}
      save={{
        testID: 'new-note-save',
        label: t(newOne ? 'newNote.saveAsNew' : 'edit.save'),
        disabled: tooLong || empty || (sending && !newOne) || unreadable,
        onPress: newOne ? saveAsNew : save,
      }}
      cancelID="new-note-cancel"
    >
      <Text variant="hero">{t(queued ? 'newNote.queuedTitle' : 'newNote.title')}</Text>
      {queued ? (
        <Notice tone={gone || sending || unsure || arrived || unreadable ? 'warn' : 'info'} testID="new-note-queued">
          {t(notice)}
        </Notice>
      ) : offline ? (
        <Notice tone="info" testID="new-note-offline">
          {t('newNote.offline')}
        </Notice>
      ) : null}
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
