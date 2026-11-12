import {
  categoryLabel,
  formatDate,
  parseDateInput,
  shortTypeLabel,
  type DateValue,
  type DocumentTypeView,
  type Member,
  type StatusValue,
  type Visibility,
} from '@fdv/shared';
import { Check, X } from 'lucide-react-native';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { matchTypes, rankTypes } from '../capture/types';
import { Button, Field, Text } from '../ui';
import { Chip } from '../ui/chip';
import { ChipLine, PickerSheet } from '../ui/picker';
import { SideSheet } from '../ui/side-sheet';
import { sp } from '../ui/space';
import { useColours, useStyles, type Palette } from '../ui/theme';
import { NO_FILTERS, QUICK, quickRange, toggle, type DateWhich, type Filters } from './filter-model';

/** The statuses worth narrowing to, most pressing first. */
// In date (`active`: an expiry, still to come) and Nothing to renew
// (`valid`: complete, with no expiry), as the vault and the web say them.
export const STATUSES: StatusValue[] = ['expired', 'expiring_soon', 'needs_info', 'active', 'valid', 'no_longer_needed'];
const VISIBILITIES: Visibility[] = ['household', 'adults', 'private'];
const WHICH: DateWhich[] = ['added', 'issued', 'expires'];
/** How many people before "Show all". */
const PEOPLE_SHOWN = 6;

/** A day typed as the card takes it ("14 Mar 2031", "Mar 2031", "2031"): its first, or last, day. */
function dayOf(text: string, end: boolean): string | null | 'bad' {
  if (!text.trim()) return null;
  const v: DateValue | null = parseDateInput(text);
  if (!v) return 'bad';
  if (v.precision === 'day') return v.date;
  const [y, m] = v.date.split('-');
  if (v.precision === 'year') return end ? `${y}-12-31` : `${y}-01-01`;
  if (!end) return `${y}-${m}-01`;
  const last = new Date(Date.UTC(Number(y), Number(m), 0)).getUTCDate();
  return `${y}-${m}-${String(last).padStart(2, '0')}`;
}
const shown = (day: string | null) => (day ? formatDate({ date: day, precision: 'day' }) : '');

/**
 * The filters, sliding out from the right (R5; the mockup's "Filters"):
 * Whose, Kind, Dates, Status and Who can see it, each a group; "Show N
 * documents" at the foot says how many before the panel is left, and
 * "Clear all" at the top. Nothing applies until Show: the list behind is
 * as it was.
 */
/** How many of the most used tags are offered as chips; the rest are under More. */
const TAGS_SHOWN = 6;

export function FilterPanel(props: {
  visible: boolean;
  value: Filters;
  onApply: (f: Filters) => void;
  onClose: () => void;
  members: readonly Member[];
  types: readonly DocumentTypeView[];
  /** The vault takes several of each, and the days (V1). */
  several: boolean;
  /** Nobody's may be asked for: a column sort (the Documents table). */
  nobody: boolean;
  /** The household's may be asked for (`household_owner`, 0.9.0-dev.32). */
  household?: boolean;
  today: string;
  /** How many the filters would give; null when the vault cannot say. */
  count: (f: Filters) => Promise<number | null>;
  /** The tags there are, most used first, where the vault filters by several (`tag_filters`); null otherwise. */
  tags?: readonly string[] | null;
}) {
  const styles = useStyles(makeStyles);
  const colours = useColours();
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Filters>(props.value);
  const [which, setWhich] = useState<DateWhich>(props.value.date?.which ?? 'expires');
  const [fromText, setFromText] = useState('');
  const [toText, setToText] = useState('');
  const [allPeople, setAllPeople] = useState(false);
  const [kindsOpen, setKindsOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [n, setN] = useState<number | null>(null);
  const several = props.several;

  // Opened again: from what applies now.
  useEffect(() => {
    if (!props.visible) return;
    // Taken from the list each time the panel opens.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(props.value);
    setWhich(props.value.date?.which ?? 'expires');
    setFromText(shown(props.value.date?.from ?? null));
    setToText(shown(props.value.date?.to ?? null));
  }, [props.visible, props.value]);

  // How many: asked again a moment after each change.
  const { count } = props;
  useEffect(() => {
    if (!props.visible) return;
    let stopped = false;
    const timer = setTimeout(() => {
      count(draft)
        .then((x) => {
          if (!stopped) setN(x);
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [draft, props.visible, count]);

  const set = (patch: Partial<Filters>) => setDraft((d) => ({ ...d, ...patch }));
  const typedDays = (from: string, to: string, w: DateWhich) => {
    const f = dayOf(from, false);
    const e = dayOf(to, true);
    if (f === 'bad' || e === 'bad') return;
    set({ date: f || e ? { which: w, from: f, to: e } : null });
  };
  const badFrom = dayOf(fromText, false) === 'bad';
  const badTo = dayOf(toText, true) === 'bad';

  const people = [
    ...props.members.map((m) => ({ id: m.id, name: m.display_name })),
    ...(props.household ? [{ id: 'household', name: t('capture.household') }] : []),
    ...(props.nobody && several ? [{ id: 'none', name: t('filters.nobody') }] : []),
  ];
  const ranked = rankTypes(props.types, []).top;
  const allKinds = matchTypes(props.types, '')
    .map((ty) => ({ value: ty.key, label: ty.label, group: categoryLabel(ty.category) }))
    .sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));

  return (
    <SideSheet visible={props.visible} onClose={props.onClose} testID="filters">
      <View style={styles.head}>
        <Text variant="title" style={styles.flex} role="header">
          {t('filters.title')}
        </Text>
        <Pressable
          testID="filters-clear"
          accessibilityRole="button"
          accessibilityLabel={t('filters.clearAll')}
          hitSlop={8}
          onPress={() => {
            setDraft(NO_FILTERS);
            setFromText('');
            setToText('');
          }}
          style={styles.textButton}
        >
          <Text variant="secondary" weight="700" tone="accent">
            {t('filters.clearAll')}
          </Text>
        </Pressable>
        <Pressable
          testID="filters-close"
          accessibilityRole="button"
          accessibilityLabel={t('filters.close')}
          hitSlop={4}
          onPress={props.onClose}
          style={styles.close}
        >
          <X color={colours.ink} size={20} accessibilityElementsHidden importantForAccessibility="no" />
        </Pressable>
      </View>

      <ScrollView style={styles.flex} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Section title={t('filters.whose')} chosen={draft.people.length}>
          {(allPeople ? people : people.slice(0, PEOPLE_SHOWN)).map((p) => {
            const on = draft.people.includes(p.id);
            return (
              <Pressable
                key={p.id}
                testID={`filter-person-${p.id}`}
                accessibilityRole={several ? 'checkbox' : 'radio'}
                accessibilityLabel={p.name}
                accessibilityState={{ checked: on }}
                onPress={() => set({ people: toggle(draft.people, p.id, several) })}
                style={styles.check}
              >
                <View style={[styles.box, several ? null : styles.round, on ? styles.boxOn : null]}>
                  {on ? <Check color={colours.accent} size={14} accessibilityElementsHidden importantForAccessibility="no" /> : null}
                </View>
                <Text style={styles.flex}>{p.name}</Text>
              </Pressable>
            );
          })}
          {!allPeople && people.length > PEOPLE_SHOWN ? (
            <Pressable
              testID="filter-people-all"
              accessibilityRole="button"
              accessibilityLabel={t('filters.allPeople', { count: people.length })}
              onPress={() => setAllPeople(true)}
              style={styles.check}
            >
              <Text variant="secondary" weight="700" tone="accent">
                {t('filters.allPeople', { count: people.length })}
              </Text>
            </Pressable>
          ) : null}
        </Section>

        <Section title={t('filters.kind')} chosen={draft.kinds.length}>
          <ChipLine
            label={t('filters.kind')}
            options={ranked.map((ty) => ({ value: ty.key, label: ty.label, short: shortTypeLabel(ty) }))}
            chosen={draft.kinds}
            onToggle={(k) => set({ kinds: toggle(draft.kinds, k, several) })}
            onMore={() => setKindsOpen(true)}
            moreID="filter-kinds-more"
            expanded={kindsOpen}
            chipID="filter-kind"
          />
        </Section>

        {several ? (
          <Section title={t('filters.dates')} chosen={draft.date ? 1 : 0}>
            <View style={styles.segment} accessibilityRole="radiogroup" accessibilityLabel={t('filters.dates')}>
              {WHICH.map((w) => (
                <Pressable
                  key={w}
                  testID={`filter-date-${w}`}
                  accessibilityRole="radio"
                  accessibilityLabel={t(`filters.which_${w}`)}
                  accessibilityState={{ checked: which === w }}
                  hitSlop={6}
                  onPress={() => {
                    setWhich(w);
                    if (draft.date) set({ date: { ...draft.date, which: w, quick: undefined } });
                  }}
                  style={[styles.segmentItem, which === w ? styles.segmentOn : null]}
                >
                  <Text variant="secondary" weight="700" tone={which === w ? 'ink' : 'soft'}>
                    {t(`filters.which_${w}`)}
                  </Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.chips}>
              {QUICK[which].map((q) => (
                <Chip
                  key={q}
                  label={t(`filters.quick_${which}_${q}`)}
                  selected={draft.date?.which === which && draft.date.quick === q}
                  onPress={() => {
                    const on = draft.date?.which === which && draft.date.quick === q;
                    const range = on ? null : quickRange(which, q, props.today);
                    set({ date: range });
                    setFromText(shown(range?.from ?? null));
                    setToText(shown(range?.to ?? null));
                  }}
                  testID={`filter-quick-${q}`}
                />
              ))}
            </View>
            <View style={styles.days}>
              <View style={styles.flex}>
                <Field
                  label={t('filters.from')}
                  value={fromText}
                  onChangeText={(v) => {
                    setFromText(v);
                    typedDays(v, toText, which);
                  }}
                  placeholder="10 Nov 2026"
                  error={badFrom ? t('filters.badDay') : null}
                  testID="filter-from"
                />
              </View>
              <View style={styles.flex}>
                <Field
                  label={t('filters.to')}
                  value={toText}
                  onChangeText={(v) => {
                    setToText(v);
                    typedDays(fromText, v, which);
                  }}
                  placeholder="8 Feb 2027"
                  error={badTo ? t('filters.badDay') : null}
                  testID="filter-to"
                />
              </View>
            </View>
          </Section>
        ) : null}

        <Section title={t('filters.status')} chosen={draft.statuses.length}>
          <View style={styles.chips}>
            {STATUSES.map((s) => (
              <Chip
                key={s}
                label={t(`documents.status_${s}`)}
                selected={draft.statuses.includes(s)}
                onPress={() => set({ statuses: toggle(draft.statuses, s, several) })}
                testID={`filter-status-${s}`}
              />
            ))}
          </View>
        </Section>

        {props.tags && props.tags.length > 0 ? (
          <Section title={t('filters.tags')} chosen={draft.tags.length}>
            <ChipLine
              label={t('filters.tags')}
              options={[...new Set([...draft.tags, ...props.tags.slice(0, TAGS_SHOWN)])].map((tag) => ({
                value: tag,
                label: tag,
              }))}
              chosen={draft.tags}
              onToggle={(tag) => set({ tags: toggle(draft.tags, tag, true) })}
              onMore={() => setTagsOpen(true)}
              moreID="filter-tags-more"
              expanded={tagsOpen}
              chipID="filter-tag"
            />
          </Section>
        ) : null}

        <Section title={t('filters.whoCanSee')} chosen={draft.visibilities.length}>
          <View style={styles.chips}>
            {VISIBILITIES.map((v) => (
              <Chip
                key={v}
                label={t(`document.visibility_${v}`)}
                selected={draft.visibilities.includes(v)}
                onPress={() => set({ visibilities: toggle(draft.visibilities, v, several) })}
                testID={`filter-visibility-${v}`}
              />
            ))}
          </View>
        </Section>
        {several ? null : (
          <Text variant="secondary" tone="soft" testID="filters-older">
            {t('filters.older')}
          </Text>
        )}
      </ScrollView>

      <View style={styles.foot}>
        <Button
          testID="filters-apply"
          label={n === null ? t('filters.show') : t('filters.showCount', { count: n })}
          disabled={badFrom || badTo}
          onPress={() => props.onApply(draft)}
        />
      </View>

      <PickerSheet
        visible={kindsOpen}
        title={t('filters.kind')}
        options={allKinds}
        chosen={draft.kinds}
        multi={several}
        onDone={(v) => {
          setKindsOpen(false);
          set({ kinds: several ? v : v.slice(0, 1) });
        }}
        onClose={() => setKindsOpen(false)}
        testID="filter-kinds"
        findID="filter-kinds-find"
        optionID="filter-kinds-pick"
      />
      <PickerSheet
        visible={tagsOpen}
        title={t('filters.tags')}
        options={(props.tags ?? []).map((tag) => ({ value: tag, label: tag }))}
        chosen={draft.tags}
        multi
        onDone={(v) => {
          setTagsOpen(false);
          set({ tags: v });
        }}
        onClose={() => setTagsOpen(false)}
        testID="filter-tags"
        findID="filter-tags-find"
        optionID="filter-tags-pick"
      />
    </SideSheet>
  );
}

function Section(props: { title: string; chosen: number; children: ReactNode }) {
  const styles = useStyles(makeStyles);
  const { t } = useTranslation();
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text variant="small" weight="700" tone="soft" style={styles.flex} role="header">
          {props.title.toUpperCase()}
        </Text>
        {props.chosen > 0 ? (
          <Text variant="small" weight="600" tone="accent">
            {t('filters.chosen', { count: props.chosen })}
          </Text>
        ) : null}
      </View>
      {props.children}
    </View>
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    flex: { flex: 1 },
    head: {
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
    body: { paddingHorizontal: sp(16), paddingBottom: sp(16) },
    section: {
      gap: sp(8),
      paddingVertical: sp(12),
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colours.border,
    },
    sectionHead: { flexDirection: 'row', alignItems: 'center' },
    check: { flexDirection: 'row', alignItems: 'center', gap: sp(10), minHeight: 44 },
    box: {
      width: 20,
      height: 20,
      borderRadius: 5,
      borderWidth: 2,
      borderColor: colours.borderInput,
      alignItems: 'center',
      justifyContent: 'center',
    },
    round: { borderRadius: 10 },
    // A tick on its border, not a fill: green alone would read as a status (4.17).
    boxOn: { borderColor: colours.accent },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: sp(8) },
    segment: {
      flexDirection: 'row',
      gap: sp(4),
      padding: 3,
      borderRadius: 10,
      backgroundColor: colours.border,
    },
    segmentItem: { flex: 1, minHeight: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
    segmentOn: { backgroundColor: colours.surface },
    days: { flexDirection: 'row', gap: sp(8) },
    foot: {
      paddingHorizontal: sp(16),
      paddingTop: sp(10),
      paddingBottom: sp(12),
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colours.border,
    },
  });
