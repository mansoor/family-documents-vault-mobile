import { radii } from '@fdv/shared';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { APP_VERSION, SPIKE } from '../config';
import { NotificationsCard } from '../push/card';
import { TextNotificationsCard } from '../push/texts-card';
import { OfflineCopies } from '../settings/offline';
import { useCapture } from '../state/capture';
import { useLock, type LockTimeout } from '../state/lock';
import { useVault } from '../state/vault';
import { Button, Card, Notice, Text } from '../ui';
import { useTextScale } from '../ui/text-scale';
import { ConfirmSheet } from '../ui/confirm';
import { Sheet } from '../ui/sheet';
import { sp } from '../ui/space';
import { useStyles, useTheme, type Palette } from '../ui/theme';
import { Chip, ChipRow } from '../ui/chip';

/**
 * Settings (4.15; only settings since P6): Large text, light or dark, the
 * lock, the offline copies, notifications, About, and the browser for
 * everything else; and Sign out. Which vault, who is signed in and on which
 * devices are on Account, under More.
 */
export default function Settings() {
  const styles = useStyles(makeStyles);
  const { t } = useTranslation();
  const router = useRouter();
  const { vault, caps, signOut } = useVault();
  const { large, setLarge } = useTextScale();
  const theme = useTheme();
  const lock = useLock();
  const timeouts: [LockTimeout, string][] = [
    ['immediately', t('settings.lockImmediately')],
    ['1m', t('settings.lockOneMinute')],
    ['5m', t('settings.lockFiveMinutes')],
  ];
  const capture = useCapture();
  const insets = useSafeAreaInsets();
  const [asking, setAsking] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);
  // Signing out with scans still on their way: keep them for next time, or not.
  const leave = () => {
    if (capture.queue.length > 0) setAsking(true);
    else setConfirmOut(true);
  };
  // One already on its way cannot be called back: it is left to arrive.
  const sending = capture.queue.filter((i) => i.state === 'sending').length;
  const leaveAnyway = async (remove: boolean) => {
    setAsking(false);
    if (remove) await capture.removeMany(capture.queue.filter((i) => i.state !== 'sending').map((i) => i.id));
    await signOut();
  };
  const version = t('settings.version', { server: caps?.server_version ?? '…', app: APP_VERSION });

  return (
    // Below the last card, room for the gesture bar: at the largest text
    // "Sign out" sat partly under it, even scrolled to the end (0.2.0).
    <ScrollView contentContainerStyle={[styles.page, { paddingBottom: 20 + insets.bottom }]}>
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
        <Text weight="600">{t('settings.theme')}</Text>
        <Text tone="soft" variant="secondary">
          {t('settings.themeHint')}
        </Text>
        <ChipRow label={t('settings.theme')}>
          {(['auto', 'light', 'dark'] as const).map((c) => (
            <Chip
              key={c}
              testID={`settings-theme-${c}`}
              label={t(`settings.theme_${c}`)}
              selected={theme.choice === c}
              onPress={() => theme.choose(c)}
            />
          ))}
        </ChipRow>
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
      <TextNotificationsCard />
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
      <ConfirmSheet
        visible={confirmOut}
        testID="sign-out-confirm"
        title={t('settings.signOutTitle')}
        words={t('settings.signOutWords')}
        confirmLabel={t('settings.signOut')}
        onConfirm={() => {
          setConfirmOut(false);
          void signOut();
        }}
        onCancel={() => setConfirmOut(false)}
        confirmID="sign-out-yes"
        cancelID="sign-out-no"
      />
      <Sheet visible={asking} onClose={() => setAsking(false)} testID="sign-out-question">
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
      </Sheet>
    </ScrollView>
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    page: { padding: sp(20), gap: sp(16) },
    row: { flexDirection: 'row', alignItems: 'center', gap: sp(12) },
    version: { minHeight: 44, justifyContent: 'center' },
    flex: { flex: 1 },
    choices: { gap: sp(4) },
    choice: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: sp(12) },
    dot: { width: 20, height: 20, borderRadius: radii.pill, borderWidth: 2, borderColor: colours.borderInput },
    dotOn: { borderWidth: 6, borderColor: colours.accent },
  });
