import { ARRANGE_BY_WORDS } from '@fdv/shared';
import { useRouter } from 'expo-router';
import { Archive } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { rowPlace } from '../documents/row';
import { useVault } from '../state/vault';
import { Button, Notice, Text } from '../ui';
import { sp } from '../ui/space';
import { LoadFailed, Placeholder } from '../ui/states';
import { arrangeUrl } from './model';
import { NodeRow } from './rows';
import { useCabinet } from './use-cabinet';

/**
 * Documents as the person files them (C5): their cabinets, each opening its
 * drawers, as the web's Cabinet beside its table. Only browsed here;
 * arranging is done on the web, one tap away.
 */
export function CabinetBrowse(props: { header: ReactNode }) {
  const { t } = useTranslation();
  const [refreshing, setRefreshing] = useState(false);
  const router = useRouter();
  const { offline, vault } = useVault();
  const { read, failed, load } = useCabinet();
  const cabinets = read?.arranged?.cabinets ?? [];
  const arrangedBy = read?.arranged?.by ?? null;

  return (
    <ScrollView
      testID="cabinet"
      contentContainerStyle={styles.page}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load().finally(() => setRefreshing(false));
          }}
        />
      }
    >
      {props.header}
      {offline && !read ? (
        <Notice tone="warn" testID="cabinet-offline">
          {t('cabinet.needsConnection')}
        </Notice>
      ) : null}
      {offline && read ? (
        <Text variant="secondary" tone="soft" testID="cabinet-showing-saved">
          {t('cabinet.showingLast')}
        </Text>
      ) : null}
      {failed ? <LoadFailed words={failed} onRetry={() => void load()} /> : null}
      {!read && !failed && !offline ? <Placeholder rows={3} testID="cabinet-loading" /> : null}
      {read && cabinets.length === 0 ? (
        <Text tone="soft" testID="cabinet-empty">
          {read.arranged ? t('cabinet.allHidden') : t('cabinet.empty')}
        </Text>
      ) : null}
      {arrangedBy && cabinets.length > 0 ? (
        <Text variant="secondary" tone="soft" testID="cabinet-arranged-by">
          {ARRANGE_BY_WORDS[arrangedBy].title.replace(/^By/, 'Arranged by')}
        </Text>
      ) : null}
      {cabinets.length > 0 ? (
        <View>
          {cabinets.map((c, i) => (
            <NodeRow
              key={c.id}
              testID={`cabinet-${c.id}`}
              icon={Archive}
              name={c.name}
              line={t('cabinet.drawers', { count: c.drawers.length })}
              place={rowPlace(i, cabinets.length)}
              onPress={() => router.push({ pathname: '/cabinet/[id]', params: { id: c.id } })}
            />
          ))}
        </View>
      ) : null}
      {vault && read ? (
        <Button
          kind="quiet"
          testID="cabinet-arrange"
          label={t('cabinet.arrangeOnWeb')}
          onPress={() => void Linking.openURL(arrangeUrl(vault.origin))}
        />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: sp(20), gap: sp(12) },
});
