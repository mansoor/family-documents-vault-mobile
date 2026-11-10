import { radii } from '@fdv/shared';
import { useRouter } from 'expo-router';
import { Bell } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text as RNText, View } from 'react-native';
import { useAttention } from '../state/attention';
import { font } from './fonts';
import { useColours, useStyles, type Palette } from './theme';

/**
 * The bell in each tab's header (R3): Needs attention, with how many
 * reminders are due now on it — no number when none is, so a bell with one
 * means something does. Said as words to a screen reader, never as a red
 * dot alone.
 */
export function BellButton() {
  const styles = useStyles(makeStyles);
  const colours = useColours();
  const { t } = useTranslation();
  const router = useRouter();
  const { count } = useAttention();
  const due = count ?? 0;
  return (
    <Pressable
      testID="bell"
      accessibilityRole="button"
      accessibilityLabel={due > 0 ? t('bell.due', { count: due }) : t('bell.none')}
      hitSlop={2}
      onPress={() => router.push('/attention')}
      style={({ pressed }) => [styles.bell, pressed ? styles.pressed : null]}
    >
      <Bell color={colours.ink} size={22} accessibilityElementsHidden importantForAccessibility="no" />
      {due > 0 ? (
        <View style={styles.badge} accessibilityElementsHidden importantForAccessibility="no" testID="bell-count">
          <RNText style={styles.number} allowFontScaling={false}>
            {due > 99 ? '99+' : String(due)}
          </RNText>
        </View>
      ) : null}
    </Pressable>
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    bell: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    pressed: { opacity: 0.7 },
    badge: {
      position: 'absolute',
      top: 4,
      right: 2,
      minWidth: 18,
      height: 18,
      paddingHorizontal: 4,
      borderRadius: radii.pill,
      backgroundColor: colours.danger,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: colours.bg,
    },
    number: { ...font('700'), fontSize: 10, lineHeight: 12, color: colours.onAccent },
  });
