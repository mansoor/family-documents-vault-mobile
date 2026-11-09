import { radii } from '@fdv/shared';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { sp } from './space';
import { useStyles, type Palette } from './theme';

/**
 * Every question and choice the app puts over a screen (P1): a sheet from
 * the bottom over a shaded page, above the navigation bar, which the
 * window draws under. Back closes it. A screen reader stays inside it.
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
  /** It holds a field: it rises with the keyboard. */
  keyboard?: boolean;
  /** Many choices: at the largest text they scroll within 90% of the screen. */
  tall?: boolean;
  children: ReactNode;
}) {
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
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
        style={[styles.sheet, props.tall ? styles.tall : null, { paddingBottom: sp(20) + insets.bottom }]}
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
      animationType="fade"
      onRequestClose={props.onClose}
      {...(props.onShow ? { onShow: props.onShow } : {})}
    >
      {props.keyboard ? (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.shade}>
          {body}
        </KeyboardAvoidingView>
      ) : (
        <View style={styles.shade}>{body}</View>
      )}
    </Modal>
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    shade: { flex: 1, backgroundColor: colours.scrim, justifyContent: 'flex-end' },
    sheet: {
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
