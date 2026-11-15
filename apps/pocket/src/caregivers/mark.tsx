import { CAREGIVER_MARK, radii } from '@fdv/shared';
import { HeartHandshake } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import { Text } from '../ui';
import { sp } from '../ui/space';
import { useColours, useStyles, type Palette } from '../ui/theme';

/**
 * "Shared with you as caregiver" (H1b), on each paper the person sees only
 * because a grant gives it them — in a list, on its page and over its
 * pages — and never "Only me", which would say it was theirs.
 */
export function CaregiverMark(props: { testID?: string }) {
  const styles = useStyles(makeStyles);
  const colours = useColours();
  return (
    <View style={styles.mark} testID={props.testID ?? 'caregiver-mark'} accessible accessibilityLabel={CAREGIVER_MARK}>
      <HeartHandshake color={colours.accent} size={12} accessibilityElementsHidden importantForAccessibility="no" />
      <Text variant="small" weight="700" tone="accent">
        {CAREGIVER_MARK}
      </Text>
    </View>
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    mark: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: sp(4),
      paddingHorizontal: sp(8),
      paddingVertical: 2,
      borderRadius: radii.pill,
      backgroundColor: colours.accentSoft,
    },
  });
