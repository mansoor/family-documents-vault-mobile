import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';
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

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Card>
        <Text variant="title">{t('settings.vault')}</Text>
        <Text>{vault?.origin.replace(/^https?:\/\//, '') ?? ''}</Text>
        <Text tone="soft" variant="secondary">
          {t('settings.version', { server: caps?.server_version ?? '…', app: APP_VERSION })}
        </Text>
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
  flex: { flex: 1 },
});
