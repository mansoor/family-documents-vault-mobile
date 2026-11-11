import { NetworkError } from '@fdv/client';
import {
  formatDate,
  localToday,
  NOTE_KIND,
  type DocumentTypeView,
  type DocumentView,
  type Member,
  type SearchHit,
  type StatusValue,
} from '@fdv/shared';
import { useLocalSearchParams } from 'expo-router';
import { ArrowUpDown, SlidersHorizontal, X } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { countOn, listQuery, NO_FILTERS, searchQuery, type Filters, type Sort } from '../../documents/filter-model';
import { FilterPanel, STATUSES } from '../../documents/filter-panel';
import { DocumentRow, rowPlace } from '../../documents/row';
import { on } from '../../state/events';
import { useFamilyZone } from '../../state/family-time';
import { useVault } from '../../state/vault';
import { Field, Notice, Text } from '../../ui';
import { BellButton } from '../../ui/bell';
import { PickerSheet } from '../../ui/picker';
import { sp } from '../../ui/space';
import { LoadFailed, loadFailure, Placeholder } from '../../ui/states';
import { useColours, useStyles, type Palette } from '../../ui/theme';

/**
 * Documents (R3; the filters, R5 — the owner's redesign of 10 Nov 2026):
 * one place for finding things. The search box, with a filter button
 * beside it that opens the filters from the side; what is on, as chips
 * under the box, each taken off with its ✕; how many, and the sort.
 *  - With the box empty, every document the person may see, 50 at a time
 *    as they scroll, sorted and narrowed.
 *  - With words in it, what the vault finds for them, a quarter of a second
 *    after typing stops, narrowed as the vault's search can: on a vault
 *    with `document_filters` (V1) by every filter, on an older one by the
 *    person and the kind's category. The person's own sealed documents are
 *    searched in a second pass.
 *
 * A vault with the Documents table (0.6.0, `document_table`) sorts by its
 * columns and counts; an older one by its older sorts.
 */

/** How long typing pauses before the vault is asked (FND). */
export const SEARCH_DEBOUNCE_MS = 250;

const PAGE = 50;
const SORTS: Sort[] = ['recent', 'title', 'expires'];

type Sealed = { state: 'idle' | 'searching' | 'done'; items: SearchHit[]; searched: number };

export default function DocumentsScreen() {
  const styles = useStyles(makeStyles);
  const colours = useColours();
  const { t } = useTranslation();
  const zone = useFamilyZone();
  const { withToken, offline, caps, api } = useVault();
  const table = caps?.features.document_table === true;
  const several = caps?.features.document_filters === true;
  // Several tags, and the notes left out: they have their own tab (the owner's tidy-up of 11 Nov 2026).
  const tagsOn = caps?.features.tag_filters === true;
  const notesApart = caps?.features.notes_apart === true;
  const apart = useMemo(() => ({ tags: tagsOn, notes: notesApart }), [tagsOn, notesApart]);
  const [tags, setTags] = useState<string[]>([]);

  // Opened from Home's numbers or an alert (R4): narrowed to that status.
  const { status: asked } = useLocalSearchParams<{ status?: string }>();
  const [q, setQ] = useState('');
  const searching = q.trim() !== '';
  const [sort, setSort] = useState<Sort>('recent');
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [panel, setPanel] = useState(false);
  const [sorting, setSorting] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [types, setTypes] = useState<DocumentTypeView[]>([]);
  useEffect(() => {
    if (asked && (STATUSES as string[]).includes(asked)) {
      // Set when Home asks for it, each time it does.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFilters({ ...NO_FILTERS, statuses: [asked as StatusValue] });
      setQ('');
    }
  }, [asked]);

  const [docs, setDocs] = useState<DocumentView[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [total, setTotal] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Which asking is current: an answer to an older one is let go.
  const asking = useRef(0);

  // What the vault found for the words, and the second pass over the person's sealed ones.
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [sealed, setSealed] = useState<Sealed>({ state: 'idle', items: [], searched: 0 });
  const [unreachable, setUnreachable] = useState(false);
  const [searchFailed, setSearchFailed] = useState<string | null>(null);
  const [again, setAgain] = useState(0);

  // The filters' choices: the family, and the kinds there are.
  useEffect(() => {
    if (offline || members.length > 0) return;
    let stopped = false;
    withToken((a, tk) =>
      Promise.all([
        a.members(tk),
        a.documentTypes(tk),
        tagsOn ? a.tags(tk, undefined, { limit: 1000 }).catch(() => ({ items: [] })) : Promise.resolve({ items: [] }),
      ]),
    )
      .then(([m, ty, tg]) => {
        if (stopped) return;
        setMembers(m.items);
        setTypes(ty.items);
        setTags([...new Set(tg.items.map((x) => x.tag))]);
      })
      .catch(() => undefined);
    return () => {
      stopped = true;
    };
  }, [withToken, offline, members.length, tagsOn]);

  const categoryOf = useCallback((kind: string) => types.find((ty) => ty.key === kind)?.category ?? null, [types]);
  const params = useCallback(
    (f: Filters, after: string | null) => ({
      ...listQuery(f, { sort, table, several, apart }),
      limit: PAGE,
      ...(after ? { cursor: after } : {}),
    }),
    [sort, table, several, apart],
  );

  /** The first page, for the choices as they are now. */
  const load = useCallback(async () => {
    const n = ++asking.current;
    try {
      const page = await withToken((a, tk) => {
        setToken(tk);
        return a.documents(tk, params(filters, null));
      });
      if (n !== asking.current) return;
      setDocs(page.items);
      setCursor(page.next_cursor);
      setMore(page.has_more && !!page.next_cursor);
      setTotal(page.total ?? null);
      setFailed(null);
    } catch (err) {
      if (n !== asking.current) return;
      setFailed(loadFailure('documents', err, t));
    }
  }, [withToken, params, filters, t]);

  useEffect(() => {
    // Asked again whenever a choice changes, and when the connection returns.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDocs(null);
    void load();
  }, [load, offline]);
  // Changed or moved to the Trash on its page (P8): the first page again, and the words asked again.
  useEffect(
    () =>
      on('documentChanged', () => {
        void load();
        setAgain((n) => n + 1);
      }),
    [load],
  );

  // Search: the words, narrowed as the vault's search can, a quarter of a second after typing stops.
  useEffect(() => {
    // The box emptied: the list is shown, and what was found waits, unshown, for the next words.
    if (!searching) return;
    let cancelled = false;
    const narrowed = searchQuery(filters, { several, categoryOf, apart });
    const run = async () => {
      try {
        const r = await withToken((a, tk) => a.search(tk, q.trim(), narrowed));
        if (cancelled) return;
        setUnreachable(false);
        setSearchFailed(null);
        setHits(r.items);
        const handle = r.sealed_pending.token;
        if (!handle) {
          setSealed({ state: 'idle', items: [], searched: 0 });
          return;
        }
        setSealed({ state: 'searching', items: [], searched: 0 });
        const second = await withToken((a, tk) => a.searchSealed(tk, handle));
        if (!cancelled) setSealed({ state: 'done', items: second.items, searched: second.searched });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof NetworkError) setUnreachable(true);
        else setSearchFailed(loadFailure('search', err, t));
        // The second pass never stays "looking" once it has failed.
        setSealed((was) => (was.state === 'searching' ? { state: 'done', items: [], searched: 0 } : was));
      }
    };
    const timer = setTimeout(() => void run(), SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // The connection coming back asks again; so does Try again (P5).
  }, [q, searching, filters, several, categoryOf, apart, withToken, offline, again, t]);

  /** The next 50, as the person scrolls to the end. */
  const loadMore = async () => {
    if (searching || !more || !cursor || loadingMore) return;
    const n = asking.current;
    setLoadingMore(true);
    try {
      const page = await withToken((a, tk) => a.documents(tk, params(filters, cursor)));
      if (n !== asking.current) return;
      setDocs((d) => [...(d ?? []), ...page.items]);
      setCursor(page.next_cursor);
      setMore(page.has_more && !!page.next_cursor);
    } catch (err) {
      if (n === asking.current) setFailed(loadFailure('documents', err, t));
    } finally {
      setLoadingMore(false);
    }
  };

  /** How many the panel's choices would give, for "Show N documents": where the vault can say. */
  const countFor = useCallback(
    async (f: Filters): Promise<number | null> => {
      if (searching) {
        const r = await withToken((a, tk) => a.search(tk, q.trim(), searchQuery(f, { several, categoryOf, apart })));
        return r.items.length;
      }
      if (!table) return null;
      // Counted with a column sort, whichever the list has: only the table counts.
      const page = await withToken((a, tk) =>
        a.documents(tk, { ...listQuery(f, { sort: 'title', table, several, apart }), limit: 1 }),
      );
      return page.total ?? null;
    },
    [searching, q, withToken, several, categoryOf, table, apart],
  );

  const on_ = countOn(filters);
  const named = (ids: string[], name: (id: string) => string) =>
    ids.length === 1 ? name(ids[0] as string) : t('filters.chipMany', { first: name(ids[0] as string), count: ids.length - 1 });
  const person = (id: string) =>
    id === 'none' ? t('filters.nobody') : (members.find((m) => m.id === id)?.display_name ?? '');
  const kind = (key: string) => types.find((ty) => ty.key === key)?.label ?? key;
  const day = (d: string | null) => (d ? formatDate({ date: d, precision: 'day' }) : '…');
  const chips: { id: string; label: string; clear: Partial<Filters> }[] = [
    ...(filters.people.length > 0 ? [{ id: 'people', label: named(filters.people, person), clear: { people: [] } }] : []),
    ...(filters.kinds.length > 0 ? [{ id: 'kinds', label: named(filters.kinds, kind), clear: { kinds: [] } }] : []),
    ...(filters.date
      ? [
          {
            id: 'date',
            label: filters.date.quick
              ? t(`filters.chip_${filters.date.which}_${filters.date.quick}`)
              : t(`filters.chipDays_${filters.date.which}`, { from: day(filters.date.from), to: day(filters.date.to) }),
            clear: { date: null },
          },
        ]
      : []),
    ...(filters.statuses.length > 0
      ? [{ id: 'statuses', label: named(filters.statuses, (s) => t(`documents.status_${s}`)), clear: { statuses: [] } }]
      : []),
    ...(filters.tags.length > 0 ? [{ id: 'tags', label: named(filters.tags, (x) => x), clear: { tags: [] } }] : []),
    ...(filters.visibilities.length > 0
      ? [
          {
            id: 'visibilities',
            label: named(filters.visibilities, (v) => t(`document.visibility_${v}`)),
            clear: { visibilities: [] },
          },
        ]
      : []),
  ];

  const noConnection = searching && (offline || unreachable);
  const found = hits ? hits.length + sealed.items.length : null;
  type Row = {
    id: string;
    title: string | null;
    type_key: string | null;
    note_name: string | undefined;
    status: SearchHit['status'];
    snippet?: string;
    doc?: DocumentView;
    latest?: string | null;
  };
  const rows: Row[] = searching
    ? noConnection
      ? []
      : (hits ?? []).map((h) => ({
          id: h.document_id,
          title: h.title,
          type_key: h.type_key,
          note_name: h.note_name,
          status: h.status,
          snippet: h.snippet,
        }))
    : (docs ?? []).map((d) => ({
        id: d.id,
        title: d.title,
        type_key: d.type_key,
        note_name: d.note_name,
        status: d.status,
        doc: d,
        latest: d.latest_version_id,
      }));

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <FlatList
        testID="documents"
        contentContainerStyle={styles.page}
        data={rows}
        keyExtractor={(d) => d.id}
        keyboardShouldPersistTaps="handled"
        onEndReachedThreshold={0.5}
        onEndReached={() => void loadMore()}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              setAgain((n) => n + 1);
              void load().finally(() => setRefreshing(false));
            }}
          />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <Text variant="hero" style={styles.flex}>
                {t('documents.title')}
              </Text>
              <BellButton />
            </View>
            <View style={styles.searchRow}>
              <View style={styles.flex}>
                <Field
                  testID="search-field"
                  label={t('search.field')}
                  value={q}
                  onChangeText={setQ}
                  returnKeyType="search"
                  clearButtonMode="while-editing"
                />
              </View>
              <Pressable
                testID="documents-filters"
                accessibilityRole="button"
                accessibilityLabel={on_ > 0 ? t('filters.buttonOn', { count: on_ }) : t('filters.button')}
                accessibilityState={{ expanded: panel }}
                onPress={() => setPanel(true)}
                style={({ pressed }) => [styles.filterButton, on_ > 0 ? styles.filterOn : null, pressed ? styles.pressed : null]}
              >
                <SlidersHorizontal
                  color={on_ > 0 ? colours.onAccent : colours.ink}
                  size={20}
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                />
                {on_ > 0 ? (
                  <View style={styles.badge} accessibilityElementsHidden importantForAccessibility="no">
                    <Text variant="small" weight="700" tone="onAccent">
                      {String(on_)}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            </View>
            {chips.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                {chips.map((c) => (
                  <Pressable
                    key={c.id}
                    testID={`documents-chip-${c.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={t('filters.chipOff', { what: c.label })}
                    hitSlop={6}
                    onPress={() => setFilters((f) => ({ ...f, ...c.clear }))}
                    style={({ pressed }) => [styles.chip, pressed ? styles.pressed : null]}
                  >
                    <Text variant="secondary" weight="600" tone="accent">
                      {c.label}
                    </Text>
                    <X color={colours.accent} size={14} accessibilityElementsHidden importantForAccessibility="no" />
                  </Pressable>
                ))}
                {chips.length > 1 ? (
                  <Pressable
                    testID="documents-chips-clear"
                    accessibilityRole="button"
                    accessibilityLabel={t('filters.clearAll')}
                    hitSlop={6}
                    onPress={() => setFilters(NO_FILTERS)}
                    style={styles.clearAll}
                  >
                    <Text variant="secondary" weight="700" tone="soft">
                      {t('filters.clearAll')}
                    </Text>
                  </Pressable>
                ) : null}
              </ScrollView>
            ) : null}

            {searching ? (
              <>
                {noConnection ? (
                  <Notice tone="warn" testID="search-offline">
                    {t('search.needsConnection')}
                  </Notice>
                ) : null}
                {!noConnection && searchFailed ? (
                  <LoadFailed words={searchFailed} onRetry={() => setAgain((n) => n + 1)} />
                ) : null}
                {!noConnection && !searchFailed && found === null ? <Placeholder /> : null}
                {!noConnection && found !== null ? (
                  <View accessibilityLiveRegion="polite">
                    {found === 0 && sealed.state !== 'searching' ? (
                      <Text tone="soft" testID="search-nothing">
                        {t('search.nothing')}
                      </Text>
                    ) : (
                      <Text tone="soft" testID="search-count">
                        {t('search.results', { count: found })}
                      </Text>
                    )}
                  </View>
                ) : null}
              </>
            ) : (
              <>
                <View style={styles.countRow}>
                  <Text variant="secondary" tone="soft" style={styles.flex} testID="documents-count">
                    {total !== null ? t('glance.documentsCount', { count: total }) : ''}
                  </Text>
                  <Pressable
                    testID="documents-sort"
                    accessibilityRole="button"
                    accessibilityLabel={t('documents.sortNow', { sort: t(`documents.sort_${sort}`) })}
                    hitSlop={6}
                    onPress={() => setSorting(true)}
                    style={({ pressed }) => [styles.sortButton, pressed ? styles.pressed : null]}
                  >
                    <ArrowUpDown color={colours.ink} size={15} accessibilityElementsHidden importantForAccessibility="no" />
                    <Text variant="secondary" weight="600">
                      {t(`documents.sort_${sort}`)}
                    </Text>
                  </Pressable>
                </View>
                {offline && !docs ? (
                  <Notice tone="warn" testID="documents-offline">
                    {t('documents.needsConnection')}
                  </Notice>
                ) : null}
                {failed ? <LoadFailed words={failed} onRetry={() => void load()} /> : null}
                {!docs && !failed && !offline ? <Placeholder rows={4} /> : null}
                {docs && docs.length === 0 && !more ? (
                  <Text tone="soft" testID="documents-none">
                    {t(on_ > 0 ? 'documents.noneMatch' : 'documents.none')}
                  </Text>
                ) : null}
              </>
            )}
          </View>
        }
        renderItem={({ item, index }) => (
          <DocumentRow
            id={item.id}
            title={item.title}
            type_key={item.type_key}
            note_name={item.note_name}
            status={item.status}
            {...(item.snippet ? { snippet: item.snippet } : {})}
            {...(item.doc ? { doc: item.doc } : {})}
            place={rowPlace(index, rows.length)}
            thumb={api && token && item.latest ? { uri: api.thumbnailUrl(item.latest), token } : null}
          />
        )}
        ListFooterComponent={
          searching ? (
            noConnection || !hits ? null : (
              <View style={styles.footer}>
                {sealed.state === 'searching' ? (
                  <Text tone="soft" testID="search-sealed-searching">
                    {t('search.sealedSearching')}
                  </Text>
                ) : null}
                {sealed.items.length > 0 ? <Text variant="screen">{t('search.sealedTitle')}</Text> : null}
                {sealed.items.map((h, i) => (
                  <DocumentRow
                    key={h.document_id}
                    id={h.document_id}
                    title={h.title}
                    type_key={h.type_key}
                    note_name={h.note_name}
                    status={h.status}
                    snippet={h.snippet}
                    place={rowPlace(i, sealed.items.length)}
                  />
                ))}
                {sealed.state === 'done' && sealed.items.length === 0 && sealed.searched > 0 ? (
                  <Text tone="soft" testID="search-sealed-none">
                    {t('search.sealedNone', { count: sealed.searched })}
                  </Text>
                ) : null}
              </View>
            )
          ) : loadingMore ? (
            <ActivityIndicator color={colours.accent} accessibilityLabel={t('common.loading')} testID="documents-more" />
          ) : null
        }
      />
      <FilterPanel
        visible={panel}
        value={filters}
        onApply={(f) => {
          setFilters(f);
          setPanel(false);
        }}
        onClose={() => setPanel(false)}
        members={members}
        // Notes have their own tab: no Note among Documents' kinds where the vault leaves them out.
        types={notesApart ? types.filter((ty) => ty.key !== NOTE_KIND) : types}
        tags={tagsOn ? tags : null}
        several={several}
        // Nobody's goes with a column sort only, and the list's first sort is not one.
        nobody={false}
        today={localToday(zone)}
        count={countFor}
      />
      <PickerSheet
        visible={sorting}
        title={t('documents.sortBy')}
        options={SORTS.map((s) => ({ value: s, label: t(`documents.sort_${s}`) }))}
        chosen={[sort]}
        onDone={([s]) => {
          setSorting(false);
          if (s) setSort(s as Sort);
        }}
        onClose={() => setSorting(false)}
        testID="documents-sort-sheet"
        optionID="documents-sort"
      />
    </SafeAreaView>
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colours.bg },
    page: { padding: sp(20) },
    header: { gap: sp(10), marginBottom: sp(10) },
    footer: { gap: sp(12), marginTop: sp(10) },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: sp(8) },
    flex: { flex: 1 },
    searchRow: { flexDirection: 'row', alignItems: 'flex-end', gap: sp(8) },
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
    chips: { flexDirection: 'row', alignItems: 'center', gap: sp(8), paddingVertical: 2 },
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
    clearAll: { minHeight: 32, justifyContent: 'center', paddingHorizontal: sp(4) },
    countRow: { flexDirection: 'row', alignItems: 'center', gap: sp(8) },
    sortButton: { flexDirection: 'row', alignItems: 'center', gap: sp(6), minHeight: 32 },
  });
