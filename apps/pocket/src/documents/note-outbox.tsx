import { ApiRequestError } from '@fdv/client';
import { noteFirstWords, radii } from '@fdv/shared';
import { useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { CircleHelp, CloudUpload, FileWarning, Trash2 } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { wordsFor, wordsForCode } from '../errors/words';
import type { QueueItem } from '../queue/item';
import { useCapture, type QueuedNote } from '../state/capture';
import { emit } from '../state/events';
import { useStepUp } from '../state/step-up';
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

/**
 * What a note in the vault with its earlier words says (0.13.1): made as it
 * first went; an earlier version kept under its key (422); or made, and kept
 * private since by the person it's about (404 created_not_visible).
 */
export function arrivedWhyKey(code: string | null | undefined): string {
  if (code === 'idempotency_key_reused') return 'notesList.arrivedWhyReused';
  if (code === 'created_not_visible') return 'notesList.arrivedWhyHidden';
  return 'notesList.arrivedWhy';
}

/** How a queued note stands, in words. */
function stateWords(n: QueuedNote, t: TFunction): string {
  if (!n.payload) return t('notesList.unreadable');
  if (n.state === 'sending') return t('notesList.sending');
  if (n.state === 'unsure') return t('notesList.unsure');
  if (n.state === 'arrived') return t('notesList.arrived');
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
 * - "In your vault, with its earlier words" (0.13.1): sent under its key,
 *   then changed here; the vault has it as it first went. Put my changes in
 *   that note (when the vault said where it is, and who can see it is
 *   unchanged), Send as a new note (the change, under a new key), or
 *   Discard changes, asked first.
 * - Might already be in your vault, still within its key's day (0.13.1):
 *   Send again goes under the same key, which settles it.
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
  if (capture.notes.length === 0 && capture.notesNarrowed.length === 0 && capture.notesHidden.length === 0) return null;
  const discarding = deleting?.state === 'arrived';
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
      <HiddenSaid names={capture.notesHidden} onShown={capture.sawNotesHidden} onDone={capture.dismissNotesHidden} />
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
        title={t(discarding ? 'notesList.discardTitle' : 'notesList.deleteTitle')}
        words={t(
          discarding
            ? 'notesList.discardWords'
            : deleting?.state === 'unsure' || deleting?.payload?.sent
              ? 'notesList.deleteWordsUnsure'
              : 'notesList.deleteWords',
          { name: deleting ? queuedNoteName(deleting, untitled) : '' },
        )}
        confirmLabel={t(discarding ? 'notesList.discardYes' : 'notesList.deleteYes')}
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

/** Notes said kept private now: once shown, no longer kept on the phone to say again. */
function HiddenSaid(props: { names: string[]; onShown: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const { names, onShown } = props;
  useEffect(() => {
    if (names.length > 0) onShown();
  }, [names, onShown]);
  if (names.length === 0) return null;
  return (
    <Notice tone="info" testID="notes-hidden">
      <Text>{names.map((name) => t('notesList.hidden', { name })).join(' ')}</Text>
      <Button kind="quiet" size="small" label={t('row.done')} onPress={props.onDone} testID="notes-hidden-done" />
    </Notice>
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
  const arrived = n.state === 'arrived';
  const Icon = !readable ? FileWarning : n.state === 'unsure' || arrived ? CircleHelp : CloudUpload;
  // The question a row asks is read with it, never hidden behind the row's own label.
  const why = !readable
    ? null
    : n.state === 'unsure'
      ? t('notesList.unsureWhy')
      : arrived
        ? t(arrivedWhyKey(n.problem?.code))
        : null;
  const { guarded } = useStepUp();
  const [putBusy, setPutBusy] = useState(false);
  const [putProblem, setPutProblem] = useState<string | null>(null);
  const landed = arrived && !n.problem ? n.payload?.landed : undefined;
  // Into that note only with who can see it as it is there: never wider.
  const canPut = !!landed && n.payload?.visibility === landed.visibility;
  const putInto = async () => {
    const p = n.payload;
    if (!landed || !p || putBusy) return;
    setPutBusy(true);
    setPutProblem(null);
    try {
      const body = { title: p.title?.trim() || null, notes: p.notes?.trim() || null };
      const saved = await guarded((a, tk) => a.updateDocument(tk, landed.id, body, landed.etag ?? undefined));
      if (saved === null) return;
      emit('documentChanged', saved.id);
      // In that note now: nothing of it left to send.
      await capture.removeNote(n.id);
    } catch (err) {
      setPutProblem(
        err instanceof ApiRequestError && err.status === 409 ? t('notesList.putIntoChanged') : wordsFor(err, t),
      );
    } finally {
      setPutBusy(false);
    }
  };
  return (
    <View style={styles.row} testID={`queued-note-${n.id}`}>
      <View style={styles.top}>
        <Pressable
          testID={`queued-note-open-${n.id}`}
          accessibilityRole="button"
          accessibilityLabel={why ? `${props.name}. ${state}. ${why}` : `${props.name}. ${state}`}
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
            {readable && arrived ? (
              <Text variant="secondary" tone="soft" testID={`queued-note-arrived-${n.id}`}>
                {t(arrivedWhyKey(n.problem?.code))}
              </Text>
            ) : null}
          </View>
        </Pressable>
        {!sending ? (
          <IconButton
            testID={`queued-note-delete-${n.id}`}
            label={t(arrived ? 'notesList.discardChangesNamed' : 'notesList.deleteLabel', { name: props.name })}
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
            accessibilityLabel={t(n.settles ? 'notesList.sendAgainSameNamed' : 'notesList.sendAgainNamed', {
              name: props.name,
            })}
            onPress={() => void capture.sendNoteAgain(n.id)}
            testID={`queued-note-send-again-${n.id}`}
          />
        </View>
      ) : null}
      {readable && arrived ? (
        <View style={styles.actions}>
          {canPut ? (
            <Button
              kind="quiet"
              size="small"
              label={t('notesList.putInto')}
              accessibilityLabel={t('notesList.putIntoNamed', { name: props.name })}
              onPress={() => void putInto()}
              disabled={putBusy}
              testID={`queued-note-put-into-${n.id}`}
            />
          ) : null}
          <Button
            kind="quiet"
            size="small"
            label={t('notesList.sendChanges')}
            accessibilityLabel={t('notesList.sendChangesNamed', { name: props.name })}
            onPress={() => void capture.sendNoteAgain(n.id)}
            testID={`queued-note-send-changes-${n.id}`}
          />
          <Button
            kind="quiet"
            size="small"
            label={t('notesList.discardChanges')}
            accessibilityLabel={t('notesList.discardChangesNamed', { name: props.name })}
            onPress={props.onDelete}
            testID={`queued-note-discard-${n.id}`}
          />
        </View>
      ) : null}
      {putProblem ? (
        <Notice tone="warn" testID={`queued-note-put-problem-${n.id}`}>
          {putProblem}
        </Notice>
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
