import { radii } from '@fdv/shared';
import { useRouter } from 'expo-router';
import { ChevronRight, HeartPulse } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { useVault } from '../state/vault';
import { Text } from '../ui';
import { sp } from '../ui/space';
import { useColours, useStyles, type Palette } from '../ui/theme';
import { emergencyOffered } from './rules';

/**
 * "Emergency information ›" on a person's page (app 0.15.0, H4): there
 * when the vault shows the reader that person's page, and opening it. The
 * vault is asked once; what it answers is let go of at once (the page
 * itself asks again), and a page it does not show draws nothing.
 */
export function EmergencyRow(props: { memberId: string; name: string }) {
  const styles = useStyles(makeStyles);
  const colours = useColours();
  const { t } = useTranslation();
  const router = useRouter();
  const { caps, who, withToken, offline } = useVault();
  const offered = emergencyOffered(caps, who?.role);
  const [there, setThere] = useState(false);
  const { memberId } = props;

  useEffect(() => {
    if (!offered || offline) return;
    let live = true;
    withToken((a, tk) => a.emergencyOf(tk, memberId)).then(
      () => {
        if (live) setThere(true);
      },
      () => {
        if (live) setThere(false);
      },
    );
    return () => {
      live = false;
    };
  }, [offered, offline, withToken, memberId]);

  if (!offered || !there) return null;
  return (
    <Pressable
      testID={`emergency-row-${memberId}`}
      accessibilityRole="button"
      accessibilityLabel={t('emergency.title')}
      accessibilityHint={t('emergency.rowHint', { name: props.name })}
      onPress={() => router.push({ pathname: '/emergency/[id]', params: { id: memberId, name: props.name } })}
      style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
    >
      <View style={styles.icon}>
        <HeartPulse color={colours.accent} size={20} accessibilityElementsHidden importantForAccessibility="no" />
      </View>
      <Text weight="600" style={styles.flex}>
        {t('emergency.title')}
      </Text>
      <ChevronRight color={colours.inkMuted} size={20} accessibilityElementsHidden importantForAccessibility="no" />
    </Pressable>
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: sp(12),
      minHeight: 52,
      paddingHorizontal: sp(14),
      paddingVertical: sp(8),
      borderRadius: radii.l,
      borderWidth: 1,
      borderColor: colours.border,
      backgroundColor: colours.surface,
    },
    icon: {
      width: 36,
      height: 36,
      borderRadius: radii.pill,
      backgroundColor: colours.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    flex: { flex: 1 },
    pressed: { opacity: 0.8 },
  });
