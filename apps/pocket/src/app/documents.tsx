import {
  categoryLabel,
  type DocumentListParams,
  type DocumentView,
  type Member,
  type StatusValue,
  type Visibility,
} from '@fdv/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { DocumentRow, rowPlace } from '../documents/row';
import { on } from '../state/events';
import { useVault } from '../state/vault';
import { Notice, Text } from '../ui';
import { Chip } from '../ui/chip';
import { sp } from '../ui/space';
import { LoadFailed, loadFailure, Placeholder } from '../ui/states';
import { useColours, useStyles, type Palette } from '../ui/theme';

/**
 * All your documents (P7): every document this person may see, 50 at a
 * time as they scroll, sorted by when it was added, by title or by when it
 * expires, and narrowed by person, kind, status and who can see it. The
 * same rows as Home and Search, each with its picture. Search keeps its
 * own job: words first.
 *
 * A vault with the Documents table (0.6.0, `document_table`) sorts by its
 * columns, title and expiry, with every filter on every page; an older one
 * by its older sorts, alpha and expiring, as it always answered them.
 * Date added is the older sort `recent` on either.
 */

const PAGE = 50;

type Sort = 'recent' | 'title' | 'expires';
const SORTS: Sort[] = ['recent', 'title', 'expires'];

/** The statuses worth narrowing to, most pressing first. */
const STATUSES: StatusValue[] = ['expired', 'expiring_soon', 'needs_info', 'valid', 'no_longer_needed'];
const VISIBILITIES: Visibility[] = ['household', 'adults', 'private'];

export default function DocumentsScreen() {
  const styles = useStyles(makeStyles);
  const colours = useColours();
  const { t } = useTranslation();
  const { withToken, offline, caps, api } = useVault();
  const table = caps?.features.document_table === true;

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
  // Changed or moved to the Trash on its page (P8): the first page again.
  useEffect(() => on('documentChanged', () => void load()), [load]);

  /** The next 50, as the person scrolls to the end. */
  const loadMore = async () => {
    if (!more || !cursor || loadingMore) return;
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

  return (
    <FlatList
      testID="documents"
      style={styles.screen}
      contentContainerStyle={styles.page}
      data={docs ?? []}
      keyExtractor={(d) => d.id}
      onEndReachedThreshold={0.5}
      onEndReached={() => void loadMore()}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load().finally(() => setRefreshing(false));
          }}
        />
      }
      ListHeaderComponent={
        <View style={styles.header}>
          <Text variant="hero">{t('documents.title')}</Text>
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
          {chips(
            t('documents.status'),
            t('documents.anyStatus'),
            STATUSES,
            status,
            setStatus,
            (s) => t(`documents.status_${s}`),
            'documents-status',
          )}
          {chips(
            t('documents.whoCanSee'),
            t('documents.anyone'),
            VISIBILITIES,
            visibility,
            setVisibility,
            (v) => t(`document.visibility_${v}`),
            'documents-visibility',
          )}
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
        </View>
      }
      renderItem={({ item, index }) => (
        <DocumentRow
          id={item.id}
          title={item.title}
          type_key={item.type_key}
          note_name={item.note_name}
          status={item.status}
          doc={item}
          place={rowPlace(index, docs?.length ?? 0)}
          thumb={
            api && token && item.latest_version_id ? { uri: api.thumbnailUrl(item.latest_version_id), token } : null
          }
        />
      )}
      ListFooterComponent={
        loadingMore ? (
          <ActivityIndicator color={colours.accent} accessibilityLabel={t('common.loading')} testID="documents-more" />
        ) : null
      }
    />
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    screen: { backgroundColor: colours.bg },
    page: { padding: sp(20) },
    header: { gap: sp(12), marginBottom: sp(10) },
    chips: { paddingVertical: sp(4) },
    chipRow: { flexDirection: 'row', gap: sp(8) },
  });
