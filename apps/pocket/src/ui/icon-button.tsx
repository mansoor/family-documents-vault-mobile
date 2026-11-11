import type { LucideIcon } from 'lucide-react-native';
import { Pressable, StyleSheet } from 'react-native';
import { useColours } from './theme';

/**
 * A round button in a screen's header (R6): an icon, named for a screen
 * reader; 40 dp, 44 with its hit slop. Edit details and ⋯ on a document,
 * Edit and Delete on a collection.
 */
export function IconButton(props: { testID: string; label: string; icon: LucideIcon; onPress: () => void }) {
  const colours = useColours();
  const Icon = props.icon;
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      hitSlop={2}
      onPress={props.onPress}
      style={({ pressed }) => [styles.button, pressed ? styles.pressed : null]}
    >
      <Icon color={colours.ink} size={20} accessibilityElementsHidden importantForAccessibility="no" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.8 },
});
