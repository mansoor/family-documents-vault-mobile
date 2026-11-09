import { radii, TAP_MIN } from '@fdv/shared';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './index';
import { sp } from './space';
import { useStyles, type Palette } from './theme';

/**
 * One choice among several: a chip that says whether it is chosen — or,
 * given `expanded`, one that opens more (More…), and says whether it is open.
 */
export function Chip(props: {
  label: string;
  selected?: boolean;
  expanded?: boolean;
  disabled?: boolean;
  onPress: () => void;
  testID?: string;
  leading?: string;
}) {
  const styles = useStyles(makeStyles);
  const selected = props.selected === true || props.expanded === true;
  const disabled = props.disabled === true;
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={
        props.expanded === undefined ? { selected, disabled } : { expanded: props.expanded, disabled }
      }
      disabled={disabled}
      onPress={props.onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.chip,
        selected ? styles.chipOn : null,
        disabled ? styles.chipOff : null,
        pressed ? styles.pressed : null,
      ]}
    >
      {props.leading ? (
        <View style={[styles.avatar, selected ? styles.avatarOn : null]}>
          <Text weight="700" tone={selected ? 'accent' : 'soft'} role="text">
            {props.leading}
          </Text>
        </View>
      ) : null}
      <Text weight="600" tone={selected ? 'onAccent' : 'ink'} role="text">
        {props.label}
      </Text>
    </Pressable>
  );
}

/** Chips in a row that wraps: a single choice (a radio group), or just actions side by side. */
export function ChipRow(props: { children: ReactNode; label: string; role?: 'radiogroup' | 'none' }) {
  const styles = useStyles(makeStyles);
  if (props.role === 'none') return <View style={styles.chips}>{props.children}</View>;
  return (
    <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={props.label}>
      {props.children}
    </View>
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: sp(8) },
    chip: {
      minHeight: TAP_MIN,
      flexDirection: 'row',
      alignItems: 'center',
      gap: sp(8),
      paddingHorizontal: sp(14),
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: colours.borderInput,
      backgroundColor: colours.surface,
    },
    chipOn: { backgroundColor: colours.accent, borderColor: colours.accent },
    chipOff: { opacity: 0.45 },
    avatar: {
      width: 28,
      height: 28,
      borderRadius: radii.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colours.accentSoft,
    },
    avatarOn: { backgroundColor: colours.surface },
    pressed: { opacity: 0.8 },
  });
