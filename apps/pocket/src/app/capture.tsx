import {
  colours,
  issuedByLabel,
  issuerFromFilename,
  rankKnownIssuers,
  reminderSentence,
  shortTypeLabel,
} from '@fdv/shared';
import { useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  addPages,
  andList,
  chooseOwner,
  chooseType,
  coreAsk,
  detailError,
  essentialOf,
  isCardCore,
  moveEarlier,
  moveLater,
  newDraft,
  ownFields,
  pagesLeft,
  removePage,
  replacePage,
  suggestedTitle,
  toMetadata,
  typeOf,
  visibilityChoices,
  visibilityOf,
  type CardCore,
  type Draft,
  type FieldErrors,
  type Household,
} from '../capture/draft';
import { matchTypes, rankTypes } from '../capture/types';
import { Chip, ChipRow, detailInput, FileRow, LeaveQuestion, PageStrip } from '../capture/ui';
import type { CaptureSource } from '../queue/commit';
import { useCapture, type CardData, type SaveProblem } from '../state/capture';
import { useScreenGuard } from '../state/lock';
import { useVault } from '../state/vault';
import { Button, Field, Notice, requiredLabel, Text } from '../ui';

type Loaded = CardData;

/**
 * The confirm card: straight after the scanner's Done, no second review.
 * Two taps — what it is, whose it is — then Save; everything else has a
 * sensible default or waits under More details. Nothing is sent to the
 * vault until Save or Skip.
 */
export default function CaptureScreen() {
  // The card shows the pages: never captured, whatever Settings allows.
  useScreenGuard('card');
  const { pending } = useCapture();
  const router = useRouter();
  // Opened with nothing to show (a reload on the web, an old link): Home.
  // Once a capture is saved or thrown away the card leaves by itself.
  const [empty] = useState(() => pending === null);
  useEffect(() => {
    if (empty) router.replace('/');
  }, [empty, router]);
  return pending ? <Card initial={pending} /> : null;
}

function initial(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase();
}

function Card(props: { initial: CaptureSource }) {
  const { t } = useTranslation();
  const { withToken, caps, who } = useVault();
  const capture = useCapture();
  const router = useRouter();
  const navigation = useNavigation();
  const signedInAs = useMemo(() => (who ? { member_id: who.member_id, role: who.role } : null), [who]);
  const [data, setData] = useState<Loaded | null>(null);
  const [offline, setOffline] = useState(false);
  const [draft, setDraft] = useState<Draft>(() =>
    newDraft(props.initial, signedInAs ?? { member_id: '', role: 'viewer' }),
  );
  // Whoever the vault says you are now: a role changed since sign-in counts.
  const live = data?.members.find((m) => m.is_me);
  const liveId = live?.id;
  const liveRole = live?.role;
  const me = useMemo(
    () =>
      signedInAs
        ? {
            member_id: liveId ?? signedInAs.member_id,
            role: liveRole ?? signedInAs.role,
          }
        : null,
    [signedInAs, liveId, liveRole],
  );
  // The latest draft, for work that finishes after an await (the scanner).
  const latest = useRef(draft);
  useEffect(() => {
    latest.current = draft;
  }, [draft]);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const [moreTypes, setMoreTypes] = useState(false);
  const [query, setQuery] = useState('');
  const [details, setDetails] = useState(false);
  const [known, setKnown] = useState<{ value: string; count: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [asking, setAsking] = useState(false);
  const scroll = useRef<ScrollView>(null);
  // Save waited: the first field it waits for is brought into view and
  // typed in, as on the web (each input moves to itself: Field's goTo).
  // One with no box to type in (a choice): the notice under the details,
  // which says what is needed, is brought into view instead.
  const [goTo, setGoTo] = useState<{ key: string; box: boolean } | null>(null);
  useEffect(() => {
    if (goTo && !goTo.box) scroll.current?.scrollToEnd();
  }, [goTo]);
  /** Given to the input for `key`: it moves to itself when Save waits for it first. */
  const goToFor = (key: string) => (goTo?.key === key ? goTo : null);
  const leaving = useRef(false);
  const saving = useRef(false);
  const blocked = useRef<unknown>(null);
  const issuedByOn = caps?.features.issued_by === true;
  // A type's own details, and what it requires (0.5.11): as the vault says
  // now, or — with no connection — as it said when the card's choices were kept.
  const detailsOn = caps ? caps.features.custom_types === true : data?.customTypes === true;

  // The vault's choices — or, with no connection, the ones this phone last saw.
  useEffect(() => {
    let cancelled = false;
    void capture.cardData().then((d) => {
      if (cancelled) return;
      if (d) setData(d);
      else setOffline(true);
    });
    return () => {
      cancelled = true;
    };
    // Once, when the card opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The household's issuers, those used for this kind of document first.
  useEffect(() => {
    if (!issuedByOn || !data) return;
    let cancelled = false;
    withToken((a, token) => a.issuers(token, draft.typeKey ? { type_key: draft.typeKey } : {}))
      .then((r) => {
        if (!cancelled) setKnown(r.items.map((i) => ({ value: i.issued_by, count: i.count })));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [issuedByOn, data, draft.typeKey, withToken]);

  const household = useMemo<Household | null>(
    () =>
      data && me
        ? { types: data.types, members: data.members, me, issuedBy: issuedByOn, details: detailsOn }
        : null,
    [data, me, issuedByOn, detailsOn],
  );

  // The card can be used once its choices are in: that is when it counts as shown.
  const shown = useRef(false);
  useEffect(() => {
    if (!household || shown.current) return;
    shown.current = true;
    capture.cardShown();
  }, [household, capture]);

  // A teen's scans are their own, even if the vault only now says they are a teen.
  useEffect(() => {
    if (me?.role === 'teen' && draft.ownerId !== me.member_id) {
      // Following what the vault said, once it said it.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraft((d) => ({ ...d, ownerId: me.member_id }));
    }
  }, [me, draft.ownerId]);

  /** Leaves the card, once: after a Save, a Throw away, or the Back it held. */
  const leave = useCallback(() => {
    if (leaving.current) return;
    leaving.current = true;
    if (blocked.current) navigation.dispatch(blocked.current as never);
    else router.back();
  }, [navigation, router]);

  // Back, with a scan on the card: ask. While a Save is under way, Back
  // waits for it: the card leaves by itself when it is done.
  useEffect(
    () =>
      navigation.addListener('beforeRemove', (e: { preventDefault: () => void; data: { action: unknown } }) => {
        if (leaving.current) return;
        e.preventDefault();
        if (saving.current) return;
        blocked.current = e.data.action;
        setAsking(true);
      }),
    [navigation],
  );

  const problemWords = (p: SaveProblem) =>
    p === 'too_big'
      ? t('capture.tooBig')
      : p === 'no_space'
        ? t('capture.noSpace')
        : p === 'queue_unavailable'
          ? t('capture.queueUnavailable')
          : p === 'not_allowed'
            ? t('capture.notAllowed')
            : t('capture.unreadable');

  /** Said on the card, and said aloud: a refusal nobody hears is no answer. */
  const fail = (message: string) => {
    setError(message);
    AccessibilityInfo.announceForAccessibility(message);
  };

  const save = async (skip: boolean) => {
    if (saving.current || leaving.current) return;
    setError(null);
    setFieldErrors({});
    let metadata = null;
    let note: { reminder: string | null; noExpiry: boolean } = {
      reminder: null,
      noExpiry: false,
    };
    let labels: Record<string, string> = {};
    if (!skip) {
      if (!household) return;
      const out = toMetadata(draft, household);
      if (Object.keys(out.fields).length > 0) {
        setFieldErrors(out.fields);
        setDetails(true);
        AccessibilityInfo.announceForAccessibility(Object.values(out.fields).join(' '));
        return;
      }
      if (out.problem) {
        fail(out.problem.message);
        return;
      }
      // Save waits for what the type requires, and says what; Skip never waits.
      if (out.missing.length > 0) {
        setDetails(true);
        fail(t('capture.stillNeeded', { fields: andList(out.missing.map(labelOf)), count: out.missing.length }));
        const first = out.missing[0] as string;
        const kind = own.find((f) => f.key === first)?.kind;
        setGoTo({ key: first, box: kind !== 'choice' && kind !== 'yes_no' });
        return;
      }
      metadata = out.metadata;
      // The names of the details sent, kept with the scan: what becomes of one is said by its name.
      const sent = Object.keys(out.metadata.extra ?? {});
      labels = Object.fromEntries(own.filter((f) => sent.includes(f.key)).map((f) => [f.key, f.label]));
      // Reminders only for what has the date they come from.
      const ty = typeOf(draft, household);
      note = {
        reminder: out.metadata.expires ? reminderSentence(ty) : null,
        noExpiry: Boolean(ty?.expiry_driver) && !out.metadata.expires,
      };
    }
    saving.current = true;
    setBusy(true);
    let done = false;
    try {
      const r = await capture.save(latest.current.source, metadata, note, labels);
      done = r.kind === 'saved';
      if (done) leave();
      else if (r.kind === 'refused') fail(problemWords(r.problem));
    } finally {
      if (!done) {
        saving.current = false;
        if (mounted.current) setBusy(false);
      }
    }
  };

  const throwAway = async () => {
    setAsking(false);
    if (saving.current) return;
    await capture.throwAway(latest.current.source);
    leave();
  };

  // The scanner takes a moment to open, and the card is still there under
  // it: whatever happens meanwhile is kept, and pages are found again by
  // their file, not their place.
  const retake = async (i: number) => {
    const target = pagesShown[i]?.uri;
    const pages = await capture.morePages(1);
    const page = pages?.[0];
    if (!page) return;
    const d = latest.current;
    const at = d.source.kind === 'pages' ? d.source.pages.findIndex((p) => p.uri === target) : -1;
    if (!mounted.current || saving.current || at < 0) {
      void capture.discard(page.uri);
      return;
    }
    const { draft: next, removed } = replacePage(d, at, page);
    latest.current = next;
    setDraft(next);
    if (removed) void capture.discard(removed.uri);
  };

  const addPage = async () => {
    const pages = await capture.morePages(pagesLeft(latest.current));
    if (!pages) return;
    if (!mounted.current || saving.current) {
      for (const p of pages) void capture.discard(p.uri);
      return;
    }
    const { draft: next, dropped } = addPages(latest.current, pages);
    latest.current = next;
    setDraft(next);
    for (const p of dropped) void capture.discard(p.uri);
  };

  const remove = (i: number) => {
    const { draft: next, removed } = removePage(draft, i);
    setDraft(next);
    if (removed) void capture.discard(removed.uri);
  };

  const type = household ? typeOf(draft, household) : undefined;
  const ranked = data ? rankTypes(data.types, data.filed) : { top: [], rest: [] };
  const typeChips = type && !ranked.top.some((x) => x.key === type.key) ? [...ranked.top, type] : ranked.top;
  const visibility = household ? visibilityOf(draft, household) : 'household';
  const choices = household ? visibilityChoices(draft, household) : { household: true, adults: false, private: false };
  const people = data?.members ?? [];
  const teen = me?.role === 'teen';
  const reminder = reminderSentence(type);
  const titleHint = household ? suggestedTitle(draft, household) : null;
  const pagesShown = draft.source.kind === 'pages' ? draft.source.pages : [];
  const issuerOffers = useMemo(() => {
    if (!issuedByOn || draft.issuedBy.trim() !== '') return [];
    const fromFile =
      draft.source.kind === 'file' ? issuerFromFilename(draft.source.file.name, known).map((c) => c.value) : [];
    const ranked = rankKnownIssuers(known, draft.typeKey).map((k) => k.value);
    return [...new Set([...fromFile, ...ranked])].slice(0, 4);
  }, [issuedByOn, draft.issuedBy, draft.source, draft.typeKey, known]);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const setDetail = (key: string, value: string | boolean) =>
    setDraft((d) => ({ ...d, details: { ...d.details, [key]: value } }));

  // How the card asks for each fixed field (custom_types: the type's own
  // name for it, and whether Save waits for it; otherwise as in 0.2.0).
  const rules = household ?? { details: false, issuedBy: issuedByOn };
  const ask = (key: CardCore) => coreAsk(type, key, rules);
  const cardWord: Record<CardCore, string> = {
    issued_by: issuedByLabel(type),
    identifier: t('capture.number'),
    issued: t('capture.issued'),
    expires: t('capture.expires'),
    physical_location: t('capture.location'),
  };
  const coreLabel = (key: CardCore) => ask(key).label ?? cardWord[key];
  const requiredWord = (required: boolean | undefined) => (required ? t('capture.required') : null);
  const own = ownFields(type, rules);
  /** A field's name, as the card shows it. */
  function labelOf(key: string): string {
    return isCardCore(key) ? coreLabel(key) : (own.find((f) => f.key === key)?.label ?? key);
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView
        ref={scroll}
        contentContainerStyle={styles.page}
        keyboardShouldPersistTaps="handled"
        testID="capture-card"
      >
        <Text variant="title">{t('capture.title')}</Text>

        {draft.source.kind === 'pages' ? (
          <View style={styles.section}>
            <Text variant="secondary" tone="soft" weight="600">
              {t('capture.pages', { count: pagesShown.length })}
            </Text>
            <PageStrip
              pages={pagesShown}
              disabled={busy}
              canScan={capture.scanner.scans}
              canAdd={pagesLeft(draft) > 0}
              onMoveEarlier={(i) => setDraft((d) => moveEarlier(d, i))}
              onMoveLater={(i) => setDraft((d) => moveLater(d, i))}
              onRemove={remove}
              onRetake={(i) => void retake(i)}
              onAdd={() => void addPage()}
            />
          </View>
        ) : (
          <FileRow file={draft.source.file} />
        )}

        {offline ? (
          <Notice tone="warn" testID="capture-offline">
            {t('capture.offlineSkip')}
          </Notice>
        ) : null}

        {household ? (
          <>
            <View style={styles.section}>
              <Text variant="screen">{t('capture.whatItIs')}</Text>
              <ChipRow label={t('capture.whatItIs')}>
                {typeChips.map((ty) => (
                  <Chip
                    key={ty.key}
                    label={shortTypeLabel(ty)}
                    selected={draft.typeKey === ty.key}
                    onPress={() => setDraft((d) => chooseType(d, d.typeKey === ty.key ? null : ty.key))}
                  />
                ))}
              </ChipRow>
              <View style={styles.row}>
                <Chip
                  label={t('capture.more')}
                  expanded={moreTypes}
                  onPress={() => setMoreTypes((m) => !m)}
                  testID="types-more"
                />
              </View>
              {moreTypes ? (
                <View style={styles.section}>
                  <Field label={t('capture.search')} value={query} onChangeText={setQuery} testID="types-search" />
                  <ChipRow label={t('capture.search')}>
                    {matchTypes(data?.types ?? [], query).map((ty) => (
                      <Chip
                        key={ty.key}
                        label={ty.label}
                        selected={draft.typeKey === ty.key}
                        onPress={() => {
                          setDraft((d) => chooseType(d, ty.key));
                          setMoreTypes(false);
                          setQuery('');
                        }}
                      />
                    ))}
                  </ChipRow>
                  {matchTypes(data?.types ?? [], query).length === 0 ? (
                    <Text tone="soft">{t('capture.noMatch')}</Text>
                  ) : null}
                </View>
              ) : null}
            </View>

            <View style={styles.section}>
              <Text variant="screen">{t('capture.whoseItIs')}</Text>
              <ChipRow label={t('capture.whoseItIs')}>
                {people
                  .filter((m) => !teen || m.id === me?.member_id)
                  .map((m) => (
                    <Chip
                      key={m.id}
                      label={m.id === me?.member_id ? `${m.display_name} (${t('capture.yours')})` : m.display_name}
                      leading={initial(m.display_name)}
                      selected={draft.ownerId === m.id}
                      disabled={teen}
                      onPress={() =>
                        household && setDraft((d) => chooseOwner(d, d.ownerId === m.id ? null : m.id, household))
                      }
                    />
                  ))}
                {teen ? null : (
                  <Chip
                    label={t('capture.nobody')}
                    selected={draft.ownerId === null}
                    onPress={() => household && setDraft((d) => chooseOwner(d, null, household))}
                  />
                )}
              </ChipRow>
            </View>

            <View style={styles.section}>
              <Text variant="screen">{t('capture.whoCanSee')}</Text>
              <ChipRow label={t('capture.whoCanSee')}>
                {(
                  [
                    ['household', t('capture.everyone')],
                    ['adults', t('capture.adults')],
                    ['private', t('capture.onlyMe')],
                  ] as const
                ).map(([v, label]) =>
                  v === 'adults' && !choices.adults ? null : (
                    <Chip
                      key={v}
                      label={label}
                      selected={visibility === v}
                      disabled={!choices[v]}
                      onPress={() => set({ visibility: v })}
                      testID={`visibility-${v}`}
                    />
                  ),
                )}
              </ChipRow>
              {visibility === 'private' ? (
                <Text tone="soft">{t('capture.onlyMeSentence')}</Text>
              ) : !choices.private ? (
                <Text variant="secondary" tone="muted">
                  {t('capture.onlyMeYours')}
                </Text>
              ) : null}
            </View>

            <View style={styles.switchRow}>
              <View style={styles.flex}>
                <Text weight="600">{t('capture.essential')}</Text>
                <Text variant="secondary" tone="muted">
                  {t('capture.essentialHint')}
                </Text>
              </View>
              <Switch
                accessibilityLabel={t('capture.essential')}
                value={essentialOf(draft, household)}
                onValueChange={(v) => set({ essential: v })}
                trackColor={{
                  true: colours.accent,
                  false: colours.borderInput,
                }}
                testID="essential"
              />
            </View>

            <Button
              label={t('capture.moreDetails')}
              kind="quiet"
              onPress={() => {
                setDetails((d) => !d);
                // Opened again later, the card does not move by itself.
                setGoTo(null);
              }}
              testID="more-details"
            />
            {details ? (
              <View style={styles.section}>
                <Field
                  label={t('capture.name')}
                  value={draft.title}
                  onChangeText={(v) => set({ title: v })}
                  placeholder={titleHint ?? ''}
                  autoCapitalize="sentences"
                  testID="field-name"
                />
                {ask('issued_by').shown ? (
                  <>
                    <Field
                      label={coreLabel('issued_by')}
                      required={requiredWord(ask('issued_by').required)}
                      value={draft.issuedBy}
                      onChangeText={(v) => set({ issuedBy: v })}
                      autoCapitalize="words"
                      goTo={goToFor('issued_by')}
                      testID="field-issued-by"
                    />
                    {issuerOffers.length > 0 ? (
                      <ChipRow label={coreLabel('issued_by')} role="none">
                        {issuerOffers.map((name) => (
                          <Chip
                            key={name}
                            label={t('capture.fromIssuer', { name })}
                            onPress={() => set({ issuedBy: name })}
                          />
                        ))}
                      </ChipRow>
                    ) : null}
                  </>
                ) : null}
                {ask('identifier').shown ? (
                  <Field
                    label={coreLabel('identifier')}
                    required={requiredWord(ask('identifier').required)}
                    value={draft.identifier}
                    onChangeText={(v) => set({ identifier: v })}
                    goTo={goToFor('identifier')}
                    testID="field-number"
                  />
                ) : null}
                {ask('issued').shown ? (
                  <Field
                    label={coreLabel('issued')}
                    required={requiredWord(ask('issued').required)}
                    value={draft.issued}
                    onChangeText={(v) => set({ issued: v })}
                    placeholder="14 Mar 2021"
                    error={fieldErrors.issued ?? null}
                    goTo={goToFor('issued')}
                    testID="field-issued"
                  />
                ) : null}
                {ask('expires').shown ? (
                  <Field
                    label={coreLabel('expires')}
                    required={requiredWord(ask('expires').required)}
                    value={draft.expires}
                    onChangeText={(v) => set({ expires: v })}
                    placeholder="14 Mar 2031"
                    error={fieldErrors.expires ?? null}
                    goTo={goToFor('expires')}
                    testID="field-expires"
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
                    goTo={goToFor('physical_location')}
                    testID="field-location"
                  />
                ) : null}
                {/* The type's own details (custom_types), each with the input its kind asks for. */}
                {own.map((f) => {
                  const value = draft.details[f.key];
                  const error = fieldErrors[detailError(f.key)] ?? null;
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
                          testID={`field-detail-${f.key}`}
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
                            <Chip
                              key={c}
                              label={c}
                              selected={value === c}
                              onPress={() => setDetail(f.key, value === c ? '' : c)}
                            />
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
                      goTo={goToFor(f.key)}
                      testID={`field-detail-${f.key}`}
                      {...detailInput(f.kind)}
                    />
                  );
                })}
              </View>
            ) : null}

            {reminder ? (
              <Text tone="soft" testID="capture-reminder">
                {reminder}
              </Text>
            ) : null}
          </>
        ) : null}

        {error ? (
          <Notice tone="danger" testID="capture-error">
            {error}
          </Notice>
        ) : null}

        {household ? (
          <Button label={t('capture.save')} onPress={() => void save(false)} busy={busy} testID="capture-save" />
        ) : null}
        <Button
          label={t('capture.skip')}
          kind="quiet"
          hint={t('capture.skipHint')}
          onPress={() => void save(true)}
          disabled={busy}
          testID="capture-skip"
        />
      </ScrollView>
      <LeaveQuestion
        visible={asking}
        onSaveWithout={() => {
          setAsking(false);
          void save(true);
        }}
        disabled={busy}
        onThrowAway={() => void throwAway()}
        onKeepEditing={() => {
          blocked.current = null;
          setAsking(false);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colours.bg },
  page: { padding: 20, gap: 16 },
  section: { gap: 10 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 44,
  },
  row: { flexDirection: 'row' },
  flex: { flex: 1 },
});
