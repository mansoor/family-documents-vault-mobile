import { noteFirstWords, radii } from '@fdv/shared';
import { useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { CircleHelp, CloudUpload, FileWarning, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { wordsForCode } from '../errors/words';
import type { QueueItem } from '../queue/item';
import { useCapture, type QueuedNote } from '../state/capture';
import { Button, Notice, Text } from '../ui';
import { ConfirmSheet } from '../ui/confirm';
import { IconButton } from '../ui/icon-button';
import { sp } from '../ui/space';
import { useColours, useStyles, type Palette } from '../ui/theme';

/** A queued note's name: its title, or its first words, or Untitled note. */
export function queuedNoteName(n: Pick<QueuedNote, 'payload'>, untitled: string): string {
  return n.payload?.title?.trim() || noteFirstWords(n.payload?.notes) || untitled;
}

/** Why a note did not go, in words: the vault's own when it gave them. */
export function couldNotSendWhy(problem: QueueItem['problem'], t: TFunction): string {
  return problem?.message || wordsForCode(problem?.code, t);
}

/** How a queued note stands, in words. */
function stateWords(n: QueuedNote, t: TFunction): string {
  if (!n.payload) return t('notesList.unreadable');
  if (n.state === 'sending') return t('notesList.sending');
  if (n.state === 'unsure') return t('notesList.unsure');
  if (n.state === 'needs_you') return t('notesList.couldNotSend', { reason: couldNotSendWhy(n.problem, t) });
  return t('notesList.waiting');
}

/**
 * Notes written while the vault could not be reached (0.13.0), at the top of
 * Notes until it has them:
 *
 * - "Waiting to send": goes by itself; opened to change it, or deleted.
 * - "Sending…": nothing to do with it until the try ends.
 * - "Might already be in your vault": a try went and no answer came. The
 *   phone never guesses and never sends it again by itself: the person looks
 *   in Notes (Look in Notes), then Sends again — as a new note — or Deletes.
 * - "Couldn't send — {reason}": refused by the vault for a reason trying
 *   again by itself can't fix: Try again, or Delete.
 * - "Couldn't read this note": its words on the phone can't be read: Delete.
 *
 * Every Delete asks first. Once sent, each is an ordinary note below.
 */
export function NoteOutbox(props: { onLookInNotes: () => void }) {
  const styles = useStyles(makeStyles);
  const { t } = useTranslation();
  const capture = useCapture();
  const [deleting, setDeleting] = useState<QueuedNote | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const untitled = t('notesList.untitled');
  if (capture.notes.length === 0 && capture.notesNarrowed.length === 0) return null;
  return (
    <View style={styles.section} testID="notes-outbox">
      {capture.notesNarrowed.length > 0 ? (
        <Notice tone="info" testID="notes-narrowed">
          <Text>{capture.notesNarrowed.map((name) => t('notesList.narrowed', { name })).join(' ')}</Text>
          <Button
            kind="quiet"
            size="small"
            label={t('row.done')}
            onPress={capture.dismissNotesNarrowed}
            testID="notes-narrowed-done"
          />
        </Notice>
      ) : null}
      {capture.notes.length > 0 ? (
        <>
          <Text variant="secondary" weight="600" tone="soft" role="header">
            {t('notesList.waitingTitle')}
          </Text>
          <Text variant="secondary" tone="soft" testID="notes-outbox-why">
            {t('notesList.waitingWhy')}
          </Text>
          {capture.notes.map((n) => (
            <QueuedRow
              key={n.id}
              note={n}
              name={queuedNoteName(n, untitled)}
              onLookInNotes={props.onLookInNotes}
              onDelete={() => {
                setProblem(null);
                setDeleting(n);
              }}
            />
          ))}
        </>
      ) : null}
      <ConfirmSheet
        visible={deleting !== null}
        testID="queued-note-delete-question"
        icon={Trash2}
        title={t('notesList.deleteTitle')}
        words={t(deleting?.state === 'unsure' ? 'notesList.deleteWordsUnsure' : 'notesList.deleteWords', {
          name: deleting ? queuedNoteName(deleting, untitled) : '',
        })}
        confirmLabel={t('notesList.deleteYes')}
        busy={deleteBusy}
        problem={problem}
        onConfirm={() => {
          const n = deleting;
          if (!n || deleteBusy) return;
          setDeleteBusy(true);
          void capture
            .removeNote(n.id)
            .then((r) => {
              if (r === 'sending') setProblem(t('notesList.deleteSending'));
              else setDeleting(null);
            })
            .finally(() => setDeleteBusy(false));
        }}
        onCancel={() => setDeleting(null)}
        confirmID="queued-note-delete-yes"
        cancelID="queued-note-delete-cancel"
        problemID="queued-note-delete-problem"
      />
    </View>
  );
}

function QueuedRow(props: { note: QueuedNote; name: string; onDelete: () => void; onLookInNotes: () => void }) {
  const styles = useStyles(makeStyles);
  const colours = useColours();
  const { t } = useTranslation();
  const router = useRouter();
  const capture = useCapture();
  const n = props.note;
  const state = stateWords(n, t);
  const readable = n.payload !== null;
  const sending = n.state === 'sending';
  const Icon = !readable ? FileWarning : n.state === 'unsure' ? CircleHelp : CloudUpload;
  return (
    <View style={styles.row} testID={`queued-note-${n.id}`}>
      <View style={styles.top}>
        <Pressable
          testID={`queued-note-open-${n.id}`}
          accessibilityRole="button"
          accessibilityLabel={`${props.name}. ${state}`}
          {...(readable && !sending ? { accessibilityHint: t('notesList.openQueuedHint') } : {})}
          disabled={!readable || sending}
          accessibilityState={{ disabled: !readable || sending }}
          onPress={() => router.push({ pathname: '/new-note', params: { queued: n.id } })}
          style={({ pressed }) => [styles.main, pressed ? styles.pressed : null]}
        >
          <Icon color={colours.warn} size={20} accessibilityElementsHidden importantForAccessibility="no" />
          <View style={styles.words}>
            <Text weight="600" numberOfLines={2}>
              {props.name}
            </Text>
            <Text
              variant="secondary"
              tone={n.state === 'needs_you' || !readable ? 'danger' : 'soft'}
              testID={`queued-note-state-${n.id}`}
            >
              {state}
            </Text>
            {readable && n.state === 'unsure' ? (
              <Text variant="secondary" tone="soft" testID={`queued-note-unsure-${n.id}`}>
                {t('notesList.unsureWhy')}
              </Text>
            ) : null}
          </View>
        </Pressable>
        {!sending ? (
          <IconButton
            testID={`queued-note-delete-${n.id}`}
            label={t('notesList.deleteLabel', { name: props.name })}
            icon={Trash2}
            onPress={props.onDelete}
          />
        ) : null}
      </View>
      {readable && n.state === 'needs_you' ? (
        <View style={styles.actions}>
          <Button
            kind="quiet"
            size="small"
            label={t('notesList.tryAgain')}
            accessibilityLabel={t('notesList.tryAgainNamed', { name: props.name })}
            onPress={() => void capture.retry(n.id)}
            testID={`queued-note-retry-${n.id}`}
          />
        </View>
      ) : null}
      {readable && n.state === 'unsure' ? (
        <View style={styles.actions}>
          <Button
            kind="quiet"
            size="small"
            label={t('notesList.lookInNotes')}
            hint={t('notesList.lookInNotesHint')}
            onPress={props.onLookInNotes}
            testID={`queued-note-look-${n.id}`}
          />
          <Button
            kind="quiet"
            size="small"
            label={t('notesList.sendAgain')}
            accessibilityLabel={t('notesList.sendAgainNamed', { name: props.name })}
            onPress={() => void capture.sendNoteAgain(n.id)}
            testID={`queued-note-send-again-${n.id}`}
          />
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    section: { gap: sp(8) },
    row: {
      backgroundColor: colours.surface,
      borderRadius: radii.l,
      borderWidth: 1,
      borderColor: colours.border,
      borderStyle: 'dashed',
      paddingRight: sp(4),
      paddingBottom: sp(4),
    },
    top: { flexDirection: 'row', alignItems: 'center' },
    main: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: sp(12), padding: sp(12), minHeight: 52 },
    pressed: { opacity: 0.8 },
    words: { flex: 1, gap: sp(4) },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: sp(8), paddingHorizontal: sp(12) },
  });
