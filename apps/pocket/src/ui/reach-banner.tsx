import { CloudOff, WifiOff } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import { useVault } from '../state/vault';
import { Button, Text } from './index';
import { sp } from './space';
import { useColours, useStyles, type Palette } from './theme';

/** How long the vault must stay out of reach before the line shows: one slow moment says nothing. */
export const BANNER_DELAY_MS = 2_000;

/**
 * The tabs' slim line while the vault gives no answer (0.13.0): what is
 * wrong in a few plain words — this phone is offline; this vault is used
 * only on Wi-Fi; something else answers at its address; or the vault can't
 * be reached on the network the phone has — and Try again. It never covers
 * anything: it sits above the tab bar, shows only once the vault has been
 * out of reach for BANNER_DELAY_MS, said aloud once, and goes by itself
 * when the vault answers (state/vault.tsx looks again on a network change,
 * back in front, and every so often). Nothing moves: it simply appears.
 */
export function ReachBanner() {
  const styles = useStyles(makeStyles);
  const colours = useColours();
  const { t } = useTranslation();
  const { reach, offline, recheck, phase, notice } = useVault();
  const [trying, setTrying] = useState(false);
  const out = offline && reach !== 'online' && phase === 'ready';
  const key =
    notice === 'wifi_only'
      ? 'reach.wifiOnly'
      : notice === 'stranger'
        ? 'reach.stranger'
        : reach === 'no_network'
          ? 'reach.noNetwork'
          : 'reach.unreachable';
  const words = t(key);
  // Shown after a while out of reach, and gone at once when it answers.
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!out) {
      // Answering again: gone at once, nothing to wait for.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShown(false);
      return;
    }
    const timer = setTimeout(() => setShown(true), BANNER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [out]);
  // Said aloud when it appears or its reason changes, on iOS as on Android.
  useEffect(() => {
    if (shown && out) AccessibilityInfo.announceForAccessibility(words);
  }, [shown, out, words]);
  if (!out || !shown) return null;
  const Icon = reach === 'no_network' ? WifiOff : CloudOff;
  return (
    <View style={styles.banner} testID="reach-banner" accessibilityLiveRegion="polite">
      <Icon color={colours.warn} size={18} accessibilityElementsHidden importantForAccessibility="no" />
      <Text variant="secondary" style={styles.words} testID={`reach-${reach}`}>
        {words}
      </Text>
      <Button
        kind="quiet"
        size="small"
        label={t('reach.tryAgain')}
        busy={trying}
        hint={t('reach.tryAgainHint')}
        onPress={() => {
          setTrying(true);
          void recheck().finally(() => setTrying(false));
        }}
        testID="reach-try-again"
      />
    </View>
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: sp(8),
      paddingHorizontal: sp(12),
      paddingVertical: sp(6),
      backgroundColor: colours.warnSoft,
      borderTopWidth: 1,
      borderTopColor: colours.border,
    },
    words: { flex: 1 },
  });
