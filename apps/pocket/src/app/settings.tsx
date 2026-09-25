import { colours, radii } from '@fdv/shared';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { APP_VERSION, SPIKE } from '../config';
import { useCapture } from '../state/capture';
import { useVault } from '../state/vault';
import { Button, Card, Text } from '../ui';
import { useTextScale } from '../ui/text-scale';

/** Settings, for now: which vault, who is signed in, Large text, sign out. */
export default function Settings() {
  const { t } = useTranslation();
  const router = useRouter();
  const { vault, caps, signOut } = useVault();
  const { large, setLarge } = useTextScale();
  const capture = useCapture();
  const insets = useSafeAreaInsets();
  const [asking, setAsking] = useState(false);
  // Signing out with scans still on their way: keep them for next time, or not.
  const leave = () => {
    if (capture.queue.length > 0) setAsking(true);
    else void signOut();
  };
  // One already on its way cannot be called back: it is left to arrive.
  const sending = capture.queue.filter((i) => i.state === 'sending').length;
  const leaveAnyway = async (remove: boolean) => {
    setAsking(false);
    if (remove) await capture.removeMany(capture.queue.filter((i) => i.state !== 'sending').map((i) => i.id));
    await signOut();
  };
  // Seven taps on the version, a second or less apart, open Timings.
  const taps = useRef<{ n: number; at: number }>({ n: 0, at: 0 });
  const tapVersion = () => {
    const now = Date.now();
    taps.current = { n: now - taps.current.at < 1000 ? taps.current.n + 1 : 1, at: now };
    if (taps.current.n >= 7) {
      taps.current = { n: 0, at: 0 };
      router.push('/timings');
    }
  };
  const version = t('settings.version', { server: caps?.server_version ?? '…', app: APP_VERSION });

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Card>
        <Text variant="title">{t('settings.vault')}</Text>
        <Text>{vault?.origin.replace(/^https?:\/\//, '') ?? ''}</Text>
        <Pressable
          testID="settings-version"
          accessibilityRole="text"
          accessibilityLabel={version}
          onPress={tapVersion}
          style={styles.version}
        >
          <Text tone="soft" variant="secondary">
            {version}
          </Text>
        </Pressable>
        {vault?.email ? <Text tone="soft">{t('settings.signedInAs', { email: vault.email })}</Text> : null}
      </Card>
      <Card>
        <View style={styles.row}>
          <View style={styles.flex}>
            <Text weight="600">{t('settings.largeText')}</Text>
            <Text tone="soft" variant="secondary">
              {t('settings.largeTextHint')}
            </Text>
          </View>
          <Switch
            testID="settings-large-text"
            accessibilityLabel={t('settings.largeText')}
            value={large}
            onValueChange={setLarge}
          />
        </View>
      </Card>
      <Button testID="settings-sign-out" kind="quiet" label={t('settings.signOut')} onPress={leave} />
      {SPIKE ? <Button kind="quiet" label={t('settings.spike')} onPress={() => router.push('/spike')} /> : null}
      <Modal visible={asking} transparent animationType="fade" onRequestClose={() => setAsking(false)}>
        <View style={styles.scrim}>
          <View style={[styles.sheet, { paddingBottom: 20 + insets.bottom }]} accessibilityViewIsModal testID="sign-out-question">
            <Text variant="screen">{t('settings.waiting', { count: capture.queue.length })}</Text>
            {sending > 0 ? <Text tone="soft">{t('settings.onItsWay', { count: sending })}</Text> : null}
            <Button label={t('settings.keepThem')} onPress={() => void leaveAnyway(false)} testID="sign-out-keep" />
            <Button label={t('settings.removeThem')} kind="danger" onPress={() => void leaveAnyway(true)} testID="sign-out-remove" />
            <Button label={t('common.cancel')} kind="quiet" onPress={() => setAsking(false)} testID="sign-out-cancel" />
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(28,26,23,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colours.bg, padding: 20, gap: 12, borderTopLeftRadius: radii.l, borderTopRightRadius: radii.l },
  page: { padding: 20, gap: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  version: { minHeight: 44, justifyContent: 'center' },
  flex: { flex: 1 },
});
