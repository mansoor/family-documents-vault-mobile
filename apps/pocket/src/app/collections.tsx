import { radii, type CollectionView } from '@fdv/shared';
import { useRouter } from 'expo-router';
import { FolderOpen, Plus } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CollectionForm } from '../collections/collection-form';
import { audienceKey, collectionsOffered } from '../collections/rules';
import { emit, on } from '../state/events';
import { useVault } from '../state/vault';
import { Notice, Text } from '../ui';
import { IconButton } from '../ui/icon-button';
import { sp } from '../ui/space';
import { LoadFailed, loadFailure, Placeholder } from '../ui/states';
import { useColours, useStyles, type Palette } from '../ui/theme';

/**
 * Collections (P9): every collection the person may see, as the vault
 * lists them, each with how many of its documents they can see and who it
 * is for. One opens its page. The + beside the title makes one (the
 * owner's gaps review, then tidy-up, 11 Nov 2026: as Notes' +, and no >
 * on a row, whose name says there is more in it). Its checklist stays in
 * the browser.
 */
export default function CollectionsScreen() {
  const styles = useStyles(makeStyles);
  const { t } = useTranslation();
  const router = useRouter();
  const { withToken, offline, caps, who } = useVault();
  const [making, setMaking] = useState(false);
  const mayMake = collectionsOffered(caps, who?.role);
  const [items, setItems] = useState<CollectionView[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await withToken((a, tk) => a.collections(tk));
      setItems(r.items);
      setFailed(null);
    } catch (err) {
      // No connection: the banner says so, and what was last seen stays. Anything else, here.
      setFailed(loadFailure('collections', err, t));
    }
  }, [withToken, t]);

  useEffect(() => {
    // Loaded on arrival and when the connection returns; set once the vault answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, offline]);
  // Something put in or taken out on a collection's page, or from a row's ⋯.
  useEffect(() => on('collectionChanged', () => void load()), [load]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
    <FlatList
      testID="collections"
      style={styles.screen}
      contentContainerStyle={styles.page}
      data={items ?? []}
      keyExtractor={(c) => c.id}
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
          <View style={styles.titleRow}>
            <Text variant="hero" style={styles.flex}>
              {t('collections.title')}
            </Text>
            {mayMake && !offline ? (
              <IconButton
                testID="collections-new"
                label={t('collectionForm.new')}
                icon={Plus}
                filled
                onPress={() => setMaking(true)}
              />
            ) : null}
          </View>
          {offline && !items ? (
            <Notice tone="warn" testID="collections-offline">
              {t('collections.needsConnection')}
            </Notice>
          ) : null}
          {failed ? <LoadFailed words={failed} onRetry={() => void load()} /> : null}
          {making ? (
            <CollectionForm
              onClose={() => setMaking(false)}
              onSaved={(made) => {
                setMaking(false);
                emit('collectionChanged', made.id);
                router.push({ pathname: '/collection/[id]', params: { id: made.id } });
              }}
            />
          ) : null}
          {!items && !failed && !offline ? <Placeholder rows={3} /> : null}
          {items && items.length === 0 ? (
            <Text tone="soft" testID="collections-none">
              {t('collections.none')}
            </Text>
          ) : null}
        </View>
      }
      renderItem={({ item }) => (
        <CollectionRow
          collection={item}
          onPress={() => router.push({ pathname: '/collection/[id]', params: { id: item.id } })}
        />
      )}
    />
    </SafeAreaView>
  );
}

function CollectionRow(props: { collection: CollectionView; onPress: () => void }) {
  const styles = useStyles(makeStyles);
  const colours = useColours();
  const { t } = useTranslation();
  const c = props.collection;
  const line = [
    t('collections.documents', { count: c.item_count }),
    t(audienceKey(c.audience)),
    ...(c.mine ? [t('collections.yours')] : []),
  ].join(' · ');
  const shared = c.shared_outside ? t('collections.sharedOutside') : null;
  return (
    <Pressable
      testID={`collection-${c.id}`}
      accessibilityRole="button"
      accessibilityLabel={[c.name, line, shared].filter(Boolean).join('. ')}
      onPress={props.onPress}
      style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
    >
      <View style={styles.icon}>
        <FolderOpen color={colours.accent} size={22} accessibilityElementsHidden importantForAccessibility="no" />
      </View>
      <View style={styles.words}>
        <Text weight="600">{c.name}</Text>
        <Text variant="secondary" tone="soft">
          {line}
        </Text>
        {shared ? (
          <Text variant="secondary" tone="warn">
            {shared}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colours.bg },
    screen: { backgroundColor: colours.bg },
    page: { padding: sp(20), gap: sp(10) },
    header: { gap: sp(12) },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: sp(8) },
    flex: { flex: 1 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: sp(12),
      padding: sp(12),
      minHeight: 56,
      backgroundColor: colours.surface,
      borderRadius: radii.l,
      borderWidth: 1,
      borderColor: colours.border,
    },
    pressed: { opacity: 0.8 },
    icon: {
      width: 40,
      height: 40,
      borderRadius: radii.pill,
      backgroundColor: colours.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    words: { flex: 1, gap: sp(4) },
  });
