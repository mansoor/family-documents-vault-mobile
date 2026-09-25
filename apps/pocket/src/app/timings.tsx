import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { exportRuns, loadRuns, split, type TimingRun } from '../capture/timings';
import { Button, Card, Text } from '../ui';

const seconds = (ms: number) => (ms / 1000).toFixed(1);

/**
 * The last twenty captures, stage by stage — the numbers the 20-second
 * promise is judged by. In every build, release included, behind seven
 * taps on the version in Settings. Shared only through the share sheet,
 * and then without anything that could tie a run to a document.
 */
export default function Timings() {
  const { t } = useTranslation();
  const [runs] = useState<TimingRun[]>(() => loadRuns().slice().reverse());

  const share = async () => {
    const out = new File(Paths.cache, 'fv-timings.json');
    if (out.exists) out.delete();
    out.create();
    out.write(exportRuns(runs));
    await Sharing.shareAsync(out.uri, { mimeType: 'application/json' });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.page}>
        <Text tone="soft">{runs.length ? t('timings.lead', { count: runs.length }) : t('timings.none')}</Text>
        {runs.map((run) => {
          const save = run.marks.save;
          return (
            <Card key={run.at} style={styles.run}>
              <Text weight="600">
                {t('timings.run', {
                  kind: run.kind,
                  pages: run.pages,
                  at: run.at.slice(0, 16).replace('T', ' '),
                })}
              </Text>
              {save !== undefined ? (
                <Text tone="accent" weight="600">
                  {t('timings.total', { seconds: seconds(save) })}
                </Text>
              ) : null}
              {split(run).map((s) => (
                <View key={`${s.from}-${s.to}`} style={styles.row}>
                  <Text variant="secondary" style={styles.flex}>
                    {`${t(`timings.stage_${s.from}`)} → ${t(`timings.stage_${s.to}`)}`}
                  </Text>
                  <Text variant="secondary" weight="600">{`${seconds(s.ms)} s`}</Text>
                </View>
              ))}
            </Card>
          );
        })}
        {runs.length && Platform.OS !== 'web' ? (
          <Button kind="quiet" label={t('timings.share')} onPress={() => void share()} />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  page: { padding: 20, gap: 12 },
  run: { gap: 4 },
  row: { flexDirection: 'row', gap: 8 },
  flex: { flex: 1 },
});
