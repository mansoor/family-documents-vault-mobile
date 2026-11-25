import { radii } from '@fdv/shared';
import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReduceMotion } from './feel';
import { RisesWithKeyboard, useKeyboardShown } from './keyboard';
import { sp } from './space';
import { useStyles, type Palette } from './theme';

/**
 * Every question and choice the app puts over a screen (P1): a sheet from
 * the bottom over a shaded page, above the navigation bar, which the
 * window draws under. Back closes it. A screen reader stays inside it.
 * Every sheet rises with the keyboard (0.26.0), on Android as on iPhone, so
 * a field in it is never typed into blind; one taller than what is left
 * above the keyboard gives way, and what it scrolls stays in view.
 */
export function Sheet(props: {
  visible: boolean;
  /** Back; and a tap on the shade, when `outside` allows it. */
  onClose: () => void;
  testID: string;
  /**
   * A tap on the shade closes it too, as Back does: for a set of choices,
   * never for a question that needs its answer. A string is the shade's
   * testID. A screen reader has Back and the sheet's own Cancel.
   */
  outside?: string | true;
  onShow?: () => void;
  /** Many choices: at the largest text they scroll within 90% of the screen. */
  tall?: boolean;
  children: ReactNode;
}) {
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Remove animations (P10): it is there at once, not faded in.
  const still = useReduceMotion();
  // With the keyboard up, it covers the phone's own buttons: no room kept for them above it.
  const keyboard = useKeyboardShown();
  const body = (
    <>
      {props.outside ? (
        <Pressable
          {...(typeof props.outside === 'string' ? { testID: props.outside } : {})}
          accessible={false}
          importantForAccessibility="no"
          onPress={props.onClose}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      <View
        style={[styles.sheet, props.tall ? styles.tall : null, { paddingBottom: sp(20) + (keyboard ? 0 : insets.bottom) }]}
        accessibilityViewIsModal
        testID={props.testID}
      >
        {props.children}
      </View>
    </>
  );
  return (
    <Modal
      visible={props.visible}
      transparent
      animationType={still ? 'none' : 'fade'}
      onRequestClose={props.onClose}
      {...(props.onShow ? { onShow: props.onShow } : {})}
    >
      <RisesWithKeyboard style={styles.shade}>{body}</RisesWithKeyboard>
    </Modal>
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    shade: { flex: 1, backgroundColor: colours.scrim, justifyContent: 'flex-end' },
    sheet: {
      // Never taller than what the keyboard leaves of the screen.
      flexShrink: 1,
      backgroundColor: colours.bg,
      padding: sp(20),
      gap: sp(12),
      borderTopLeftRadius: radii.xl,
      borderTopRightRadius: radii.xl,
      // Lifted off the page it covers, as the web's sheets are.
      shadowColor: colours.ink,
      shadowOpacity: 0.12,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: -2 },
      elevation: 12,
    },
    tall: { maxHeight: '90%' },
  });
