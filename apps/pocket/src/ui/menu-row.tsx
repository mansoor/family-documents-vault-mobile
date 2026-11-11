import type { LucideIcon } from 'lucide-react-native';
import { Pressable, StyleSheet } from 'react-native';
import { Text } from '.';
import { sp } from './space';
import { useColours } from './theme';

/**
 * One choice in a page's ⋯ sheet (R6): an icon and its words, 48 dp tall;
 * in the danger colour for what deletes. A document's ⋯ and a
 * collection's (the owner's tidy-up of 11 Nov 2026).
 */
export function MenuRow(props: {
  testID: string;
  icon: LucideIcon;
  label: string;
  danger?: boolean;
  busy?: boolean;
  onPress: () => void;
}) {
  const colours = useColours();
  const Icon = props.icon;
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ busy: props.busy === true, disabled: props.busy === true }}
      disabled={props.busy === true}
      onPress={props.onPress}
      style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
    >
      <Icon
        color={props.danger ? colours.danger : colours.accent}
        size={20}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
      <Text tone={props.danger ? 'danger' : 'ink'} weight="600">
        {props.label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: sp(12), minHeight: 48 },
  pressed: { opacity: 0.8 },
});
