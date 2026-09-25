import { colours } from '@fdv/shared';
import { useRouter } from 'expo-router';
import { Camera } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { useCapture } from '../state/capture';
import { Button, Notice, Text } from '../ui';

/**
 * Starting a capture — the scanner, a file or a photo — and, when it
 * leads to the card, going there. The scanner failing to open is said
 * where it was asked for.
 */
export function useBeginCapture() {
  const capture = useCapture();
  const router = useRouter();
  const [scannerFailed, setScannerFailed] = useState(false);
  const begin = useCallback(
    async (how: 'scan' | 'file' | 'photo') => {
      setScannerFailed(false);
      const outcome = await capture.start(how);
      if (outcome === 'card') {
        setScannerFailed(false);
        router.push('/capture');
      } else if (outcome === 'failed' && how === 'scan') {
        setScannerFailed(true);
      }
    },
    [capture, router],
  );
  // Said for a while, not for ever.
  useEffect(() => {
    if (!scannerFailed) return;
    const timer = setTimeout(() => setScannerFailed(false), 10_000);
    return () => clearTimeout(timer);
  }, [scannerFailed]);
  return { begin, scannerFailed, setScannerFailed };
}

/**
 * The camera, in the middle of the tab bar (4.12): for those who may add
 * documents, on a phone with a scanner.
 */
export function ScanButton() {
  const { t } = useTranslation();
  const capture = useCapture();
  const { begin, scannerFailed, setScannerFailed } = useBeginCapture();
  if (!capture.scanner.scans) return null;
  return (
    <View style={styles.wrap}>
      {scannerFailed ? (
        <View style={styles.notice}>
          <Notice tone="warn" testID="home-scanner-failed">
            <Text>{t('home.scannerFailed')}</Text>
            <Button kind="quiet" label={t('home.dismissNotice')} onPress={() => setScannerFailed(false)} />
          </Notice>
        </View>
      ) : null}
      <Pressable
        testID="home-scan"
        accessibilityRole="button"
        accessibilityLabel={t('home.scan')}
        accessibilityHint={t('home.scanHint')}
        onPress={() => void begin('scan')}
        style={({ pressed }) => [styles.camera, pressed ? styles.pressed : null]}
      >
        <Camera color={colours.onAccent} size={28} accessibilityElementsHidden importantForAccessibility="no" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  notice: { position: 'absolute', bottom: 72, width: 300 },
  camera: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colours.accent,
    elevation: 3,
  },
  pressed: { opacity: 0.8 },
});
