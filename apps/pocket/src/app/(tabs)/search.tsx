import { NetworkError } from '@fdv/client';
import { categoryLabel, colours, radii, type DocumentView, type Member, type SearchHit } from '@fdv/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DocumentRow } from '../../documents/row';
import { useVault } from '../../state/vault';
import { Field, Notice, Text } from '../../ui';

/** How long typing pauses before the vault is asked (FND). */
export const SEARCH_DEBOUNCE_MS = 250;

type Sealed = { state: 'idle' | 'searching' | 'done'; items: SearchHit[]; searched: number };
type Row = { id: string; title: string | null; status: SearchHit['status']; snippet?: string; doc?: DocumentView };

/**
 * Search (4.12): one field, results as the person types (a quarter of a
 * second after they stop), narrowed by person and by kind. Matches inside
 * the pages are shown in bold, never as markup. The person's own sealed
 * documents are searched in a second pass. Without a connection it says
 * so — and where the kept Essentials are.
 */
export default function SearchScreen() {
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
          setBrowse(r.items);
          setHits(null);
          setSealed({ state: 'idle', items: [], searched: 0 });
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof NetworkError) setUnreachable(true);
        // The second pass never stays "looking" once it has failed.
        setSealed((was) => (was.state === 'searching' ? { state: 'done', items: [], searched: 0 } : was));
      }
    };
    const timer = setTimeout(() => void run(), q ? SEARCH_DEBOUNCE_MS : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // The connection coming back asks again.
  }, [q, category, memberId, withToken, offline]);

  const noConnection = offline || unreachable;
  const found = hits ? hits.length + sealed.items.length : null;
  // One kind of row, whether searched or browsed.
  const rows: Row[] = noConnection
    ? []
    : hits
      ? hits.map((h) => ({ id: h.document_id, title: h.title, status: h.status, snippet: h.snippet }))
      : (browse ?? []).map((d) => ({ id: d.id, title: d.title, status: d.status, doc: d }));

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
              <Chip label={t('search.everyone')} on={memberId === null} onPress={() => setMemberId(null)} />
              {members.map((m) => (
                <Chip
                  key={m.id}
                  label={m.display_name}
                  on={memberId === m.id}
                  onPress={() => setMemberId(memberId === m.id ? null : m.id)}
                  testID={`chip-member-${m.id}`}
                />
              ))}
            </ScrollView>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              <Chip label={t('search.allKinds')} on={category === null} onPress={() => setCategory(null)} />
              {categories.map((c) => (
                <Chip
                  key={c}
                  label={categoryLabel(c)}
                  on={category === c}
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
        renderItem={({ item }) => <DocumentRow {...item} />}
        ListFooterComponent={
          noConnection || !hits ? null : (
            <View style={styles.header}>
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

function Chip(props: { label: string; on: boolean; onPress: () => void; testID?: string }) {
  return (
    <Pressable
      {...(props.testID ? { testID: props.testID } : {})}
      accessibilityRole="button"
      accessibilityState={{ selected: props.on }}
      accessibilityLabel={props.label}
      onPress={props.onPress}
      style={[styles.chip, props.on ? styles.chipOn : null]}
    >
      <Text variant="secondary" weight="600" tone={props.on ? 'onAccent' : 'ink'}>
        {props.label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colours.bg },
  page: { padding: 20, gap: 10 },
  header: { gap: 12 },
  chips: { gap: 8, paddingVertical: 2 },
  chip: {
    minHeight: 44,
    paddingHorizontal: 14,
    justifyContent: 'center',
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colours.border,
    backgroundColor: colours.surface,
  },
  chipOn: { backgroundColor: colours.accent, borderColor: colours.accent },
});
