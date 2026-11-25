import {
  createContext,
  forwardRef,
  useContext,
  useImperativeHandle,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { ScrollView, type ScrollViewProps, type StyleProp, type View, type ViewStyle } from 'react-native';
import {
  KeyboardAvoidingView,
  KeyboardAwareScrollView,
  KeyboardProvider,
  KeyboardStickyView,
  useKeyboardState,
  type KeyboardAwareScrollViewRef,
} from 'react-native-keyboard-controller';
import { sp } from './space';

/**
 * The keyboard never hides what is being typed (0.26.0). The app is drawn
 * edge to edge on Android (Expo SDK 57), where the window no longer shrinks
 * for the keyboard (`adjustResize` does nothing there) and React Native's
 * own KeyboardAvoidingView measures nothing: a field low on the screen was
 * typed into blind. react-native-keyboard-controller follows the keyboard
 * itself, on Android and on iPhone alike, so every screen with a field
 * uses one of these:
 *
 * - a screen's page: FormScroll, which scrolls the field being typed in to
 *   just above the keyboard (with Cancel and Save riding on it,
 *   AboveKeyboard);
 * - a sheet, or a panel from the side: it rises with the keyboard
 *   (RisesWithKeyboard), and what scrolls in it is a SheetScroll, which
 *   brings the field given the focus to its top. A sheet is a window of its
 *   own on Android, whose keyboard the library follows but whose focus it
 *   does not see, so a KeyboardAwareScrollView there would never scroll.
 */

/** Around everything, once: what the pieces below listen to. */
export function KeyboardRoot(props: { children: ReactNode }) {
  return <KeyboardProvider>{props.children}</KeyboardProvider>;
}

/**
 * Space kept between the field being typed in and the top of the keyboard,
 * so a line or two under it (an error, a hint) shows too.
 */
export const KEYBOARD_GAP = sp(24);

/** Whether the keyboard is up: a sheet's foot leaves out the room kept for the phone's own buttons. */
export function useKeyboardShown(): boolean {
  return useKeyboardState((s) => s.isVisible);
}

/**
 * What a field asks of the page it is in: `focused`, given the focus (a
 * sheet's scroll brings it to its top); `again`, keep the field with the
 * focus in view once something around it has moved (the tag field's pills
 * appearing above it).
 */
interface KeepInView {
  focused?: (node: View) => void;
  again: () => void;
}

const KeepInViewContext = createContext<KeepInView | null>(null);

/** The page's keeper, if the field is in one; null elsewhere (nothing to do). */
export const useKeepInView = (): KeepInView | null => useContext(KeepInViewContext);

/**
 * A screen's scrolling page that holds fields: when the keyboard opens, or
 * another field is given the focus, the one being typed in is scrolled to
 * just above it (`gap` more, for something fixed between them, such as
 * Cancel and Save at the foot). A tap on a button while the keyboard is up
 * presses it rather than only closing the keyboard.
 */
export const FormScroll = forwardRef<ScrollView, ScrollViewProps & { gap?: number }>(function FormScroll(
  { gap, children, ...props },
  ref,
) {
  const inner = useRef<KeyboardAwareScrollViewRef | null>(null);
  useImperativeHandle(ref, () => inner.current as unknown as ScrollView);
  const keeper = useMemo<KeepInView>(
    () => ({ again: () => requestAnimationFrame(() => inner.current?.assureFocusedInputVisible?.()) }),
    [],
  );
  return (
    <KeepInViewContext.Provider value={keeper}>
      <KeyboardAwareScrollView
        ref={inner}
        keyboardShouldPersistTaps="handled"
        {...props}
        bottomOffset={KEYBOARD_GAP + (gap ?? 0)}
      >
        {children}
      </KeyboardAwareScrollView>
    </KeepInViewContext.Provider>
  );
});

/** Room left above a field a sheet's scroll brings to its top: its label, and a little more. */
const SHEET_ABOVE = sp(8);
/** How long a sheet takes to rise with the keyboard: the field is brought into view again then. */
const SHEET_RISES_MS = 350;

/**
 * What scrolls inside a sheet or a side panel that holds fields. The sheet
 * rises with the keyboard and so grows shorter from its foot; the field
 * given the focus is brought to the top of what shows, where the keyboard
 * never reaches, at once and again once the sheet has risen.
 */
export const SheetScroll = forwardRef<ScrollView, ScrollViewProps>(function SheetScroll({ children, ...props }, ref) {
  const inner = useRef<ScrollView>(null);
  useImperativeHandle(ref, () => inner.current as ScrollView);
  const last = useRef<View | null>(null);
  const keeper = useMemo<KeepInView>(() => {
    const show = () => {
      const scroll = inner.current;
      const node = last.current;
      // Its content's own view (React Native has it; its types leave it out): where the field is in it.
      const content = (scroll as unknown as { getInnerViewRef?: () => unknown } | null)?.getInnerViewRef?.();
      if (!scroll || !node || !content) return;
      try {
        node.measureLayout(
          content as never,
          (_x, y) => scroll.scrollTo({ y: Math.max(0, y - SHEET_ABOVE), animated: true }),
          () => undefined,
        );
      } catch {
        // Not laid out yet: where it is stays.
      }
    };
    return {
      focused: (node) => {
        last.current = node;
        requestAnimationFrame(show);
        setTimeout(show, SHEET_RISES_MS);
      },
      again: () => requestAnimationFrame(show),
    };
  }, []);
  return (
    <KeepInViewContext.Provider value={keeper}>
      <ScrollView ref={inner} keyboardShouldPersistTaps="handled" {...props}>
        {children}
      </ScrollView>
    </KeepInViewContext.Provider>
  );
});

/**
 * What sits at the foot of a screen and rides up on the keyboard (Cancel
 * and Save): `under` is the part of it that the phone's own buttons need
 * when there is no keyboard, which the keyboard covers once it is up.
 */
export function AboveKeyboard(props: { children: ReactNode; under: number; style?: StyleProp<ViewStyle>; testID?: string }) {
  return (
    <KeyboardStickyView
      offset={{ closed: 0, opened: props.under }}
      style={props.style}
      {...(props.testID ? { testID: props.testID } : {})}
    >
      {props.children}
    </KeyboardStickyView>
  );
}

/**
 * A sheet's shade (P1), or a side panel's: what is in it rises with the
 * keyboard, on Android as on iPhone. Where the shade is on the screen is
 * measured, not assumed: a sheet's window may or may not be drawn under
 * the status bar.
 */
export function RisesWithKeyboard(props: { children: ReactNode; style: StyleProp<ViewStyle> }) {
  return (
    <KeyboardAvoidingView behavior="padding" automaticOffset style={props.style}>
      {props.children}
    </KeyboardAvoidingView>
  );
}
