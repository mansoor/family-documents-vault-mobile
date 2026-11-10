import { type DocumentView } from '@fdv/shared';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { DocumentRow, rowPlace } from '../../documents/row';
import { IdentityCard } from '../../identity/card';
import { useVault } from '../../state/vault';
import { Notice, Text } from '../../ui';
import { sp } from '../../ui/space';
import { useStyles, type Palette } from '../../ui/theme';
import { LoadFailed, loadFailure, Placeholder } from '../../ui/states';

/** One person's documents (4.12), from People; and their identity details, where the vault keeps them (5.31). */
export default function PersonScreen() {
  const styles = useStyles(makeStyles);
  const params = useLocalSearchParams<{ id: string; name?: string }>();
  const { id } = params;
  const { t } = useTranslation();
  const { withToken, offline, api } = useVault();
  const [docs, setDocs] = useState<DocumentView[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // The token the list was fetched with: its pictures are fetched with it too.
  const [token, setToken] = useState<string | null>(null);
  // Opened without a name (Home's "Look at yours"): the vault's.
  const [found, setFound] = useState<string | null>(null);
  const name = params.name ?? found ?? undefined;

  // A failure that is not the connection (P5): said, with Try again.
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const listed = await withToken((a, tk) => {
        setToken(tk);
        return a.documents(tk, { member_id: id, limit: 200 });
      });
      setDocs(listed.items);
      setFailed(null);
      if (params.name === undefined) {
        const people = (await withToken((a, token) => a.members(token))).items;
        setFound(people.find((m) => m.id === id)?.display_name ?? null);
      }
    } catch (err) {
      // Offline: the banner says so. Anything else, here.
      setFailed(loadFailure('person', err, t));
    }
  }, [withToken, id, params.name, t]);

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
        <View style={styles.header}>
          <Text variant="hero">{name ?? ''}</Text>
          {id ? <IdentityCard memberId={id} name={name ?? ''} /> : null}
          {offline && !docs ? <Notice tone="warn">{t('people.needsConnection')}</Notice> : null}
          {failed ? <LoadFailed words={failed} onRetry={() => void load()} /> : null}
          {!docs && !failed && !offline ? <Placeholder /> : null}
          {docs && docs.length === 0 ? <Text tone="soft">{t('people.none', { name: name ?? '' })}</Text> : null}
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
    />
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colours.bg },
    page: { padding: sp(20) },
    header: { gap: sp(10), marginBottom: sp(10) },
  });
