import {
  documentActivityEmptyWords,
  documentActivityWords,
  formatDate,
  radii,
  type ActivityLine,
  type Member,
} from '@fdv/shared';
import { useRouter } from 'expo-router';
import { Check, Printer, SlidersHorizontal, X } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { wordsFor } from '../errors/words';
import { activityHtml, wantsOlder } from '../print/activity-print';
import { usePrint } from '../print/print';
import { IconButton } from '../ui/icon-button';
import { exactWords, useFamilyZone } from '../state/family-time';
import { useVault } from '../state/vault';
import { Button, Field, Notice, Text } from '../ui';
import { Chip } from '../ui/chip';
import { SideSheet } from '../ui/side-sheet';
import { sp } from '../ui/space';
import { LoadFailed, loadFailure, Placeholder } from '../ui/states';
import { useColours, useStyles, type Palette } from '../ui/theme';
import {
  ELSE,
  emptyKey,
  filtersOn,
  KINDS,
  matches,
  NO_ACTIVITY_FILTERS,
  typedDay,
  type ActivityFilters,
} from './filters';

/** A page of the log, and which document it is about ('' the whole log). */
interface Page {
  about: string;
  items: ActivityLine[];
  next: number | null;
}

const dayShown = (day: string) => (day ? formatDate({ date: day, precision: 'day' }) : '');

/**
 * Activity (app 0.17.0; the vault's activity log, SHR-07, and one document's
 * activity, 0.9.0-dev.54, DA): who did what in the vault, and exactly when,
 * newest first — "Sarah downloaded ‘Home insurance policy’" — as the web's
 * Activity page says it. Read only. A line about a document opens it.
 *
 * `document`: that document's lines alone (where the vault has
 * `features.document_activity`), from its page's Activity: its own links
 * and collections' links that gave it, opened, emailed or taken back, too.
 * A chip says which document ("About ‘Richa’s visa’", or "About a sensitive
 * document"), and its × shows the whole log. An older vault shows the whole
 * log, as the web does.
 *
 * Filters slide out from the side, as Documents' do: who, what sort of
 * thing, and from and to which day on the household's calendar. They only
 * leave out some of the lines loaded: which lines anybody is given is the
 * vault's to say. Show older loads more.
 */
export function ActivityScreen(props: { document?: string }) {
  const styles = useStyles(makeStyles);
  const colours = useColours();
  const { t } = useTranslation();
  const router = useRouter();
  const zone = useFamilyZone();
  const { withToken, offline, caps } = useVault();
  // The chip's × shows the whole log: this screen's own choice from then on.
  const [asked, setAsked] = useState(props.document ?? '');
  const about = caps?.features.document_activity === true ? asked : '';
  const [page, setPage] = useState<Page | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [family, setFamily] = useState<Member[]>([]);
  const [chip, setChip] = useState<{ about: string; words: string } | null>(null);
  const [filters, setFilters] = useState<ActivityFilters>(NO_ACTIVITY_FILTERS);
  const [panel, setPanel] = useState(false);
  const [fromText, setFromText] = useState('');
  const [toText, setToText] = useState('');
  // Print (0.21.0): the lines the filters keep; older ones down to a From day loaded first.
  const { print, foot } = usePrint();
  const [printing, setPrinting] = useState(false);

  // Each first page asked for is counted: a reply to an earlier ask (another document, the whole log,
  // a refresh since) is dropped, so a late one never overwrites the page or leaves the placeholder up.
  const asking = useRef(0);
  const load = useCallback(async () => {
    const of = about;
    const n = ++asking.current;
    try {
      const r = await withToken((a, tk) => (of ? a.documentActivity(tk, of) : a.activity(tk)));
      if (n !== asking.current) return;
      setPage({ about: of, items: r.items, next: r.next });
      setFailed(null);
    } catch (err) {
      if (n !== asking.current) return;
      setFailed(loadFailure('activity', err, t));
    }
  }, [about, withToken, t]);

  const loadFamily = useCallback(async () => {
    try {
      const r = await withToken((a, tk) => a.members(tk));
      setFamily(r.items);
    } catch {
      // Who filter offers Everybody and Anybody else, then.
    }
  }, [withToken]);

  const loadChip = useCallback(async () => {
    if (!about) return;
    const doc = await withToken((a, tk) => a.document(tk, about)).catch(() => null);
    setChip({
      about,
      words: documentActivityWords(doc ? { title: doc.title, sensitive: doc.sensitive_effective === true } : null),
    });
  }, [about, withToken]);

  useEffect(() => {
    // Loaded on arrival, when the connection returns and when the chip is taken off; set once the vault answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    void loadFamily();
    void loadChip();
  }, [load, loadFamily, loadChip, offline]);

  // Only this list's own page: one loaded for another document, or for the whole log, is never shown as this one's.
  const mine = page?.about === about ? page : null;
  const lines = mine?.items ?? [];
  const next = mine?.next ?? null;
  const shown = lines.filter((l) => matches(l, filters, family, zone));
  const on = filtersOn(filters);
  const chipWords = chip?.about === about ? chip.words : '';

  const more = async () => {
    if (!mine || next === null || busy) return;
    // The page it carries on from: a refresh or another document meanwhile makes its reply nobody's.
    const from = mine;
    const n = asking.current;
    setBusy(true);
    setProblem(null);
    try {
      const r = await withToken((a, tk) =>
        from.about ? a.documentActivity(tk, from.about, next) : a.activity(tk, next),
      );
      if (n !== asking.current) return;
      setPage((p) => (p === from ? { about: from.about, items: [...p.items, ...r.items], next: r.next } : p));
    } catch (err) {
      if (n === asking.current) setProblem(wordsFor(err, t));
    } finally {
      setBusy(false);
    }
  };

  const printLog = async () => {
    if (!mine || busy || printing) return;
    const from = mine;
    const n = asking.current;
    setPrinting(true);
    setBusy(true);
    setProblem(null);
    try {
      let items = from.items;
      let older = from.next;
      // Down to the From day, a page at a time, as Show older loads them (at most 50 pages).
      for (let pages = 0; pages < 50 && wantsOlder(items, filters.from, older, zone); pages += 1) {
        const at = older ?? undefined;
        const r = await withToken((a, tk) =>
          from.about ? a.documentActivity(tk, from.about, at) : a.activity(tk, at),
        );
        if (n !== asking.current) return;
        const had = new Set(items.map((l) => l.id));
        items = [...items, ...r.items.filter((l) => !had.has(l.id))];
        older = r.next;
      }
      const loaded = { about: from.about, items, next: older };
      setPage((p) => (p === from ? loaded : p));
      const outcome = await print(
        activityHtml({
          shown: items.filter((l) => matches(l, filters, family, zone)),
          loaded: items,
          filters,
          whoWords: filters.who ? whoName(filters.who) : null,
          kindWords: filters.kind ? kindLabel(filters.kind) : null,
          about: about ? chipWords || t('activity.aDocument') : null,
          older: older !== null,
          zone,
          t,
          foot: foot(),
        }),
      );
      if (outcome === 'failed') setProblem(t('print.failed'));
    } catch (err) {
      if (n === asking.current) setProblem(wordsFor(err, t));
    } finally {
      setPrinting(false);
      setBusy(false);
    }
  };

  const set = (patch: Partial<ActivityFilters>) => setFilters((f) => ({ ...f, ...patch }));
  // Each day on its own: one typed well is used whatever the other says; one not a date (yet) is no filter,
  // so no chip goes on saying a day that is no longer typed.
  const typed = (from: string, to: string) => {
    const f = typedDay(from, false);
    const e = typedDay(to, true);
    set({ from: f === 'bad' ? '' : (f ?? ''), to: e === 'bad' ? '' : (e ?? '') });
  };
  const clear = () => {
    setFilters(NO_ACTIVITY_FILTERS);
    setFromText('');
    setToText('');
  };

  const whoName = (id: string) =>
    id === ELSE ? t('activity.anybodyElse') : (family.find((m) => m.id === id)?.display_name ?? t('activity.someone'));
  const kindLabel = (k: string) => KINDS.find((x) => x.value === k)?.label ?? k;
  // Each filter that is on, as a chip whose tap takes it off.
  const chips: { id: string; label: string; off: () => void }[] = [
    ...(filters.who ? [{ id: 'who', label: whoName(filters.who), off: () => set({ who: '' }) }] : []),
    ...(filters.kind ? [{ id: 'kind', label: kindLabel(filters.kind), off: () => set({ kind: '' }) }] : []),
    ...(filters.from
      ? [
          {
            id: 'from',
            label: t('activity.fromChip', { day: dayShown(filters.from) }),
            off: () => {
              set({ from: '' });
              setFromText('');
            },
          },
        ]
      : []),
    ...(filters.to
      ? [
          {
            id: 'to',
            label: t('activity.toChip', { day: dayShown(filters.to) }),
            off: () => {
              set({ to: '' });
              setToText('');
            },
          },
        ]
      : []),
  ];

  const empty = emptyKey(on > 0, next !== null, about !== '');
  const emptyWords = empty ? t(empty) : documentActivityEmptyWords(next !== null);
  const badFrom = typedDay(fromText, false) === 'bad';
  const badTo = typedDay(toText, true) === 'bad';

  return (
    <>
      <ScrollView
        testID="activity"
        style={styles.screen}
        contentContainerStyle={styles.page}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            enabled={!busy}
            onRefresh={() => {
              setRefreshing(true);
              void load().finally(() => setRefreshing(false));
            }}
          />
        }
      >
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <Text variant="secondary" tone="soft" style={styles.flex}>
              {t('activity.words')}
            </Text>
            <Pressable
              testID="activity-filters"
              accessibilityRole="button"
              accessibilityLabel={on > 0 ? t('filters.buttonOn', { count: on }) : t('filters.button')}
              accessibilityState={{ expanded: panel }}
              onPress={() => setPanel(true)}
              style={({ pressed }) => [styles.filterButton, on > 0 ? styles.filterOn : null, pressed ? styles.pressed : null]}
            >
              <SlidersHorizontal
                color={on > 0 ? colours.onAccent : colours.ink}
                size={20}
                accessibilityElementsHidden
                importantForAccessibility="no"
              />
              {on > 0 ? (
                <View style={styles.badge} accessibilityElementsHidden importantForAccessibility="no">
                  <Text variant="small" weight="700" tone="onAccent">
                    {String(on)}
                  </Text>
                </View>
              ) : null}
            </Pressable>
            {mine && !offline ? (
              <IconButton
                testID="activity-print"
                label={printing ? t('print.activityPreparing') : t('print.menu')}
                icon={Printer}
                onPress={() => void printLog()}
              />
            ) : null}
          </View>
          {about || chips.length > 0 ? (
            <View style={styles.chips}>
              {/* One document's lines (DA): said, and taken off by its ×. */}
              {about ? (
                <Pressable
                  testID="activity-document-chip"
                  accessibilityRole="button"
                  accessibilityLabel={t('activity.documentChipOff', { what: chipWords || t('activity.aDocument') })}
                  hitSlop={6}
                  onPress={() => {
                    setAsked('');
                    setPage(null);
                    setFailed(null);
                  }}
                  style={({ pressed }) => [styles.chip, pressed ? styles.pressed : null]}
                >
                  <Text variant="secondary" weight="600" tone="accent">
                    {chipWords || t('activity.aDocument')}
                  </Text>
                  <X color={colours.accent} size={14} accessibilityElementsHidden importantForAccessibility="no" />
                </Pressable>
              ) : null}
              {chips.map((c) => (
                <Pressable
                  key={c.id}
                  testID={`activity-chip-${c.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={t('filters.chipOff', { what: c.label })}
                  hitSlop={6}
                  onPress={c.off}
                  style={({ pressed }) => [styles.chip, pressed ? styles.pressed : null]}
                >
                  <Text variant="secondary" weight="600" tone="accent">
                    {c.label}
                  </Text>
                  <X color={colours.accent} size={14} accessibilityElementsHidden importantForAccessibility="no" />
                </Pressable>
              ))}
            </View>
          ) : null}
          {offline ? (
            <Notice tone="warn" testID="activity-offline">
              {t('activity.needsConnection')}
            </Notice>
          ) : null}
          {failed ? <LoadFailed words={failed} onRetry={() => void load()} /> : null}
          {!mine && !failed && !offline ? <Placeholder rows={4} /> : null}
          {mine ? (
            <Text variant="small" tone="soft" testID="activity-count">
              {on > 0
                ? t('activity.match', { shown: shown.length, count: lines.length })
                : t('activity.loaded', { count: lines.length })}
            </Text>
          ) : null}
        </View>

        {mine ? (
          <View style={styles.list} testID="activity-lines">
            {shown.map((l) => (
              <Line key={l.id} line={l} zone={zone} opens={!!l.document_id && l.document_id !== about} onOpen={(id) => router.push({ pathname: '/document/[id]', params: { id } })} />
            ))}
            {shown.length === 0 ? (
              <Text tone="soft" testID="activity-empty">
                {emptyWords}
              </Text>
            ) : null}
          </View>
        ) : null}
        {problem ? (
          <Notice tone="warn" testID="activity-problem">
            {problem}
          </Notice>
        ) : null}
        {mine && next !== null ? (
          <Button
            kind="quiet"
            label={busy ? t('activity.loadingOlder') : t('activity.older')}
            busy={busy}
            disabled={offline}
            onPress={() => void more()}
            testID="activity-older"
          />
        ) : null}
      </ScrollView>

      <SideSheet visible={panel} onClose={() => setPanel(false)} testID="activity-filter-panel">
        <View style={styles.panelHead}>
          <Text variant="title" style={styles.flex} role="header">
            {t('filters.title')}
          </Text>
          <Pressable
            testID="activity-filters-clear"
            accessibilityRole="button"
            accessibilityLabel={t('filters.clearAll')}
            hitSlop={8}
            onPress={clear}
            style={styles.textButton}
          >
            <Text variant="secondary" weight="700" tone="accent">
              {t('filters.clearAll')}
            </Text>
          </Pressable>
          <Pressable
            testID="activity-filters-close"
            accessibilityRole="button"
            accessibilityLabel={t('filters.close')}
            hitSlop={4}
            onPress={() => setPanel(false)}
            style={styles.close}
          >
            <X color={colours.ink} size={20} accessibilityElementsHidden importantForAccessibility="no" />
          </Pressable>
        </View>
        <ScrollView style={styles.flex} contentContainerStyle={styles.panelBody} keyboardShouldPersistTaps="handled">
          <View style={styles.section} accessibilityRole="radiogroup" accessibilityLabel={t('activity.who')}>
            <Text variant="small" weight="700" tone="soft" role="header">
              {t('activity.who').toUpperCase()}
            </Text>
            {[
              { id: '', name: t('activity.everybody') },
              ...family.map((m) => ({ id: m.id, name: m.display_name })),
              { id: ELSE, name: t('activity.anybodyElse') },
            ].map((p) => {
              const chosen = filters.who === p.id;
              return (
                <Pressable
                  key={p.id || 'everybody'}
                  testID={`activity-who-${p.id || 'everybody'}`}
                  accessibilityRole="radio"
                  accessibilityLabel={p.name}
                  accessibilityState={{ checked: chosen }}
                  onPress={() => set({ who: p.id })}
                  style={styles.check}
                >
                  <View style={[styles.box, styles.round, chosen ? styles.boxOn : null]}>
                    {chosen ? (
                      <Check color={colours.accent} size={14} accessibilityElementsHidden importantForAccessibility="no" />
                    ) : null}
                  </View>
                  <Text style={styles.flex}>{p.name}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.section}>
            <Text variant="small" weight="700" tone="soft" role="header">
              {t('activity.what').toUpperCase()}
            </Text>
            <View style={styles.wrap}>
              {[{ value: '' as const, label: t('activity.everything') }, ...KINDS].map((k) => (
                <Chip
                  key={k.value || 'everything'}
                  label={k.label}
                  selected={filters.kind === k.value}
                  onPress={() => set({ kind: k.value })}
                  testID={`activity-kind-${k.value || 'everything'}`}
                />
              ))}
            </View>
          </View>
          <View style={styles.section}>
            <Text variant="small" weight="700" tone="soft" role="header">
              {t('activity.days').toUpperCase()}
            </Text>
            <View style={styles.days}>
              <View style={styles.flex}>
                <Field
                  label={t('filters.from')}
                  value={fromText}
                  onChangeText={(v) => {
                    setFromText(v);
                    typed(v, toText);
                  }}
                  placeholder="10 Nov 2026"
                  error={badFrom ? t('filters.badDay') : null}
                  testID="activity-from"
                />
              </View>
              <View style={styles.flex}>
                <Field
                  label={t('filters.to')}
                  value={toText}
                  onChangeText={(v) => {
                    setToText(v);
                    typed(fromText, v);
                  }}
                  placeholder="17 Nov 2026"
                  error={badTo ? t('filters.badDay') : null}
                  testID="activity-to"
                />
              </View>
            </View>
            <Text variant="small" tone="soft">
              {t('activity.daysWords')}
            </Text>
          </View>
        </ScrollView>
        <View style={styles.foot}>
          <Button
            label={t('activity.showCount', { count: shown.length })}
            onPress={() => setPanel(false)}
            testID="activity-filters-done"
          />
        </View>
      </SideSheet>
    </>
  );
}

/** One line: what happened, and exactly when; a line about a document opens it. */
function Line(props: { line: ActivityLine; zone: string; opens: boolean; onOpen: (id: string) => void }) {
  const styles = useStyles(makeStyles);
  const { t } = useTranslation();
  const { line } = props;
  const when = exactWords(line.at, props.zone);
  const words = (
    <>
      <Text weight={line.notable ? '700' : '400'}>{line.text}</Text>
      <Text variant="small" tone="soft">
        {when}
      </Text>
    </>
  );
  if (props.opens && line.document_id) {
    const id = line.document_id;
    return (
      <Pressable
        testID={`activity-line-${line.id}`}
        accessibilityRole="button"
        accessibilityLabel={`${line.text}. ${when}`}
        accessibilityHint={t('activity.lineHint')}
        onPress={() => props.onOpen(id)}
        style={({ pressed }) => [styles.line, pressed ? styles.pressed : null]}
      >
        {words}
      </Pressable>
    );
  }
  return (
    <View style={styles.line} testID={`activity-line-${line.id}`} accessible accessibilityLabel={`${line.text}. ${when}`}>
      {words}
    </View>
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    screen: { backgroundColor: colours.bg },
    page: { padding: sp(20), gap: sp(8) },
    header: { gap: sp(10), marginBottom: sp(4) },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: sp(10) },
    flex: { flex: 1 },
    filterButton: {
      width: 44,
      height: 44,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colours.borderInput,
      backgroundColor: colours.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    filterOn: { backgroundColor: colours.accent, borderColor: colours.accent },
    badge: {
      position: 'absolute',
      top: -6,
      right: -6,
      minWidth: 18,
      height: 18,
      paddingHorizontal: 4,
      borderRadius: 9,
      backgroundColor: colours.danger,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pressed: { opacity: 0.8 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: sp(8) },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: sp(4),
      minHeight: 32,
      paddingLeft: sp(12),
      paddingRight: sp(8),
      borderRadius: 999,
      backgroundColor: colours.accentSoft,
    },
    list: {
      backgroundColor: colours.surface,
      borderRadius: radii.m,
      borderWidth: 1,
      borderColor: colours.border,
      overflow: 'hidden',
    },
    line: {
      gap: 2,
      paddingHorizontal: sp(12),
      paddingVertical: sp(10),
      minHeight: 44,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colours.border,
    },
    panelHead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: sp(8),
      paddingHorizontal: sp(16),
      paddingVertical: sp(10),
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colours.border,
    },
    textButton: { minHeight: 32, justifyContent: 'center' },
    close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    panelBody: { paddingHorizontal: sp(16), paddingBottom: sp(16) },
    section: {
      gap: sp(8),
      paddingVertical: sp(12),
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colours.border,
    },
    check: { flexDirection: 'row', alignItems: 'center', gap: sp(10), minHeight: 44 },
    box: {
      width: 20,
      height: 20,
      borderWidth: 2,
      borderColor: colours.borderInput,
      alignItems: 'center',
      justifyContent: 'center',
    },
    round: { borderRadius: 10 },
    // A tick on its border, not a fill: green alone would read as a status (4.17).
    boxOn: { borderColor: colours.accent },
    wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: sp(8) },
    days: { flexDirection: 'row', gap: sp(8) },
    foot: {
      paddingHorizontal: sp(16),
      paddingTop: sp(10),
      paddingBottom: sp(12),
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colours.border,
    },
  });
