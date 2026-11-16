import { useLocalSearchParams, useRouter } from 'expo-router';
import { Folder, Layers } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { rowPlace } from '../documents/row';
import { useVault } from '../state/vault';
import { Notice, Text } from '../ui';
import { sp } from '../ui/space';
import { LoadFailed, Placeholder } from '../ui/states';
import { useStyles, type Palette } from '../ui/theme';
import { findNode } from './model';
import { NodeRow } from './rows';
import { useCabinet } from './use-cabinet';

/**
 * One level of the cabinet (C5): a cabinet's drawers, or a drawer's
 * folders, each opening the next level down; Back goes up. A folder says
 * how many documents it holds for the person, as the web counts them.
 */
export function CabinetLevel(props: { level: 'cabinet' | 'drawer' }) {
  const styles = useStyles(makeStyles);
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { offline } = useVault();
  const { gate, read, failed, load } = useCabinet();
  const [refreshing, setRefreshing] = useState(false);
  const found = read?.arranged ? findNode(read.arranged.cabinets, id) : null;
  const here = found?.kind === props.level ? found : null;

  const body = () => {
    if (!gate.on) return <Notice tone="warn">{t('cabinet.noCabinet')}</Notice>;
    if (!read) {
      if (failed) return <LoadFailed words={failed} onRetry={() => void load()} />;
      if (offline)
        return (
          <Notice tone="warn" testID="cabinet-offline">
            {t('cabinet.needsConnection')}
          </Notice>
        );
      return <Placeholder rows={3} testID="cabinet-loading" />;
    }
    if (!here) {
      return (
        <Notice tone="warn" testID="cabinet-gone">
          {t('cabinet.gone')}
        </Notice>
      );
    }
    if (here.kind === 'cabinet') {
      const drawers = here.cabinet.drawers;
      return (
        <>
          <Text variant="hero" role="header">{here.cabinet.name}</Text>
          {failed ? <LoadFailed words={failed} onRetry={() => void load()} /> : null}
          {drawers.length === 0 ? (
            <Text tone="soft" testID="cabinet-no-drawers">
              {t('cabinet.noDrawers')}
            </Text>
          ) : (
            <View>
              {drawers.map((d, i) => (
                <NodeRow
                  key={d.id}
                  testID={`drawer-${d.id}`}
                  icon={Layers}
                  name={d.name}
                  line={t('cabinet.folders', { count: d.folders.length })}
                  place={rowPlace(i, drawers.length)}
                  onPress={() => router.push({ pathname: '/drawer/[id]', params: { id: d.id } })}
                />
              ))}
            </View>
          )}
        </>
      );
    }
    if (here.kind !== 'drawer') return null;
    const folders = here.drawer.folders;
    return (
      <>
        <Text variant="secondary" tone="soft" testID="drawer-path">
          {here.cabinet.name}
        </Text>
        <Text variant="hero" role="header">{here.drawer.name}</Text>
        {failed ? <LoadFailed words={failed} onRetry={() => void load()} /> : null}
        {folders.length === 0 ? (
          <Text tone="soft" testID="drawer-no-folders">
            {t('cabinet.noFolders')}
          </Text>
        ) : (
          <View>
            {folders.map((f, i) => {
              const count = read.counts[f.id];
              return (
                <NodeRow
                  key={f.id}
                  testID={`folder-${f.id}`}
                  icon={Folder}
                  name={f.name}
                  line={typeof count === 'number' ? t('glance.documentsCount', { count }) : null}
                  place={rowPlace(i, folders.length)}
                  onPress={() => router.push({ pathname: '/folder/[id]', params: { id: f.id } })}
                />
              );
            })}
          </View>
        )}
      </>
    );
  };

  return (
    <ScrollView
      testID={props.level === 'cabinet' ? 'cabinet-screen' : 'drawer-screen'}
      style={styles.screen}
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
      {body()}
    </ScrollView>
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    screen: { backgroundColor: colours.bg },
    page: { padding: sp(20), gap: sp(12) },
  });
