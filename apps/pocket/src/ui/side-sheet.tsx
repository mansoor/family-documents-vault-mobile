import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Modal, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReduceMotion } from './feel';
import { RisesWithKeyboard, useKeyboardShown } from './keyboard';
import { useStyles, type Palette } from './theme';

/**
 * A panel from the side (R5): the filters slide out from the right over the
 * list, as the mockup has them, and the list stays in view behind. Back and
 * a tap on the shade close it. With Remove animations on, it is there at
 * once. A screen reader stays inside it. It grows shorter from its foot
 * as the keyboard rises (0.26.0), and what it scrolls is a SheetScroll, so
 * a field in it is never typed into blind.
 */
export function SideSheet(props: {
  visible: boolean;
  onClose: () => void;
  testID: string;
  children: ReactNode;
}) {
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const still = useReduceMotion();
  const { width } = useWindowDimensions();
  const keyboard = useKeyboardShown();
  const panel = Math.min(360, Math.round(width * 0.88));
  // Made once, and moved by the effect below: never read while drawing.
  const [x] = useState(() => new Animated.Value(panel));
  useEffect(() => {
    if (!props.visible) return;
    x.setValue(still ? 0 : panel);
    if (!still) Animated.timing(x, { toValue: 0, duration: 200, useNativeDriver: true }).start();
  }, [props.visible, still, panel, x]);

  return (
    <Modal visible={props.visible} transparent animationType={still ? 'none' : 'fade'} onRequestClose={props.onClose}>
      <RisesWithKeyboard style={styles.shade}>
        <Pressable
          testID={`${props.testID}-shade`}
          accessible={false}
          importantForAccessibility="no"
          onPress={props.onClose}
          style={StyleSheet.absoluteFill}
        />
        <Animated.View
          testID={props.testID}
          accessibilityViewIsModal
          style={[
            styles.panel,
            { width: panel, paddingTop: insets.top, paddingBottom: keyboard ? 0 : insets.bottom, transform: [{ translateX: x }] },
          ]}
        >
          {props.children}
        </Animated.View>
      </RisesWithKeyboard>
    </Modal>
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    shade: { flex: 1, backgroundColor: colours.scrim, alignItems: 'flex-end' },
    panel: {
      flex: 1,
      backgroundColor: colours.bg,
      borderTopLeftRadius: 20,
      borderBottomLeftRadius: 20,
      overflow: 'hidden',
    },
  });
