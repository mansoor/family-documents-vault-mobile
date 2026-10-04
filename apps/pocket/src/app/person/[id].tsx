import { colours, type DocumentView } from '@fdv/shared';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, RefreshControl, StyleSheet } from 'react-native';
import { DocumentRow } from '../../documents/row';
import { IdentityCard } from '../../identity/card';
import { useVault } from '../../state/vault';
import { Notice, Text } from '../../ui';

/** One person's documents (4.12), from People; and their identity details, where the vault keeps them (5.31). */
export default function PersonScreen() {
  const params = useLocalSearchParams<{ id: string; name?: string }>();
  const { id } = params;
  const { t } = useTranslation();
  const { withToken, offline } = useVault();
  const [docs, setDocs] = useState<DocumentView[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Opened without a name (Home's "Look at yours"): the vault's.
  const [found, setFound] = useState<string | null>(null);
  const name = params.name ?? found ?? undefined;

  const load = useCallback(async () => {
    try {
      setDocs((await withToken((a, token) => a.documents(token, { member_id: id, limit: 200 }))).items);
      if (params.name === undefined) {
        const people = (await withToken((a, token) => a.members(token))).items;
        setFound(people.find((m) => m.id === id)?.display_name ?? null);
      }
    } catch {
      // Offline: the banner says so.
    }
  }, [withToken, id, params.name]);

  useEffect(() => {
    // Loaded on arrival; the state is set after the request answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // Again when the connection returns.
  }, [load, offline]);

  return (
    <FlatList
      testID="person"
      style={styles.safe}
      contentContainerStyle={styles.page}
      data={docs ?? []}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load().finally(() => setRefreshing(false));
          }}
        />
      }
      keyExtractor={(d) => d.id}
      ListHeaderComponent={
        <>
          <Text variant="hero">{name ?? ''}</Text>
          {id ? <IdentityCard memberId={id} name={name ?? ''} /> : null}
          {offline && !docs ? <Notice tone="warn">{t('people.needsConnection')}</Notice> : null}
          {docs && docs.length === 0 ? <Text tone="soft">{t('people.none', { name: name ?? '' })}</Text> : null}
        </>
      }
      renderItem={({ item }) => <DocumentRow id={item.id} title={item.title} status={item.status} />}
    />
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colours.bg },
  page: { padding: 20, gap: 10 },
});
