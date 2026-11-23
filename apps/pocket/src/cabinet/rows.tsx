import { radii } from '@fdv/shared';
import type { LucideIcon } from 'lucide-react-native';
import { ChevronRight } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';
import type { RowPlace } from '../documents/row';
import { Text } from '../ui';
import { ROW } from '../ui/scale';
import { sp } from '../ui/space';
import { useColours, useStyles, type Palette } from '../ui/theme';

/**
 * A cabinet, a drawer or a folder in a list (C5): its icon, its name and a
 * line under it (how many drawers, folders or documents), opening the next
 * level down. Drawn as one card with the rows around it, as documents are.
 */
export function NodeRow(props: {
  testID: string;
  icon: LucideIcon;
  name: string;
  /** What a screen reader says for its name, where the name shown is not the words for it. */
  spoken?: string;
  line?: string | null;
  place: RowPlace;
  onPress: () => void;
}) {
  const colours = useColours();
  const styles = useStyles(makeStyles);
  const Icon = props.icon;
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="button"
      accessibilityLabel={props.line ? `${props.spoken ?? props.name}. ${props.line}` : (props.spoken ?? props.name)}
      onPress={props.onPress}
      style={({ pressed }) => [styles.row, styles[props.place], pressed ? styles.pressed : null]}
    >
      <View style={styles.icon}>
        <Icon color={colours.accent} size={18} accessibilityElementsHidden importantForAccessibility="no" />
      </View>
      <View style={styles.words}>
        <Text weight="600">{props.name}</Text>
        {props.line ? (
          <Text variant="secondary" tone="soft">
            {props.line}
          </Text>
        ) : null}
      </View>
      <ChevronRight color={colours.inkSoft} size={18} accessibilityElementsHidden importantForAccessibility="no" />
    </Pressable>
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: sp(12),
      padding: sp(10),
      minHeight: ROW,
      backgroundColor: colours.surface,
      borderRadius: radii.l,
      borderWidth: 1,
      borderColor: colours.border,
    },
    icon: {
      width: 30,
      height: 30,
      borderRadius: radii.s,
      backgroundColor: colours.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    words: { flex: 1, gap: sp(4) },
    // One card for the list, as a list of documents is (R1).
    only: {},
    first: { borderBottomWidth: 0, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
    middle: { borderRadius: 0, borderBottomWidth: 0, borderTopWidth: StyleSheet.hairlineWidth },
    last: { borderTopWidth: StyleSheet.hairlineWidth, borderTopLeftRadius: 0, borderTopRightRadius: 0 },
    pressed: { opacity: 0.8 },
  });
