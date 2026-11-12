import { ApiRequestError } from '@fdv/client';
import { issuedByLabel, NOTE_KIND, NOTES_MAX, type DocumentView } from '@fdv/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { andList, chooseOwner, chooseType, coreAsk, detailError, ownFields, typeOf, type CardCore, type Draft, type FieldErrors, type Household } from '../../capture/draft';
import { KindChooser, OwnerChooser } from '../../capture/choose';
import { Chip, ChipRow, detailInput } from '../../capture/ui';
import { draftOf, editBody } from '../../documents/edit';
import { NoteEdit } from '../../documents/note-edit';
import { TagsEditor } from '../../documents/tags-edit';
import { wordsFor } from '../../errors/words';
import { emit } from '../../state/events';
import { feel } from '../../ui/feel';
import { useStepUp } from '../../state/step-up';
import { useVault } from '../../state/vault';
import { Button, Field, Notice, requiredLabel, Text } from '../../ui';
import { sp } from '../../ui/space';
import { LoadFailed, loadFailure, Placeholder } from '../../ui/states';
import { useColours, useStyles, type Palette } from '../../ui/theme';

/**
 * Edit details (P8; the owner's decision of 7 Nov 2026: the phone may
 * correct a document's details). The capture card's questions, filled from
 * the document: what it is, whose it is, its name, the fixed fields its
 * kind shows, and the kind's own details. Save checks what the card checks
 * and sends the whole card; a vault that keeps each version's details is
 * told they are now confirmed for the newest version. Changed somewhere
 * else since it was opened: nothing is saved, and it says so.
 *
 * Since the gaps review (11 Nov 2026) it also writes the document's own
 * note, where the vault keeps one that can be written (5.35), and its
 * tags; each is sent only when it was changed. A note kept on its own is
 * edited as a note: its title and its words (`NoteEdit`).
 */
export default function EditScreen() {
  const styles = useStyles(makeStyles);
  const colours = useColours();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { withToken, caps, who } = useVault();
  const { guarded } = useStepUp();
  const [doc, setDoc] = useState<DocumentView | null>(null);
  const [household, setHousehold] = useState<Household | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [fields, setFields] = useState<FieldErrors>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Its note and its tags, beside the card's questions.
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState<string[]>([]);

  const load = useCallback(async () => {
    if (!who) return;
    try {
      const [d, ty, m] = await withToken((a, tk) =>
        Promise.all([a.document(tk, id), a.documentTypes(tk), a.members(tk)]),
      );
      setDoc(d);
      setDraft(draftOf(d));
      setNotes(d.notes ?? '');
      setTags(d.tags ?? []);
      setHousehold({
        types: ty.items,
        members: m.items,
        me: { member_id: who.member_id, role: who.role },
        issuedBy: caps?.features.issued_by === true,
        details: caps?.features.custom_types === true,
        householdOwner: caps?.features.household_owner === true,
      });
      setFailed(null);
    } catch (err) {
      setFailed(loadFailure('edit', err, t) ?? t('document.offline'));
    }
  }, [withToken, id, who, caps, t]);

  useEffect(() => {
    // Loaded on arrival; the state is set after the requests answer.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (!doc || !draft || !household) {
    return (
      <View style={styles.page} testID="edit">
        {failed ? <LoadFailed words={failed} onRetry={() => void load()} /> : <Placeholder rows={2} />}
      </View>
    );
  }

  // A note kept on its own: its title and its words.
  if (doc.type_key === NOTE_KIND) return <NoteEdit doc={doc} onStale={load} />;

  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const setDetail = (key: string, v: string | boolean) =>
    setDraft((d) => (d ? { ...d, details: { ...d.details, [key]: v } } : d));
  const type = typeOf(draft, household);
  const teen = who?.role === 'teen';
  const ask = (key: CardCore) => coreAsk(type, key, household);
  const cardWord: Record<CardCore, string> = {
    issued_by: issuedByLabel(type),
    identifier: t('capture.number'),
    issued: t('capture.issued'),
    expires: t('capture.expires'),
    physical_location: t('capture.location'),
  };
  const coreLabel = (key: CardCore) => ask(key).label ?? cardWord[key];
  const requiredWord = (required: boolean | undefined) => (required ? t('capture.required') : null);
  const own = ownFields(type, household);
  const labelOf = (key: string) =>
    (Object.keys(cardWord) as CardCore[]).includes(key as CardCore)
      ? coreLabel(key as CardCore)
      : (own.find((f) => f.key === key)?.label ?? key);

  // Its note can be written where the vault says when a note last changed (5.35).
  const writesNotes = doc.notes_updated_at !== undefined;
  const notesLabel = type?.core?.notes?.label?.trim() || t('document.notes');
  const notesTooLong = notes.length > NOTES_MAX;

  const save = async () => {
    if (busy) return;
    const out = editBody(draft, household, { confirm: caps?.features.version_details === true });
    setFields(out.fields);
    if (!out.body) {
      setProblem(
        out.problem ??
          (out.missing.length > 0 ? t('edit.stillNeeded', { fields: andList(out.missing.map(labelOf)) }) : null),
      );
      return;
    }
    if (notesTooLong) {
      setProblem(t('newNote.tooLong', { count: notes.length }));
      return;
    }
    // The note and the tags only when changed: an edit of the card never puts back what somebody wrote meanwhile.
    if (writesNotes && notes.trim() !== (doc.notes ?? '').trim()) out.body.notes = notes.trim() || null;
    if (JSON.stringify(tags) !== JSON.stringify(doc.tags ?? [])) out.body.tags = tags;
    setBusy(true);
    setProblem(null);
    try {
      // Through the step-up, as the page's own Essential switch is.
      const saved = await guarded((a, tk) => a.updateDocument(tk, doc.id, out.body ?? {}, doc.etag));
      if (saved === null) return;
      feel('done');
      emit('documentChanged', saved.id);
      router.back();
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 409 && err.code === 'conflict') {
        setProblem(t('edit.changed'));
        await load();
      } else {
        setProblem(wordsFor(err, t));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView
      testID="edit"
      contentContainerStyle={[styles.page, { paddingTop: sp(20) + insets.top, paddingBottom: sp(20) + insets.bottom }]}
      keyboardShouldPersistTaps="handled"
    >
      <Text variant="hero">{t('edit.title')}</Text>

      <View style={styles.section}>
        <Text variant="screen">{t('capture.whatItIs')}</Text>
        <KindChooser
          types={household.types}
          chosen={draft.typeKey}
          onChoose={(k) => setDraft((d) => (d ? chooseType(d, k, household) : d))}
          label={t('capture.whatItIs')}
          ids={{ more: 'edit-types-more', find: 'edit-types-search', picker: 'edit-types-picker', chip: 'edit-type' }}
        />
      </View>

      <View style={styles.section}>
        <Text variant="screen">{t('capture.whoseItIs')}</Text>
        <OwnerChooser
          members={household.members}
          me={who?.member_id ?? null}
          teen={teen}
          chosen={draft.ownerId}
          household={draft.household}
          householdOn={household.householdOwner === true}
          onChoose={(id) => setDraft((d) => (d ? chooseOwner(d, id, household) : d))}
          label={t('capture.whoseItIs')}
          ids={{ more: 'edit-owners-more', picker: 'edit-owners-picker', chip: 'edit-owner' }}
        />
      </View>

      <View style={styles.section}>
        <Field
          label={t('capture.name')}
          value={draft.title}
          onChangeText={(v) => set({ title: v })}
          autoCapitalize="sentences"
          testID="edit-name"
        />
        {ask('issued_by').shown ? (
          <Field
            label={coreLabel('issued_by')}
            required={requiredWord(ask('issued_by').required)}
            value={draft.issuedBy}
            onChangeText={(v) => set({ issuedBy: v })}
            autoCapitalize="words"
            testID="edit-issued-by"
          />
        ) : null}
        {ask('identifier').shown ? (
          <Field
            label={coreLabel('identifier')}
            required={requiredWord(ask('identifier').required)}
            value={draft.identifier}
            onChangeText={(v) => set({ identifier: v })}
            testID="edit-number"
          />
        ) : null}
        {ask('issued').shown ? (
          <Field
            label={coreLabel('issued')}
            required={requiredWord(ask('issued').required)}
            value={draft.issued}
            onChangeText={(v) => set({ issued: v })}
            placeholder="14 Mar 2021"
            error={fields.issued ?? null}
            testID="edit-issued"
          />
        ) : null}
        {ask('expires').shown ? (
          <Field
            label={coreLabel('expires')}
            required={requiredWord(ask('expires').required)}
            value={draft.expires}
            onChangeText={(v) => set({ expires: v })}
            placeholder="14 Mar 2031"
            error={fields.expires ?? null}
            testID="edit-expires"
          />
        ) : null}
        <Text variant="secondary" tone="muted">
          {t('capture.dateHint')}
        </Text>
        {ask('physical_location').shown ? (
          <Field
            label={coreLabel('physical_location')}
            required={requiredWord(ask('physical_location').required)}
            value={draft.location}
            onChangeText={(v) => set({ location: v })}
            autoCapitalize="sentences"
            testID="edit-location"
          />
        ) : null}
        {own.map((f) => {
          const value = draft.details[f.key];
          const error = fields[detailError(f.key)] ?? null;
          const required = requiredWord(f.required);
          if (f.kind === 'yes_no') {
            return (
              <View key={f.key} style={styles.switchRow}>
                <Text weight="600" style={styles.flex}>
                  {requiredLabel(f.label, required)}
                </Text>
                <Switch
                  accessibilityLabel={required ? `${f.label}, ${required}` : f.label}
                  value={value === true}
                  onValueChange={(v) => setDetail(f.key, v)}
                  trackColor={{ true: colours.accent, false: colours.borderInput }}
                  testID={`edit-detail-${f.key}`}
                />
              </View>
            );
          }
          if (f.kind === 'choice') {
            return (
              <View key={f.key} style={styles.section}>
                <Text variant="secondary" weight="600" tone="soft">
                  {requiredLabel(f.label, required)}
                </Text>
                <ChipRow label={required ? `${f.label}, ${required}` : f.label}>
                  {(f.choices ?? []).map((c) => (
                    <Chip key={c} label={c} selected={value === c} onPress={() => setDetail(f.key, value === c ? '' : c)} />
                  ))}
                </ChipRow>
                {error ? (
                  <Text variant="secondary" tone="danger" role="alert">
                    {error}
                  </Text>
                ) : null}
              </View>
            );
          }
          return (
            <Field
              key={f.key}
              label={f.label}
              required={required}
              value={typeof value === 'string' ? value : ''}
              onChangeText={(v) => setDetail(f.key, v)}
              error={error}
              testID={`edit-detail-${f.key}`}
              {...detailInput(f.kind)}
            />
          );
        })}
      </View>

      <View style={styles.section}>
        {writesNotes ? (
          <Field
            label={notesLabel}
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={5}
            textAlignVertical="top"
            autoCapitalize="sentences"
            error={notesTooLong ? t('newNote.tooLong', { count: notes.length }) : null}
            testID="edit-notes"
          />
        ) : null}
        <TagsEditor tags={tags} onChange={setTags} />
      </View>

      {problem ? (
        <Notice tone="warn" testID="edit-problem">
          {problem}
        </Notice>
      ) : null}
      <Button label={t('edit.save')} busy={busy} onPress={() => void save()} testID="edit-save" />
      <Button label={t('common.cancel')} kind="quiet" disabled={busy} onPress={() => router.back()} testID="edit-cancel" />
    </ScrollView>
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    page: { padding: sp(20), gap: sp(16), backgroundColor: colours.bg },
    section: { gap: sp(10) },
    row: { flexDirection: 'row' },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: sp(12), minHeight: 44 },
    flex: { flex: 1 },
  });
