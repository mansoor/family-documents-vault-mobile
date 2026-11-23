import { inSeveralWords, levelsWords, unfiledWords } from '@fdv/shared';
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
import { arrangeUrl, cabinetMark } from './model';
import { NodeRow } from './rows';
import { useCabinet } from './use-cabinet';

/**
 * Documents as the person files them (C5): their cabinets, each opening its
 * drawers, as the web's Cabinet beside its table. Only browsed here;
 * arranging is done on the web, one tap away.
 *
 * What it holds in all, each paper once (a vault that counts it): the
 * total, and — when some are in no folder or in more than one — how many,
 * the first opening those papers, the second saying why the folders add up
 * to more than the total.
 *
 * A vault with levels (dev.90) says what the cabinet is arranged by ("Topic
 * › Year › Person", or by hand), and marks a cabinet with its own
 * arrangement, or one arranged by hand beside the drawn ones; a cabinet of
 * one drawer says how many folders it opens on, its drawer passed over.
 */
export function CabinetBrowse(props: { header: ReactNode }) {
  const { t } = useTranslation();
  const [refreshing, setRefreshing] = useState(false);
  const router = useRouter();
  const { offline, vault } = useVault();
  const { gate, read, failed, load } = useCabinet();
  const cabinets = read?.arranged?.cabinets ?? [];
  const arrangedBy = read?.arranged?.by ?? null;
  const whole = read?.arranged ? read.documents : undefined;
  const unfiled = read?.arranged ? (read.unfiled ?? 0) : 0;
  const inSeveral = read?.arranged ? (read.inSeveral ?? 0) : 0;
  const arrangedWords =
    arrangedBy === 'hand'
      ? t('cabinet.arrangedByHand')
      : arrangedBy === 'web'
        ? t('cabinet.arrangedOnWeb')
        : arrangedBy
        ? t('cabinet.arrangedBy', { levels: levelsWords(arrangedBy) })
        : null;
  /** A cabinet's line: its drawers, or — one drawer passed over — its folders; and how it is arranged, where its own. */
  const lineOf = (c: (typeof cabinets)[number]) => {
    const only = gate.levels && c.drawers.length === 1 ? c.drawers[0] : undefined;
    const mark = cabinetMark(c, arrangedBy, gate);
    return [
      only ? t('cabinet.folders', { count: only.folders.length }) : t('cabinet.drawers', { count: c.drawers.length }),
      mark === 'own' ? t('cabinet.ownArrangement') : mark === 'hand' ? t('cabinet.arrangedByHand') : null,
    ]
      .filter(Boolean)
      .join(' · ');
  };

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
      {cabinets.length > 0 && (arrangedWords || typeof whole === 'number') ? (
        <Text variant="secondary" tone="soft" testID="cabinet-arranged-by">
          {[typeof whole === 'number' ? t('glance.documentsCount', { count: whole }) : null, arrangedWords]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      ) : null}
      {cabinets.length > 0 && unfiled > 0 ? (
        <Button
          kind="quiet"
          testID="cabinet-unfiled"
          label={unfiledWords(unfiled) ?? ''}
          hint={t('cabinet.unfiledHint')}
          onPress={() => router.push('/unfiled')}
        />
      ) : null}
      {cabinets.length > 0 && inSeveral > 0 ? (
        <Text variant="secondary" tone="soft" testID="cabinet-in-several">
          {typeof whole === 'number'
            ? t('cabinet.inSeveral', {
                words: inSeveralWords(inSeveral) ?? '',
                total: t('glance.documentsCount', { count: whole }),
              })
            : `${inSeveralWords(inSeveral) ?? ''}.`}
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
              line={lineOf(c)}
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
