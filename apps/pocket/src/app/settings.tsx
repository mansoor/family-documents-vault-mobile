import { useRouter } from 'expo-router';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { APP_VERSION, SPIKE } from '../config';
import { useVault } from '../state/vault';
import { Button, Card, Text } from '../ui';
import { useTextScale } from '../ui/text-scale';

/** Settings, for now: which vault, who is signed in, Large text, sign out. */
export default function Settings() {
  const { t } = useTranslation();
  const router = useRouter();
  const { vault, caps, signOut } = useVault();
  const { large, setLarge } = useTextScale();
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
      <Button testID="settings-sign-out" kind="quiet" label={t('settings.signOut')} onPress={() => void signOut()} />
      {SPIKE ? <Button kind="quiet" label={t('settings.spike')} onPress={() => router.push('/spike')} /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, gap: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  version: { minHeight: 44, justifyContent: 'center' },
  flex: { flex: 1 },
});
