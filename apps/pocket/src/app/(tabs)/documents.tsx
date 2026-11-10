import { NetworkError } from '@fdv/client';
import {
  categoryLabel,
  type DocumentListParams,
  type DocumentView,
  type Member,
  type SearchHit,
  type StatusValue,
  type Visibility,
} from '@fdv/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DocumentRow, rowPlace } from '../../documents/row';
import { on } from '../../state/events';
import { useVault } from '../../state/vault';
import { Field, Notice, Text } from '../../ui';
import { BellButton } from '../../ui/bell';
import { Chip } from '../../ui/chip';
import { sp } from '../../ui/space';
import { LoadFailed, loadFailure, Placeholder } from '../../ui/states';
import { useColours, useStyles, type Palette } from '../../ui/theme';

/**
 * Documents (R3; the owner, 10 Nov 2026: one place for finding things).
 * All documents (P7) and Search (4.12) as one tab:
 *  - With the box empty, every document this person may see, 50 at a time
 *    as they scroll, sorted by when it was added, by title or by when it
 *    expires, and narrowed by person, kind, status and who can see it.
 *  - With words in it, what the vault finds for them, a quarter of a second
 *    after typing stops, narrowed by person and kind. Matches inside the
 *    pages are shown in bold, and the person's own sealed documents are
 *    searched in a second pass. Sort, status and who can see it wait for
 *    the box to be empty: the vault's search does not narrow by them.
 *
 * A vault with the Documents table (0.6.0, `document_table`) sorts by its
 * columns, title and expiry, with every filter on every page; an older one
 * by its older sorts, alpha and expiring. Date added is `recent` on either.
 */

/** How long typing pauses before the vault is asked (FND). */
export const SEARCH_DEBOUNCE_MS = 250;

const PAGE = 50;

type Sort = 'recent' | 'title' | 'expires';
const SORTS: Sort[] = ['recent', 'title', 'expires'];

/** The statuses worth narrowing to, most pressing first. */
const STATUSES: StatusValue[] = ['expired', 'expiring_soon', 'needs_info', 'valid', 'no_longer_needed'];
const VISIBILITIES: Visibility[] = ['household', 'adults', 'private'];

type Sealed = { state: 'idle' | 'searching' | 'done'; items: SearchHit[]; searched: number };

export default function DocumentsScreen() {
  const styles = useStyles(makeStyles);
  const colours = useColours();
  const { t } = useTranslation();
  const { withToken, offline, caps, api } = useVault();
  const table = caps?.features.document_table === true;

  const [q, setQ] = useState('');
  const searching = q.trim() !== '';
  const [sort, setSort] = useState<Sort>('recent');
  const [memberId, setMemberId] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusValue | null>(null);
  const [visibility, setVisibility] = useState<Visibility | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [categories, setCategories] = useState<string[]>([]);

  const [docs, setDocs] = useState<DocumentView[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [more, setMore] = useState(false);
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

  // The chips' choices: the family, and the kinds there are.
  useEffect(() => {
    if (offline || members.length > 0) return;
    let stopped = false;
    withToken((a, tk) => Promise.all([a.members(tk), a.documentTypes(tk)]))
      .then(([m, types]) => {
        if (stopped) return;
        setMembers(m.items);
        setCategories(
          [...new Set(types.items.map((x) => x.category))].sort((x, y) =>
            categoryLabel(x).localeCompare(categoryLabel(y)),
          ),
        );
      })
      .catch(() => undefined);
    return () => {
      stopped = true;
    };
  }, [withToken, offline, members.length]);

  const params = useCallback(
    (after: string | null): DocumentListParams => ({
      ...(sort === 'recent'
        ? { sort: 'recent' }
        : table
          ? { sort, direction: 'asc' }
          : { sort: sort === 'title' ? 'alpha' : 'expiring' }),
      ...(memberId ? { member_id: memberId } : {}),
      ...(category ? { category } : {}),
      ...(status ? { status } : {}),
      ...(visibility ? { visibility } : {}),
      limit: PAGE,
      ...(after ? { cursor: after } : {}),
    }),
    [sort, table, memberId, category, status, visibility],
  );

  /** The first page, for the choices as they are now. */
  const load = useCallback(async () => {
    const n = ++asking.current;
    try {
      const page = await withToken((a, tk) => {
        setToken(tk);
        return a.documents(tk, params(null));
      });
      if (n !== asking.current) return;
      setDocs(page.items);
      setCursor(page.next_cursor);
      setMore(page.has_more && !!page.next_cursor);
      setFailed(null);
    } catch (err) {
      if (n !== asking.current) return;
      setFailed(loadFailure('documents', err, t));
    }
  }, [withToken, params, t]);

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

  // Search: the words, narrowed by person and kind, a quarter of a second after typing stops.
  useEffect(() => {
    // The box emptied: the list is shown, and what was found waits, unshown, for the next words.
    if (!searching) return;
    let cancelled = false;
    const filters = { ...(category ? { category } : {}), ...(memberId ? { member_id: memberId } : {}) };
    const run = async () => {
      try {
        const r = await withToken((a, tk) => a.search(tk, q.trim(), filters));
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
  }, [q, searching, category, memberId, withToken, offline, again, t]);

  /** The next 50, as the person scrolls to the end. */
  const loadMore = async () => {
    if (searching || !more || !cursor || loadingMore) return;
    const n = asking.current;
    setLoadingMore(true);
    try {
      const page = await withToken((a, tk) => a.documents(tk, params(cursor)));
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

  const narrowed = !!(memberId || category || status || visibility);
  const chips = <T extends string>(
    label: string,
    all: string,
    values: readonly T[],
    chosen: T | null,
    choose: (v: T | null) => void,
    words: (v: T) => string,
    id: string,
  ) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.chipRow}>
        <Chip label={all} selected={chosen === null} onPress={() => choose(null)} testID={`${id}-all`} />
        {values.map((v) => (
          <Chip
            key={v}
            label={words(v)}
            selected={chosen === v}
            onPress={() => choose(chosen === v ? null : v)}
            testID={`${id}-${v}`}
          />
        ))}
      </View>
    </ScrollView>
  );

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
            <Field
              testID="search-field"
              label={t('search.field')}
              value={q}
              onChangeText={setQ}
              returnKeyType="search"
              clearButtonMode="while-editing"
            />
            {searching ? null : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                <View accessibilityRole="radiogroup" accessibilityLabel={t('documents.sortBy')} style={styles.chipRow}>
                  {SORTS.map((s) => (
                    <Chip
                      key={s}
                      label={t(`documents.sort_${s}`)}
                      selected={sort === s}
                      onPress={() => setSort(s)}
                      testID={`documents-sort-${s}`}
                    />
                  ))}
                </View>
              </ScrollView>
            )}
            {members.length > 0
              ? chips(
                  t('documents.whose'),
                  t('search.everyone'),
                  members.map((m) => m.id),
                  memberId,
                  setMemberId,
                  (id) => members.find((m) => m.id === id)?.display_name ?? '',
                  'documents-person',
                )
              : null}
            {categories.length > 0
              ? chips(
                  t('documents.kind'),
                  t('search.allKinds'),
                  categories,
                  category,
                  setCategory,
                  (c) => categoryLabel(c),
                  'documents-kind',
                )
              : null}
            {searching
              ? null
              : chips(
                  t('documents.status'),
                  t('documents.anyStatus'),
                  STATUSES,
                  status,
                  setStatus,
                  (s) => t(`documents.status_${s}`),
                  'documents-status',
                )}
            {searching
              ? null
              : chips(
                  t('documents.whoCanSee'),
                  t('documents.anyone'),
                  VISIBILITIES,
                  visibility,
                  setVisibility,
                  (v) => t(`document.visibility_${v}`),
                  'documents-visibility',
                )}

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
                {offline && !docs ? (
                  <Notice tone="warn" testID="documents-offline">
                    {t('documents.needsConnection')}
                  </Notice>
                ) : null}
                {failed ? <LoadFailed words={failed} onRetry={() => void load()} /> : null}
                {!docs && !failed && !offline ? <Placeholder rows={4} /> : null}
                {docs && docs.length === 0 && !more ? (
                  <Text tone="soft" testID="documents-none">
                    {t(narrowed ? 'documents.noneMatch' : 'documents.none')}
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
    </SafeAreaView>
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colours.bg },
    page: { padding: sp(20) },
    header: { gap: sp(12), marginBottom: sp(10) },
    footer: { gap: sp(12), marginTop: sp(10) },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: sp(8) },
    flex: { flex: 1 },
    chips: { paddingVertical: sp(4) },
    chipRow: { flexDirection: 'row', gap: sp(8) },
  });
