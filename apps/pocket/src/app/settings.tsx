import { colours, radii } from '@fdv/shared';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { APP_VERSION, SPIKE } from '../config';
import { NotificationsCard } from '../push/card';
import { SignedInDevices } from '../settings/devices';
import { OfflineCopies } from '../settings/offline';
import { useCapture } from '../state/capture';
import { useLock, type LockTimeout } from '../state/lock';
import { useVault } from '../state/vault';
import { forgetVault } from '../state/vaults';
import { Button, Card, Notice, Text } from '../ui';
import { useTextScale } from '../ui/text-scale';

/**
 * Settings, in full (4.15): which vault (and whether it is reached without
 * encryption), changing it, who is signed in and on which devices, the
 * lock, the offline copies, notifications, Large text, About — and the
 * browser for everything else.
 */
export default function Settings() {
  const { t } = useTranslation();
  const router = useRouter();
  const { vault, caps, signOut, chooseAnotherVault } = useVault();
  const { large, setLarge } = useTextScale();
  const lock = useLock();
  const timeouts: [LockTimeout, string][] = [
    ['immediately', t('settings.lockImmediately')],
    ['1m', t('settings.lockOneMinute')],
    ['5m', t('settings.lockFiveMinutes')],
  ];
  const capture = useCapture();
  const insets = useSafeAreaInsets();
  const [asking, setAsking] = useState(false);
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
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
    <ScrollView contentContainerStyle={styles.page}>
      <Card>
        <Text variant="title">{t('settings.vault')}</Text>
        <Text>{vault?.origin.replace(/^https?:\/\//, '') ?? ''}</Text>
        {plain ? (
          <Text tone="warn" variant="secondary" testID="settings-not-secure">
            {t('settings.notSecure')}
          </Text>
        ) : null}
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
        <Button
          testID="settings-change-vault"
          kind="quiet"
          label={t('settings.changeVault')}
          onPress={() => setChanging(true)}
        />
      </Card>
      <SignedInDevices />
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
      <Card>
        <Text variant="title">{t('settings.lock')}</Text>
        {lock.status === 'none' ? (
          <Notice testID="settings-no-screen-lock">{t('lock.noScreenLock')}</Notice>
        ) : (
          <View accessibilityRole="radiogroup" accessibilityLabel={t('settings.lockAfter')} style={styles.choices}>
            <Text weight="600">{t('settings.lockAfter')}</Text>
            {timeouts.map(([value, label]) => (
              <Pressable
                key={value}
                testID={`settings-lock-${value}`}
                accessibilityRole="radio"
                accessibilityLabel={label}
                accessibilityState={{ checked: lock.timeout === value }}
                onPress={() => lock.setTimeout(value)}
                style={styles.choice}
              >
                <View style={[styles.dot, lock.timeout === value ? styles.dotOn : null]} />
                <Text>{label}</Text>
              </Pressable>
            ))}
          </View>
        )}
        {lock.level === 'secret' || lock.level === 'weak' ? (
          <Text tone="soft" variant="secondary" testID="settings-weak-biometrics">
            {t('lock.weakBiometrics')}
          </Text>
        ) : null}
        <View style={styles.row}>
          <View style={styles.flex}>
            <Text weight="600">{t('settings.screenshots')}</Text>
            <Text tone="soft" variant="secondary">
              {t('settings.screenshotsHint')}
            </Text>
          </View>
          <Switch
            testID="settings-screenshots"
            accessibilityLabel={t('settings.screenshots')}
            value={lock.screenshots}
            onValueChange={lock.setScreenshots}
          />
        </View>
      </Card>
      <OfflineCopies />
      <NotificationsCard />
      <Card>
        <Text variant="title">{t('settings.about')}</Text>
        <Text tone="soft">{version}</Text>
        <Button
          testID="settings-licences"
          kind="quiet"
          label={t('settings.licences')}
          onPress={() => router.push('/licences')}
        />
        {vault ? (
          <Button
            testID="settings-in-browser"
            kind="quiet"
            label={t('settings.moreInBrowser')}
            onPress={() => void Linking.openURL(vault.origin)}
          />
        ) : null}
      </Card>
      <Button testID="settings-sign-out" kind="quiet" label={t('settings.signOut')} onPress={leave} />
      {SPIKE ? <Button kind="quiet" label={t('settings.spike')} onPress={() => router.push('/spike')} /> : null}
      <Modal visible={changing} transparent animationType="fade" onRequestClose={() => setChanging(false)}>
        <View style={styles.scrim}>
          <View
            style={[styles.sheet, { paddingBottom: 20 + insets.bottom }]}
            accessibilityViewIsModal
            testID="change-vault-question"
          >
            <Text variant="screen">{t('settings.changeVaultTitle')}</Text>
            <Text>{t('settings.changeVaultWords')}</Text>
            {here.length - hereOnItsWay > 0 ? (
              <Text tone="warn">{t('settings.changeVaultWaiting', { count: here.length - hereOnItsWay })}</Text>
            ) : null}
            {hereOnItsWay > 0 ? <Text tone="soft">{t('settings.onItsWay', { count: hereOnItsWay })}</Text> : null}
            <Button
              testID="change-vault-yes"
              kind="danger"
              label={t('settings.changeVaultYes')}
              busy={busy}
              onPress={() => void changeVault()}
            />
            <Button kind="quiet" label={t('common.cancel')} onPress={() => setChanging(false)} />
          </View>
        </View>
      </Modal>
      <Modal visible={asking} transparent animationType="fade" onRequestClose={() => setAsking(false)}>
        <View style={styles.scrim}>
          <View
            style={[styles.sheet, { paddingBottom: 20 + insets.bottom }]}
            accessibilityViewIsModal
            testID="sign-out-question"
          >
            <Text variant="screen">{t('settings.waiting', { count: capture.queue.length })}</Text>
            {sending > 0 ? <Text tone="soft">{t('settings.onItsWay', { count: sending })}</Text> : null}
            <Button label={t('settings.keepThem')} onPress={() => void leaveAnyway(false)} testID="sign-out-keep" />
            <Button
              label={t('settings.removeThem')}
              kind="danger"
              onPress={() => void leaveAnyway(true)}
              testID="sign-out-remove"
            />
            <Button label={t('common.cancel')} kind="quiet" onPress={() => setAsking(false)} testID="sign-out-cancel" />
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(28,26,23,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colours.bg,
    padding: 20,
    gap: 12,
    borderTopLeftRadius: radii.l,
    borderTopRightRadius: radii.l,
  },
  page: { padding: 20, gap: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  version: { minHeight: 44, justifyContent: 'center' },
  flex: { flex: 1 },
  choices: { gap: 4 },
  choice: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12 },
  dot: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colours.borderInput },
  dotOn: { borderWidth: 6, borderColor: colours.accent },
});
