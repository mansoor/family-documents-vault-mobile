import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet } from 'react-native';
import { APP_VERSION } from '../config';
import { useCapture } from '../state/capture';
import { useVault } from '../state/vault';
import { forgetVault } from '../state/vaults';
import { Button, Card, Text } from '../ui';
import { ConfirmSheet } from '../ui/confirm';

/**
 * Which vault, and how it is reached (4.15): its address, whether it is
 * reached without encryption, the vault's and the app's versions (seven
 * taps on them open Timings), who is signed in, and Use another vault —
 * which signs out and takes everything of this vault off the phone, after
 * a question that says what is still waiting to go. On Account (P6), under
 * More; it was the first card of Settings.
 */
export function VaultCard() {
  const { t } = useTranslation();
  const router = useRouter();
  const { vault, caps, signOut, chooseAnotherVault } = useVault();
  const capture = useCapture();
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
  // Changing the vault: signed out, and everything of this one's goes —
  // the offline copies, the scans still waiting, the vault's own record.
  const changeVault = async () => {
    const origin = vault?.origin;
    setBusy(true);
    try {
      if (origin) await capture.forgetVault(origin);
      await signOut();
      await chooseAnotherVault();
      if (origin) forgetVault(origin);
    } finally {
      setBusy(false);
      setChanging(false);
    }
  };
  const plain = vault?.origin.startsWith('http://') ?? false;
  // Everybody's scans for this vault go with it, not only this person's.
  const here = [...capture.queue, ...capture.others];
  const hereOnItsWay = here.filter((i) => i.state === 'sending').length;
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
    <Card>
      <Text variant="title">{t('settings.vault')}</Text>
      <Text>{vault?.origin.replace(/^https?:\/\//, '') ?? ''}</Text>
      {plain ? (
        <Text tone="warn" variant="secondary" testID="account-not-secure">
          {t('settings.notSecure')}
        </Text>
      ) : null}
      <Pressable
        testID="account-version"
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
      <Button
        testID="account-change-vault"
        kind="quiet"
        label={t('settings.changeVault')}
        onPress={() => setChanging(true)}
      />
      <ConfirmSheet
        visible={changing}
        testID="change-vault-question"
        title={t('settings.changeVaultTitle')}
        words={t('settings.changeVaultWords')}
        confirmLabel={t('settings.changeVaultYes')}
        busy={busy}
        onConfirm={() => void changeVault()}
        onCancel={() => setChanging(false)}
        confirmID="change-vault-yes"
        cancelID="change-vault-cancel"
      >
        {here.length - hereOnItsWay > 0 ? (
          <Text tone="warn">{t('settings.changeVaultWaiting', { count: here.length - hereOnItsWay })}</Text>
        ) : null}
        {hereOnItsWay > 0 ? <Text tone="soft">{t('settings.onItsWay', { count: hereOnItsWay })}</Text> : null}
      </ConfirmSheet>
    </Card>
  );
}

const styles = StyleSheet.create({
  version: { minHeight: 44, justifyContent: 'center' },
});
