import { ApiRequestError } from '@fdv/client';
import { EMERGENCY_EDIT_REFUSAL, EMERGENCY_FIELD_LABELS, EMERGENCY_NOT_ADVICE, formatDate, radii, type EmergencyView } from '@fdv/shared';
import { useRouter } from 'expo-router';
import { Eraser, Trash2 } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { wordsFor } from '../errors/words';
import { useScreenGuard } from '../state/lock';
import { useStepUp } from '../state/step-up';
import { useVault } from '../state/vault';
import { Button, Field, Notice, Text } from '../ui';
import { Chip, ChipRow } from '../ui/chip';
import { ConfirmSheet } from '../ui/confirm';
import { EditorFrame } from '../ui/editor-frame';
import { feel } from '../ui/feel';
import { sp } from '../ui/space';
import { LoadFailed, loadFailure, Placeholder } from '../ui/states';
import { useStyles, type Palette } from '../ui/theme';
import {
  BLOOD_TYPES,
  cleared,
  draftChanged,
  draftOf,
  entryBlank,
  INSURANCE_MAX,
  INSURANCE_PARTS,
  insuranceTyped,
  LIST_KEYS,
  LIST_MAX,
  LIST_PARTS,
  NOTES_MAX,
  PART_MAX,
  readDraft,
  typedEntries,
  withNew,
  withPart,
  without,
  type Clearable,
  type Draft,
  type ListKey,
} from './edit-model';
import { sayOnEmergencyPage } from './said';

type Load =
  | { kind: 'loading' }
  | { kind: 'offline' }
  | { kind: 'none' }
  | { kind: 'failed'; words: string }
  | { kind: 'ready'; view: EmergencyView };

type Asking = { kind: 'remove'; key: ListKey; id: string; name: string } | { kind: 'clear'; what: Clearable } | null;

/**
 * Editing a person's emergency information on the phone (app 0.19.0; the
 * vault's H4): every part the web's editor has — blood type, allergies,
 * medications, conditions, doctors, who to call, insurance and anything
 * else — as one compact form, Cancel and Save at its foot. For the person
 * and the owners (the vault's `can_edit`); anybody else is told so in the
 * vault's words.
 *
 * Saved whole, from the version read (If-Match): somebody else's change
 * meanwhile is never written over unknowingly — what was typed stays, the
 * page is read again for its version, and it says so: Save again puts this
 * in place of theirs; Cancel and open it again shows theirs. Removing an entry with anything in it, or
 * clearing a part, is asked first; nothing goes until Save. Changing it
 * needs a connection, said plainly; what was typed stays until Cancel.
 *
 * As the page itself: never kept on the phone, and no screenshots.
 */
export function EmergencyEditor(props: { id: string; name?: string }) {
  useScreenGuard('emergency');
  const styles = useStyles(makeStyles);
  const { t } = useTranslation();
  const router = useRouter();
  const { withToken, offline, who } = useVault();
  const { guarded } = useStepUp();
  const { id } = props;
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [name, setName] = useState(props.name ?? '');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [unnamed, setUnnamed] = useState<Set<string>>(new Set());
  const [goTo, setGoTo] = useState<{ id: string; at: object } | null>(null);
  const [asking, setAsking] = useState<Asking>(null);
  const insets = useSafeAreaInsets();
  const mine = who?.member_id === id;

  /** The page as the vault has it now; the form starts from it. */
  const read = useCallback(async (): Promise<EmergencyView | null> => {
    try {
      const view = await withToken((a, tk) => a.emergencyOf(tk, id));
      if (!props.name) {
        await withToken((a, tk) => a.members(tk)).then(
          (r) => setName(r.items.find((m) => m.id === id)?.display_name ?? ''),
          () => undefined,
        );
      }
      setLoad({ kind: 'ready', view });
      setDraft(draftOf(view.fields));
      setUnnamed(new Set());
      return view;
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 404) {
        setLoad({ kind: 'none' });
        return null;
      }
      const words = loadFailure('emergency-edit', err, t);
      setLoad(words ? { kind: 'failed', words } : { kind: 'offline' });
      return null;
    }
  }, [withToken, id, props.name, t]);

  useEffect(() => {
    // Read on arrival; the form is set once the vault answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void read();
  }, [read]);

  if (load.kind !== 'ready' || !draft) {
    return (
      <View style={[styles.still, { paddingTop: sp(20) + insets.top }]} testID="emergency-edit">
        <Text variant="hero">{t('emergencyEdit.title')}</Text>
        {load.kind === 'loading' ? <Placeholder rows={3} /> : null}
        {load.kind === 'offline' ? (
          <Notice tone="warn" testID="emergency-edit-offline">
            {t('emergency.needsConnection')}
          </Notice>
        ) : null}
        {load.kind === 'none' ? (
          <Text tone="soft" testID="emergency-edit-none">
            {mine ? t('emergency.noneMine') : t('emergency.none', { name: name || t('emergency.thisPerson') })}
          </Text>
        ) : null}
        {load.kind === 'failed' ? <LoadFailed words={load.words} onRetry={() => void read()} /> : null}
        {load.kind !== 'loading' ? (
          <Button kind="quiet" label={t('common.back')} onPress={() => router.back()} testID="emergency-edit-back" />
        ) : null}
      </View>
    );
  }

  const view = load.view;
  // Only the person and the owners write it: anybody else is told so, in the vault's words.
  if (!view.can_edit) {
    return (
      <View style={[styles.still, { paddingTop: sp(20) + insets.top }]} testID="emergency-edit">
        <Text variant="hero">{t('emergencyEdit.title')}</Text>
        <Notice tone="info" testID="emergency-edit-not-yours">
          {EMERGENCY_EDIT_REFUSAL}
        </Notice>
        <Button kind="quiet" label={t('common.back')} onPress={() => router.back()} testID="emergency-edit-back" />
      </View>
    );
  }

  const changed = draftChanged(draft, view.fields);
  const one = (key: ListKey) => t(`emergencyEdit.one_${key}`);
  const partLabel = (key: ListKey, part: string) =>
    t(`emergencyEdit.part_${part}_${key}`, { defaultValue: t(`emergencyEdit.part_${part}`) });
  const sectionLabel = (what: Clearable) => EMERGENCY_FIELD_LABELS[what];

  const save = async (): Promise<(() => void) | null> => {
    if (busy) return null;
    setProblem(null);
    if (!changed) return () => router.back();
    const out = readDraft(draft);
    if (!out.fields) {
      setUnnamed(new Set(out.unnamed.map((u) => u.id)));
      setProblem(t('emergencyEdit.putRight'));
      const first = out.unnamed[0];
      if (first) setGoTo({ id: first.id, at: {} });
      return null;
    }
    setUnnamed(new Set());
    const fields = out.fields;
    setBusy(true);
    try {
      // The vault asks nobody to confirm it's them today; were it to, the step-up asks.
      const saved = await guarded((a, tk) => a.saveEmergency(tk, id, fields, view.version));
      if (saved === null) return null;
      feel('done');
      sayOnEmergencyPage(id, t('emergency.saved'));
      return () => router.back();
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 409) {
        // Somebody changed it meanwhile: what was typed stays, and the page is read again for its
        // version, so Save puts this in place of theirs only when pressed again, knowingly.
        setProblem(await again());
      } else {
        setProblem(wordsFor(err, t));
      }
      return null;
    } finally {
      setBusy(false);
    }
  };

  /** The page read again after a 409, the form kept as typed: what to say. */
  const again = async (): Promise<string> => {
    try {
      const fresh = await withToken((a, tk) => a.emergencyOf(tk, id));
      setLoad({ kind: 'ready', view: fresh });
      return t('emergencyEdit.changed');
    } catch (err) {
      // Not read again: the form stays as typed, and why is said beside it.
      const why =
        err instanceof ApiRequestError
          ? wordsFor(err, t)
          : (loadFailure('emergency-edit', err, t) ?? t('emergency.changeNeedsConnection'));
      return `${t('emergencyEdit.changed')} ${why}`;
    }
  };

  const remove = (key: ListKey, entryId: string) => {
    const e = draft.lists[key].find((x) => x.id === entryId);
    if (!e) return;
    // Nothing typed in it: away at once. Anything typed: asked first.
    if (entryBlank(e)) setDraft(without(draft, key, entryId));
    else setAsking({ kind: 'remove', key, id: entryId, name: e.name.trim() });
  };

  const answer = () => {
    if (!asking) return;
    setDraft((d) => (d ? (asking.kind === 'remove' ? without(d, asking.key, asking.id) : cleared(d, asking.what)) : d));
    setAsking(null);
  };

  const clearButton = (what: Clearable) => (
    <Button
      size="small"
      kind="quiet"
      label={t('emergencyEdit.clear')}
      accessibilityLabel={t('emergencyEdit.clearPart', { part: sectionLabel(what) })}
      disabled={busy}
      onPress={() => setAsking({ kind: 'clear', what })}
      testID={`emergency-edit-clear-${what}`}
    />
  );

  return (
    <EditorFrame
      testID="emergency-edit"
      changed={changed}
      busy={busy}
      save={{ testID: 'emergency-edit-save', label: t('emergencyEdit.save'), disabled: offline, onPress: save }}
      cancelID="emergency-edit-cancel"
    >
      <View>
        <Text variant="hero">{t('emergencyEdit.title')}</Text>
        {name || mine ? (
          <Text variant="secondary" tone="soft">
            {mine ? t('emergencyEdit.yours') : name}
          </Text>
        ) : null}
      </View>
      <Text variant="secondary" tone="soft" testID="emergency-edit-lede">
        {`${mine ? t('emergencyEdit.typeMine') : t('emergencyEdit.typeTheirs', { name })} ${EMERGENCY_NOT_ADVICE}`}
      </Text>
      {offline ? (
        <Notice tone="warn" testID="emergency-edit-needs-connection">
          {t('emergencyEdit.needsConnection')}
        </Notice>
      ) : null}
      {view.date_of_birth ? (
        <Text variant="secondary" tone="soft" testID="emergency-edit-dob">
          {t('emergencyEdit.dateOfBirth', { date: formatDate({ date: view.date_of_birth, precision: 'day' }) })}
        </Text>
      ) : null}

      <View style={styles.section}>
        <Text variant="screen">{EMERGENCY_FIELD_LABELS.blood_type}</Text>
        <ChipRow label={EMERGENCY_FIELD_LABELS.blood_type}>
          <Chip
            label={t('emergencyEdit.bloodUnknown')}
            selected={draft.blood === ''}
            onPress={() => setDraft({ ...draft, blood: '' })}
            testID="emergency-edit-blood-none"
          />
          {BLOOD_TYPES.map((b) => (
            <Chip
              key={b}
              label={b}
              selected={draft.blood === b}
              onPress={() => setDraft({ ...draft, blood: b })}
              testID={`emergency-edit-blood-${b}`}
            />
          ))}
        </ChipRow>
      </View>

      {LIST_KEYS.map((key) => {
        const entries = draft.lists[key];
        return (
          <View key={key} style={styles.section} testID={`emergency-edit-${key}`}>
            <View style={styles.headRow}>
              <Text variant="screen" style={styles.flex}>
                {EMERGENCY_FIELD_LABELS[key]}
              </Text>
              {typedEntries(draft, key).length >= 2 ? clearButton(key) : null}
            </View>
            {entries.map((e, n) => (
              <View key={e.id} style={styles.entry} testID={`emergency-edit-${key}-${n}`}>
                <Field
                  label={`${one(key)} ${n + 1}`}
                  value={e.name}
                  onChangeText={(v) => setDraft(withPart(draft, key, e.id, 'name', v))}
                  maxLength={PART_MAX.name}
                  autoCapitalize="sentences"
                  error={unnamed.has(e.id) && !e.name.trim() ? t('emergencyEdit.nameNeeded') : null}
                  goTo={goTo?.id === e.id ? goTo.at : null}
                  testID={`emergency-edit-${key}-${n}-name`}
                />
                {LIST_PARTS[key].map((part) => (
                  <Field
                    key={part}
                    label={partLabel(key, part)}
                    value={e[part]}
                    onChangeText={(v) => setDraft(withPart(draft, key, e.id, part, v))}
                    maxLength={PART_MAX[part]}
                    autoCapitalize={part === 'phone' ? 'none' : 'sentences'}
                    {...(part === 'phone' ? { keyboardType: 'phone-pad' as const } : {})}
                    testID={`emergency-edit-${key}-${n}-${part}`}
                  />
                ))}
                <View style={styles.entryFoot}>
                  <Button
                    size="small"
                    kind="quiet"
                    label={t('emergencyEdit.remove')}
                    accessibilityLabel={
                      e.name.trim()
                        ? t('emergencyEdit.removeNamed', { name: e.name.trim() })
                        : t('emergencyEdit.removeOne', { one: one(key).toLowerCase(), n: n + 1 })
                    }
                    disabled={busy}
                    onPress={() => remove(key, e.id)}
                    testID={`emergency-edit-${key}-${n}-remove`}
                  />
                </View>
              </View>
            ))}
            {entries.length < LIST_MAX ? (
              <Button
                kind="quiet"
                label={t('emergencyEdit.add', { one: one(key).toLowerCase() })}
                disabled={busy}
                onPress={() => setDraft(withNew(draft, key))}
                testID={`emergency-edit-add-${key}`}
              />
            ) : (
              <Text variant="small" tone="soft" testID={`emergency-edit-full-${key}`}>
                {t('emergencyEdit.listFull', { max: LIST_MAX })}
              </Text>
            )}
          </View>
        );
      })}

      <View style={styles.section} testID="emergency-edit-insurance">
        <View style={styles.headRow}>
          <Text variant="screen" style={styles.flex}>
            {EMERGENCY_FIELD_LABELS.insurance}
          </Text>
          {insuranceTyped(draft) ? clearButton('insurance') : null}
        </View>
        {INSURANCE_PARTS.map((p) => (
          <Field
            key={p}
            label={t(`emergencyEdit.insurance_${p}`)}
            value={draft.insurance[p]}
            onChangeText={(v) => setDraft({ ...draft, insurance: { ...draft.insurance, [p]: v } })}
            maxLength={INSURANCE_MAX[p]}
            autoCapitalize={p === 'insurer' ? 'words' : 'none'}
            {...(p === 'phone' ? { keyboardType: 'phone-pad' as const } : {})}
            testID={`emergency-edit-insurance-${p}`}
          />
        ))}
        <Text variant="small" tone="soft">
          {t('emergencyEdit.insuranceCard')}
        </Text>
      </View>

      <View style={styles.section}>
        <View style={styles.headRow}>
          <Text variant="screen" style={styles.flex}>
            {EMERGENCY_FIELD_LABELS.notes}
          </Text>
          {draft.notes.trim() ? clearButton('notes') : null}
        </View>
        <Field
          label={t('emergencyEdit.notesLabel')}
          value={draft.notes}
          onChangeText={(v) => setDraft({ ...draft, notes: v })}
          maxLength={NOTES_MAX}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
          autoCapitalize="sentences"
          testID="emergency-edit-notes"
        />
        <Text variant="small" tone="soft">
          {t('emergencyEdit.notesHint')}
        </Text>
      </View>

      {problem ? (
        <Notice tone="warn" testID="emergency-edit-problem">
          {problem}
        </Notice>
      ) : null}

      <ConfirmSheet
        visible={asking !== null}
        testID="emergency-edit-ask"
        icon={asking?.kind === 'clear' ? Eraser : Trash2}
        title={
          asking?.kind === 'remove'
            ? asking.name
              ? t('emergencyEdit.removeTitle', { name: asking.name })
              : t('emergencyEdit.removeTitleUnnamed', { one: one(asking.key).toLowerCase() })
            : asking?.kind === 'clear'
              ? t('emergencyEdit.clearTitle', { part: sectionLabel(asking.what) })
              : ''
        }
        words={asking?.kind === 'clear' ? t('emergencyEdit.clearWords') : t('emergencyEdit.removeWords')}
        confirmLabel={asking?.kind === 'clear' ? t('emergencyEdit.clear') : t('emergencyEdit.remove')}
        onConfirm={answer}
        onCancel={() => setAsking(null)}
        confirmID="emergency-edit-ask-yes"
        cancelID="emergency-edit-ask-cancel"
      />
    </EditorFrame>
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    still: { flex: 1, padding: sp(20), gap: sp(16), backgroundColor: colours.bg },
    section: { gap: sp(10) },
    headRow: { flexDirection: 'row', alignItems: 'center', gap: sp(8) },
    flex: { flex: 1 },
    entry: {
      gap: sp(8),
      padding: sp(12),
      borderRadius: radii.m,
      borderWidth: 1,
      borderColor: colours.border,
      backgroundColor: colours.surface,
    },
    entryFoot: { flexDirection: 'row', justifyContent: 'flex-end' },
  });
