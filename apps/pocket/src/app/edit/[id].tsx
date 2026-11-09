import { ApiRequestError } from '@fdv/client';
import { issuedByLabel, shortTypeLabel, type DocumentView } from '@fdv/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { andList, chooseOwner, chooseType, coreAsk, detailError, ownFields, typeOf, type CardCore, type Draft, type FieldErrors, type Household } from '../../capture/draft';
import { matchTypes, rankTypes } from '../../capture/types';
import { Chip, ChipRow, detailInput } from '../../capture/ui';
import { draftOf, editBody } from '../../documents/edit';
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
  const [moreTypes, setMoreTypes] = useState(false);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    if (!who) return;
    try {
      const [d, ty, m] = await withToken((a, tk) =>
        Promise.all([a.document(tk, id), a.documentTypes(tk), a.members(tk)]),
      );
      setDoc(d);
      setDraft(draftOf(d));
      setHousehold({
        types: ty.items,
        members: m.items,
        me: { member_id: who.member_id, role: who.role },
        issuedBy: caps?.features.issued_by === true,
        details: caps?.features.custom_types === true,
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

  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const setDetail = (key: string, v: string | boolean) =>
    setDraft((d) => (d ? { ...d, details: { ...d.details, [key]: v } } : d));
  const type = typeOf(draft, household);
  const ranked = rankTypes(household.types, []);
  const typeChips = type && !ranked.top.some((x) => x.key === type.key) ? [...ranked.top, type] : ranked.top;
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
      contentContainerStyle={[styles.page, { paddingBottom: sp(20) + insets.bottom }]}
      keyboardShouldPersistTaps="handled"
    >
      <Text variant="hero">{t('edit.title')}</Text>

      <View style={styles.section}>
        <Text variant="screen">{t('capture.whatItIs')}</Text>
        <ChipRow label={t('capture.whatItIs')}>
          {typeChips.map((ty) => (
            <Chip
              key={ty.key}
              label={shortTypeLabel(ty)}
              selected={draft.typeKey === ty.key}
              onPress={() => setDraft((d) => (d ? chooseType(d, d.typeKey === ty.key ? null : ty.key) : d))}
              testID={`edit-type-${ty.key}`}
            />
          ))}
        </ChipRow>
        <View style={styles.row}>
          <Chip label={t('capture.more')} expanded={moreTypes} onPress={() => setMoreTypes((m) => !m)} testID="edit-types-more" />
        </View>
        {moreTypes ? (
          <View style={styles.section}>
            <Field label={t('capture.search')} value={query} onChangeText={setQuery} testID="edit-types-search" />
            <ChipRow label={t('capture.search')}>
              {matchTypes(household.types, query).map((ty) => (
                <Chip
                  key={ty.key}
                  label={ty.label}
                  selected={draft.typeKey === ty.key}
                  onPress={() => {
                    setDraft((d) => (d ? chooseType(d, ty.key) : d));
                    setMoreTypes(false);
                    setQuery('');
                  }}
                />
              ))}
            </ChipRow>
          </View>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text variant="screen">{t('capture.whoseItIs')}</Text>
        <ChipRow label={t('capture.whoseItIs')}>
          {household.members
            .filter((m) => !teen || m.id === who?.member_id)
            .map((m) => (
              <Chip
                key={m.id}
                label={m.id === who?.member_id ? `${m.display_name} (${t('capture.yours')})` : m.display_name}
                selected={draft.ownerId === m.id}
                disabled={teen}
                onPress={() =>
                  setDraft((d) => (d ? chooseOwner(d, d.ownerId === m.id ? null : m.id, household) : d))
                }
                testID={`edit-owner-${m.id}`}
              />
            ))}
          {teen ? null : (
            <Chip
              label={t('capture.nobody')}
              selected={draft.ownerId === null}
              onPress={() => setDraft((d) => (d ? chooseOwner(d, null, household) : d))}
            />
          )}
        </ChipRow>
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
