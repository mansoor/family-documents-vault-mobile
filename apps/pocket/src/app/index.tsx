import { colours, radii, type DocumentView, type ReminderView } from '@fdv/shared';
import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { Settings as SettingsIcon } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useVault } from '../state/vault';
import { Card, Notice, StatusLine, Text } from '../ui';

interface HomeData {
  due: ReminderView[];
  recent: DocumentView[];
  token: string;
}

/**
 * Home: what needs attention, and what came in lately. It shows what it
 * last had when the vault cannot be reached, under a plain banner.
 */
export default function Home() {
  const { t } = useTranslation();
  const { caps, vault, offline, withToken, api } = useVault();
  const [data, setData] = useState<HomeData | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await withToken(async (a, token) => {
        const [due, recent] = await Promise.all([
          a.reminders(token, 'due'),
          a.documents(token, { limit: 20 }),
        ]);
        return { due: due.items, recent: recent.items, token };
      });
      setData(next);
    } catch {
      // Offline or signed out: the banner or the sign-in screen says so.
    }
  }, [withToken]);

  useEffect(() => {
    // Loading on arrival: the state is set after the requests answer, not
    // synchronously, which is what the rule is about.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const name = caps?.branding.display_name ?? vault?.displayName ?? '';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <FlatList
        testID="home-list"
        data={data?.recent ?? []}
        keyExtractor={(d) => d.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
        contentContainerStyle={styles.page}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <Text variant="hero" style={styles.flex}>
                {name}
              </Text>
              <Link href="/settings" asChild>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('home.settings')}
                  hitSlop={12}
                  style={styles.iconButton}
                >
                  <SettingsIcon color={colours.inkSoft} size={24} />
                </Pressable>
              </Link>
            </View>
            {offline ? (
              <Notice tone="warn" testID="home-offline">
                {t('home.offline')}
              </Notice>
            ) : null}
            <Text variant="screen">{t('home.attentionTitle')}</Text>
            {data && data.due.length === 0 ? (
              <Text tone="soft" testID="home-calm">
                {t('home.calm')}
              </Text>
            ) : null}
            {data?.due.map((r) => (
              <Card key={r.id} style={styles.dueCard}>
                <Text weight="600">{r.document_title ?? t('home.untitled')}</Text>
                <Text variant="secondary" tone="warn" weight="600">
                  {r.label}
                </Text>
              </Card>
            ))}
            <Text variant="screen" style={styles.recentTitle}>
              {t('home.recentTitle')}
            </Text>
            {data && data.recent.length === 0 ? <Text tone="soft">{t('home.none')}</Text> : null}
          </View>
        }
        renderItem={({ item }) => (
          <DocumentRow doc={item} token={data?.token ?? null} thumb={api && item.latest_version_id ? api.thumbnailUrl(item.latest_version_id) : null} />
        )}
      />
    </SafeAreaView>
  );
}

function DocumentRow(props: { doc: DocumentView; token: string | null; thumb: string | null }) {
  const { t } = useTranslation();
  const { doc } = props;
  return (
    <View style={styles.row} accessible accessibilityLabel={doc.title ?? t('home.needsAName')}>
      <View style={styles.thumb}>
        {props.thumb && props.token ? (
          <Image
            source={{ uri: props.thumb, headers: { authorization: `Bearer ${props.token}` } }}
            // Held in memory only: a document's picture never lands in the
            // phone's disk cache.
            cachePolicy="memory"
            style={styles.thumbImage}
            contentFit="cover"
            accessibilityIgnoresInvertColors
          />
        ) : null}
      </View>
      <View style={styles.flex}>
        <Text weight="600">{doc.title ?? t('home.needsAName')}</Text>
        <StatusLine status={doc.status} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colours.bg },
  page: { padding: 20, gap: 10 },
  header: { gap: 12, marginBottom: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1 },
  iconButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  dueCard: { gap: 4, borderColor: colours.warn },
  recentTitle: { marginTop: 12 },
  row: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    backgroundColor: colours.surface,
    borderRadius: radii.l,
    borderWidth: 1,
    borderColor: colours.border,
    padding: 10,
    minHeight: 72,
  },
  thumb: { width: 48, height: 64, borderRadius: radii.s, backgroundColor: colours.accentSoft, overflow: 'hidden' },
  thumbImage: { width: 48, height: 64 },
});
