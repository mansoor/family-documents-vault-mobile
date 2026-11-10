import { NetworkError } from '@fdv/client';
import { categoryLabel, type DocumentView, type Member, type SearchHit } from '@fdv/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DocumentRow, rowPlace } from '../../documents/row';
import { on } from '../../state/events';
import { useVault } from '../../state/vault';
import { Field, Notice, Text } from '../../ui';
import { Chip } from '../../ui/chip';
import { sp } from '../../ui/space';
import { useStyles, type Palette } from '../../ui/theme';
import { LoadFailed, loadFailure, Placeholder } from '../../ui/states';

/** How long typing pauses before the vault is asked (FND). */
export const SEARCH_DEBOUNCE_MS = 250;

type Sealed = { state: 'idle' | 'searching' | 'done'; items: SearchHit[]; searched: number };
type Row = {
  id: string;
  title: string | null;
  type_key: string | null;
  note_name: string | undefined;
  status: SearchHit['status'];
  snippet?: string;
  doc?: DocumentView;
};

/**
 * Search (4.12): one field, results as the person types (a quarter of a
 * second after they stop), narrowed by person and by kind. Matches inside
 * the pages are shown in bold, never as markup. The person's own sealed
 * documents are searched in a second pass. Without a connection it says
 * so — and where the kept Essentials are.
 */
export default function SearchScreen() {
  const styles = useStyles(makeStyles);
  const { t } = useTranslation();
  const { withToken, offline } = useVault();
  const [q, setQ] = useState('');
  const [memberId, setMemberId] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [browse, setBrowse] = useState<DocumentView[] | null>(null);
  const [sealed, setSealed] = useState<Sealed>({ state: 'idle', items: [], searched: 0 });
  const [unreachable, setUnreachable] = useState(false);
  // A failure that is not the connection (P5): said, with Try again.
  const [failed, setFailed] = useState<string | null>(null);
  const [again, setAgain] = useState(0);

  // The chips: the family, and the kinds of document there are — asked
  // again when the connection returns, until they have come.
  const chipsLoaded = members.length > 0;
  useEffect(() => {
    if (chipsLoaded || offline) return;
    let cancelled = false;
    void withToken((a, token) => Promise.all([a.members(token), a.documentTypes(token)]))
      .then(([m, types]) => {
        if (cancelled) return;
        setMembers(m.items);
        setCategories(
          [...new Set(types.items.map((x) => x.category))].sort((x, y) =>
            categoryLabel(x).localeCompare(categoryLabel(y)),
          ),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [withToken, offline, chipsLoaded]);

  useEffect(() => {
    let cancelled = false;
    const filters = { ...(category ? { category } : {}), ...(memberId ? { member_id: memberId } : {}) };
    const run = async () => {
      try {
        if (q.trim()) {
          const r = await withToken((a, token) => a.search(token, q.trim(), filters));
          if (cancelled) return;
          setUnreachable(false);
          setFailed(null);
          setHits(r.items);
          setBrowse(null);
          const handle = r.sealed_pending.token;
          if (!handle) {
            setSealed({ state: 'idle', items: [], searched: 0 });
            return;
          }
          setSealed({ state: 'searching', items: [], searched: 0 });
          const more = await withToken((a, token) => a.searchSealed(token, handle));
          if (!cancelled) setSealed({ state: 'done', items: more.items, searched: more.searched });
        } else {
          const r = await withToken((a, token) => a.documents(token, { ...filters, limit: 100 }));
          if (cancelled) return;
          setUnreachable(false);
          setFailed(null);
          setBrowse(r.items);
          setHits(null);
          setSealed({ state: 'idle', items: [], searched: 0 });
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof NetworkError) setUnreachable(true);
        else setFailed(loadFailure('search', err, t));
        // The second pass never stays "looking" once it has failed.
        setSealed((was) => (was.state === 'searching' ? { state: 'done', items: [], searched: 0 } : was));
      }
    };
    const timer = setTimeout(() => void run(), q ? SEARCH_DEBOUNCE_MS : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // The connection coming back asks again; so does Try again (P5).
  }, [q, category, memberId, withToken, offline, again, t]);
  // Changed or moved to the Trash on its page (P8): asked again.
  useEffect(() => on('documentChanged', () => setAgain((n) => n + 1)), []);

  const noConnection = offline || unreachable;
  const found = hits ? hits.length + sealed.items.length : null;
  // One kind of row, whether searched or browsed.
  const rows: Row[] = noConnection
    ? []
    : hits
      ? hits.map((h) => ({
          id: h.document_id,
          title: h.title,
          type_key: h.type_key,
          note_name: h.note_name,
          status: h.status,
          snippet: h.snippet,
        }))
      : (browse ?? []).map((d) => ({
          id: d.id,
          title: d.title,
          type_key: d.type_key,
          note_name: d.note_name,
          status: d.status,
          doc: d,
        }));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <FlatList
        testID="search-list"
        data={rows}
        keyExtractor={(d) => d.id}
        contentContainerStyle={styles.page}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.header}>
            <Text variant="hero">{t('search.title')}</Text>
            <Field
              testID="search-field"
              label={t('search.field')}
              value={q}
              onChangeText={setQ}
              returnKeyType="search"
              clearButtonMode="while-editing"
            />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              <Chip label={t('search.everyone')} selected={memberId === null} onPress={() => setMemberId(null)} />
              {members.map((m) => (
                <Chip
                  key={m.id}
                  label={m.display_name}
                  selected={memberId === m.id}
                  onPress={() => setMemberId(memberId === m.id ? null : m.id)}
                  testID={`chip-member-${m.id}`}
                />
              ))}
            </ScrollView>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              <Chip label={t('search.allKinds')} selected={category === null} onPress={() => setCategory(null)} />
              {categories.map((c) => (
                <Chip
                  key={c}
                  label={categoryLabel(c)}
                  selected={category === c}
                  onPress={() => setCategory(category === c ? null : c)}
                  testID={`chip-category-${c}`}
                />
              ))}
            </ScrollView>
            {noConnection ? (
              <Notice tone="warn" testID="search-offline">
                {t('search.needsConnection')}
              </Notice>
            ) : null}
            {!noConnection && failed ? (
              <LoadFailed words={failed} onRetry={() => setAgain((n) => n + 1)} />
            ) : null}
            {!noConnection && !failed && found === null ? <Placeholder /> : null}
            {!noConnection && found !== null ? (
              found === 0 && sealed.state !== 'searching' ? (
                <View accessibilityLiveRegion="polite">
                  <Text tone="soft" testID="search-nothing">
                    {t('search.nothing')}
                  </Text>
                </View>
              ) : (
                <View accessibilityLiveRegion="polite">
                  <Text tone="soft" testID="search-count">
                    {t('search.results', { count: found })}
                  </Text>
                </View>
              )
            ) : null}
          </View>
        }
        renderItem={({ item, index }) => <DocumentRow {...item} place={rowPlace(index, rows.length)} />}
        ListFooterComponent={
          noConnection || !hits ? null : (
            <View style={styles.footer}>
              {sealed.state === 'searching' ? (
                <Text tone="soft" testID="search-sealed-searching">
                  {t('search.sealedSearching')}
                </Text>
              ) : null}
              {sealed.items.length > 0 ? <Text variant="screen">{t('search.sealedTitle')}</Text> : null}
              {sealed.items.map((h) => (
                <DocumentRow
                  key={h.document_id}
                  id={h.document_id}
                  title={h.title}
                  type_key={h.type_key}
                  note_name={h.note_name}
                  status={h.status}
                  snippet={h.snippet}
                />
              ))}
              {sealed.state === 'done' && sealed.items.length === 0 && sealed.searched > 0 ? (
                <Text tone="soft" testID="search-sealed-none">
                  {t('search.sealedNone', { count: sealed.searched })}
                </Text>
              ) : null}
            </View>
          )
        }
      />
    </SafeAreaView>
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colours.bg },
    page: { padding: sp(20) },
    header: { gap: sp(12), marginBottom: sp(10) },
    footer: { gap: sp(12), marginTop: sp(10) },
    chips: { gap: sp(8), paddingVertical: sp(4) },
  });
