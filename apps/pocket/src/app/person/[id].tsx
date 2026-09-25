import { colours, type DocumentView } from '@fdv/shared';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, StyleSheet } from 'react-native';
import { DocumentRow } from '../../documents/row';
import { useVault } from '../../state/vault';
import { Notice, Text } from '../../ui';

/** One person's documents (4.12), from People. */
export default function PersonScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const { t } = useTranslation();
  const { withToken, offline } = useVault();
  const [docs, setDocs] = useState<DocumentView[] | null>(null);

  const load = useCallback(async () => {
    try {
      setDocs((await withToken((a, token) => a.documents(token, { member_id: id, limit: 200 }))).items);
    } catch {
      // Offline: the banner says so.
    }
  }, [withToken, id]);

  useEffect(() => {
    // Loaded on arrival; the state is set after the request answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return (
    <FlatList
      testID="person"
      style={styles.safe}
      contentContainerStyle={styles.page}
      data={docs ?? []}
      keyExtractor={(d) => d.id}
      ListHeaderComponent={
        <>
          <Text variant="hero">{name ?? ''}</Text>
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
