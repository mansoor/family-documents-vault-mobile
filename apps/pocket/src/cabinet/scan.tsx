import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useIsFocused, useRouter } from 'expo-router';
import { X } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Linking, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLock } from '../state/lock';
import { useVault } from '../state/vault';
import { Button, Notice, Text } from '../ui';
import { IconButton } from '../ui/icon-button';
import { sp } from '../ui/space';
import { useColours, useStyles, type Palette } from '../ui/theme';
import { readLabel } from './model';
import { useCabinet } from './use-cabinet';

/**
 * Scan a folder label (C5; the vault prints them from C3): the camera,
 * looking for a QR code only. A label of this vault opens its folder in
 * place of this screen; another vault's label, or a code that is no label,
 * is said plainly, with Scan another. Nothing is asked of any address a
 * code holds: a label's folder is opened in this vault, or not at all.
 *
 * The camera is asked for here, the first time; turned off for the app, it
 * says where to turn it on again. It looks only while this screen is in
 * front and the app is open: the lock and the cover sit over the screens,
 * so behind them the camera is off, and a code seen then opens nothing.
 */
export function ScanLabel() {
  const styles = useStyles(makeStyles);
  const colours = useColours();
  const { t } = useTranslation();
  const router = useRouter();
  const lock = useLock();
  const focused = useIsFocused();
  // Looking only while the app is open and this screen is in front.
  const active = focused && (lock.status === 'unlocked' || lock.status === 'none') && !lock.covered;
  const { vault } = useVault();
  const { read } = useCabinet();
  const [permission, requestPermission] = useCameraPermissions();
  const [said, setSaid] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);
  // One code at a time: the camera reports the same code many times a second.
  const handled = useRef(false);

  const scanned = (r: BarcodeScanningResult) => {
    if (handled.current || !active) return;
    handled.current = true;
    const label = readLabel(r.data, vault?.origin ?? null, read?.arranged?.cabinets ?? null);
    if (label.kind === 'folder') {
      router.replace({
        pathname: '/folder/[id]',
        params: label.elsewhere ? { id: label.id, from: 'elsewhere' } : { id: label.id },
      });
      return;
    }
    setSaid(label.kind === 'other_vault' ? t('cabinet.otherVault', { host: label.host }) : t('cabinet.notALabel'));
  };

  const again = () => {
    setSaid(null);
    handled.current = false;
  };

  const body = () => {
    if (broken) {
      return (
        <Notice tone="warn" testID="scan-no-camera">
          {t('cabinet.noCamera')}
        </Notice>
      );
    }
    if (!permission) return <ActivityIndicator color={colours.accent} accessibilityLabel={t('common.loading')} />;
    if (!permission.granted) {
      if (permission.canAskAgain) {
        return (
          <View style={styles.ask}>
            <Text testID="scan-camera-ask">{t('cabinet.cameraAsk')}</Text>
            <Button
              testID="scan-camera-allow"
              label={t('cabinet.cameraAllow')}
              onPress={() => void lock.away(() => requestPermission())}
            />
          </View>
        );
      }
      return (
        <View style={styles.ask}>
          <Notice tone="warn" testID="scan-camera-off">
            {t('cabinet.cameraOff')}
          </Notice>
          {Platform.OS === 'web' ? null : (
            <Button kind="quiet" label={t('push.openSettings')} onPress={() => void Linking.openSettings()} />
          )}
        </View>
      );
    }
    return (
      <View style={styles.camera}>
        <View style={styles.frame}>
          <CameraView
            testID="scan-camera"
            style={styles.fill}
            facing="back"
            active={active}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            // Stopped while what was scanned is said: Scan another starts it again.
            {...(said || !active ? {} : { onBarcodeScanned: scanned })}
            onMountError={() => setBroken(true)}
            accessibilityLabel={t('cabinet.cameraLabel')}
          />
        </View>
        {said ? (
          <View style={styles.said}>
            <Notice tone="warn" testID="scan-said">
              {said}
            </Notice>
            <Button testID="scan-again" kind="quiet" label={t('cabinet.scanAgain')} onPress={again} />
          </View>
        ) : (
          <Text tone="soft" testID="scan-hint">
            {t('cabinet.scanHint')}
          </Text>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.screen} testID="scan-label">
      <View style={styles.titleRow}>
        <Text variant="hero" role="header" style={styles.flex}>
          {t('cabinet.scan')}
        </Text>
        <IconButton testID="scan-close" label={t('cabinet.scanClose')} icon={X} onPress={() => router.back()} />
      </View>
      {body()}
    </SafeAreaView>
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colours.bg, padding: sp(20), gap: sp(16) },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: sp(8) },
    flex: { flex: 1 },
    ask: { gap: sp(12) },
    camera: { gap: sp(12) },
    // A square to aim the label's code into.
    frame: {
      width: '100%',
      aspectRatio: 1,
      borderRadius: 16,
      overflow: 'hidden',
      borderWidth: 2,
      borderColor: colours.accent,
      backgroundColor: colours.ink,
    },
    fill: { flex: 1 },
    said: { gap: sp(8) },
  });
