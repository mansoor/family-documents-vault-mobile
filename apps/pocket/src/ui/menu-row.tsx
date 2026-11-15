import type { LucideIcon } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';
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
  /** A line under its words: who manages a collection, say (0.13.0). */
  detail?: string;
  detailID?: string;
  /** What a screen reader adds: where it goes. */
  hint?: string;
  onPress: () => void;
}) {
  const colours = useColours();
  const Icon = props.icon;
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="button"
      accessibilityLabel={props.detail ? `${props.label}. ${props.detail}` : props.label}
      {...(props.hint ? { accessibilityHint: props.hint } : {})}
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
      <View style={styles.words}>
        <Text tone={props.danger ? 'danger' : 'ink'} weight="600">
          {props.label}
        </Text>
        {props.detail ? (
          <Text variant="secondary" tone="soft" {...(props.detailID ? { testID: props.detailID } : {})}>
            {props.detail}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: sp(12), minHeight: 48 },
  pressed: { opacity: 0.8 },
  words: { flex: 1, paddingVertical: sp(4) },
});
