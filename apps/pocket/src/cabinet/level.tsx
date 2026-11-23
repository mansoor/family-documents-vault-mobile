import type { CabinetFolder } from '@fdv/shared';
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
import { cabinetMark, drawerRows, findNode } from './model';
import { NodeRow } from './rows';
import { useCabinet } from './use-cabinet';

/**
 * One level of the cabinet (C5): a cabinet's drawers, or a drawer's
 * folders, each opening the next level down; Back goes up. A folder says
 * how many documents it holds for the person, as the web counts them.
 *
 * With levels (a vault of 0.9.0-dev.90), a level with one group is passed
 * over while browsing, as the web does: a cabinet with one drawer shows that
 * drawer's folders at once, under "In the 2026 drawer."; a drawer with one
 * folder is one row, "2024 › Me", that opens the folder. So Back from the
 * folder comes straight back here, past the screen passed over; the
 * folder's path still names every level. A cabinet with its own
 * arrangement, or arranged by hand beside the drawn ones, says so.
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

  /** A folder, as a row with its count, opening it. */
  const folderRow = (f: CabinetFolder, i: number, n: number, over?: { name: string; spoken: string }) => {
    const count = read?.counts[f.id];
    return (
      <NodeRow
        key={f.id}
        testID={`folder-${f.id}`}
        icon={Folder}
        name={over?.name ?? f.name}
        {...(over ? { spoken: over.spoken } : {})}
        line={typeof count === 'number' ? t('glance.documentsCount', { count }) : null}
        place={rowPlace(i, n)}
        onPress={() => router.push({ pathname: '/folder/[id]', params: { id: f.id } })}
      />
    );
  };

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
      const shown = drawerRows(here.cabinet, gate);
      const mark = cabinetMark(here.cabinet, read.arranged?.by ?? null, gate);
      return (
        <>
          <Text variant="hero" role="header">{here.cabinet.name}</Text>
          {mark ? (
            <Text variant="secondary" tone="soft" testID="cabinet-mark">
              {mark === 'own' ? t('cabinet.ownArrangement') : t('cabinet.arrangedByHand')}
            </Text>
          ) : null}
          {failed ? <LoadFailed words={failed} onRetry={() => void load()} /> : null}
          {shown.kind === 'only' ? (
            // One drawer: passed over, its folders at once; its name said here and in the folder's path.
            <>
              <Text variant="secondary" tone="soft" testID="cabinet-only-drawer">
                {t('cabinet.inDrawer', { drawer: shown.drawer.name })}
              </Text>
              {shown.drawer.folders.length === 0 ? (
                <Text tone="soft" testID="drawer-no-folders">
                  {t('cabinet.noFolders')}
                </Text>
              ) : (
                <View>
                  {shown.drawer.folders.map((f, i) => folderRow(f, i, shown.drawer.folders.length))}
                </View>
              )}
            </>
          ) : shown.rows.length === 0 ? (
            <Text tone="soft" testID="cabinet-no-drawers">
              {t('cabinet.noDrawers')}
            </Text>
          ) : (
            <View>
              {shown.rows.map(({ drawer: d, folder }, i) =>
                folder ? (
                  // One folder: the drawer is one row, "2024 › Me", that opens it.
                  folderRow(folder, i, shown.rows.length, {
                    name: `${d.name} › ${folder.name}`,
                    spoken: t('cabinet.folderInDrawer', { folder: folder.name, drawer: d.name }),
                  })
                ) : (
                  <NodeRow
                    key={d.id}
                    testID={`drawer-${d.id}`}
                    icon={Layers}
                    name={d.name}
                    line={t('cabinet.folders', { count: d.folders.length })}
                    place={rowPlace(i, shown.rows.length)}
                    onPress={() => router.push({ pathname: '/drawer/[id]', params: { id: d.id } })}
                  />
                ),
              )}
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
          <View>{folders.map((f, i) => folderRow(f, i, folders.length))}</View>
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
