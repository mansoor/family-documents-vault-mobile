import { radii } from '@fdv/shared';
import { useRouter } from 'expo-router';
import { Camera, FileUp, ImagePlus, Plus, type LucideIcon } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCapture, type StartOutcome } from '../state/capture';
import { Button, Notice, Text } from '../ui';
import { useReduceMotion } from '../ui/feel';
import { useColours, useStyles, type Palette } from '../ui/theme';

type How = 'scan' | 'file' | 'photo';

/**
 * Starting a capture — the scanner, a file or a photo — and, when it
 * leads to the card, going there. The scanner failing to open is said
 * where it was asked for.
 */
export function useBeginCapture() {
  const capture = useCapture();
  const router = useRouter();
  const [scannerFailed, setScannerFailed] = useState(false);
  const begin = useCallback(
    async (how: How): Promise<StartOutcome> => {
      setScannerFailed(false);
      const outcome = await capture.start(how);
      if (outcome === 'card') {
        setScannerFailed(false);
        router.push('/capture');
      } else if (outcome === 'failed' && how === 'scan') {
        setScannerFailed(true);
      }
      return outcome;
    },
    [capture, router],
  );
  // Said for a while, not for ever.
  useEffect(() => {
    if (!scannerFailed) return;
    const timer = setTimeout(() => setScannerFailed(false), 10_000);
    return () => clearTimeout(timer);
  }, [scannerFailed]);
  return { begin, scannerFailed, setScannerFailed };
}

/** A screen reader's focus to this view; on the web, the browser's own focus. */
export function focusOn(view: RefObject<View | null>) {
  const v = view.current;
  if (!v) return;
  if (Platform.OS === 'web') (v as unknown as { focus?: () => void }).focus?.();
  else AccessibilityInfo.sendAccessibilityEvent(v, 'focus');
}

/** Where the + is on the screen: its centre, in the window's coordinates. */
interface At {
  x: number;
  y: number;
}

/**
 * The +, in the middle of the tab bar (4.12; as on the web, Phase 5): for
 * those who may add documents. It opens the ways to add one — a file, the
 * camera (on a phone with a scanner) or a picture — fanned out around it
 * (the owner, 11 Nov 2026).
 */
export function AddButton() {
  const colours = useColours();
  const styles = useStyles(makeStyles);
  const { t } = useTranslation();
  const capture = useCapture();
  const { begin, scannerFailed, setScannerFailed } = useBeginCapture();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  // Until the + has been measured: where the tab bar draws it, in the middle at the foot.
  const [at, setAt] = useState<At | null>(null);
  const plus = useRef<View>(null);
  const scans = capture.scanner.scans;

  // Focus goes back to the + once the menu's window has gone: sent before
  // then, it is lost with the window.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const backToPlus = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      focusOn(plus);
    }, 300);
  }, []);

  const show = () => {
    // Measured as it opens: the fan opens around the + wherever the bar has put it.
    plus.current?.measureInWindow((x, y, w, h) => {
      if ([x, y, w, h].every(Number.isFinite) && w > 0) setAt({ x: x + w / 2, y: y + h / 2 });
    });
    setOpen(true);
  };
  const close = useCallback(() => {
    setOpen(false);
    backToPlus();
  }, [backToPlus]);
  const choose = useCallback(
    async (how: How) => {
      setOpen(false);
      // Nothing picked: back where the person was. The card is a screen of
      // its own, and a scanner that failed says so where the + is.
      if ((await begin(how)) === 'cancelled') backToPlus();
    },
    [begin, backToPlus],
  );

  return (
    <View style={styles.slot} testID="home-add-slot">
      {scannerFailed ? (
        <View style={styles.notice}>
          <Notice tone="warn" testID="home-scanner-failed">
            <Text>{t('home.scannerFailed')}</Text>
            <Button kind="quiet" label={t('home.dismissNotice')} onPress={() => setScannerFailed(false)} />
          </Notice>
        </View>
      ) : null}
      <Pressable
        ref={plus}
        testID="home-add"
        accessibilityRole="button"
        accessibilityLabel={t('add.button')}
        accessibilityHint={t(scans ? 'add.hint' : 'add.hintNoCamera')}
        accessibilityState={{ expanded: open }}
        onPress={show}
        style={({ pressed }) => [styles.plus, pressed ? styles.pressed : null]}
      >
        <Plus
          color={colours.onAccent}
          size={28}
          strokeWidth={2.5}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
      </Pressable>
      <AddMenu
        visible={open}
        camera={scans}
        at={at ?? { x: width / 2, y: height - insets.bottom - 6 - PLUS / 2 }}
        onChoose={(how) => void choose(how)}
        onClose={close}
      />
    </View>
  );
}

interface Choice {
  how: How;
  icon: LucideIcon;
  label: string;
  hint: string;
  testID: string;
}

/** How far the choices sit from the +'s centre, and how wide each one's label may be. */
const RADIUS = 116;
const ITEM = 56;
const LABEL = 112;

/** Where each choice goes, by how many there are: on a semicircle above the +, left to right. */
const ANGLES: Record<number, number[]> = { 2: [150, 30], 3: [150, 90, 30] };

/**
 * The ways to add a document, fanned out in a semicircle above the +
 * (the owner, 11 Nov 2026): a file, the camera, a picture — in the owner's
 * order, left to right. The + turns into an ✕, which closes it, as do Back
 * and a tap anywhere else. They spring out of the + and fold back into it;
 * with Remove animations on, they are there and gone at once. A screen
 * reader starts on the first choice.
 */
export function AddMenu(props: {
  visible: boolean;
  /** The phone has a scanner: Camera is offered. */
  camera: boolean;
  /** The +'s centre, which the choices fan out around. */
  at: At;
  onChoose: (how: How) => void;
  onClose: () => void;
}) {
  const colours = useColours();
  const styles = useStyles(makeStyles);
  const { t } = useTranslation();
  const still = useReduceMotion();
  const first = useRef<View>(null);
  const [progress] = useState(() => new Animated.Value(0));
  // Drawn while it opens, while it is open, and while it folds away.
  const [shown, setShown] = useState(false);
  if (props.visible && !shown) setShown(true);
  if (!props.visible && shown && still) setShown(false);

  useEffect(() => {
    if (props.visible) {
      if (still) {
        progress.setValue(1);
        return;
      }
      progress.setValue(0);
      const a = Animated.spring(progress, { toValue: 1, friction: 6, tension: 80, useNativeDriver: true });
      a.start();
      return () => a.stop();
    }
    if (still) {
      progress.setValue(0);
      return;
    }
    const a = Animated.timing(progress, {
      toValue: 0,
      duration: 160,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    });
    a.start(({ finished }) => {
      if (finished) setShown(false);
    });
    return () => a.stop();
  }, [props.visible, still, progress]);

  const camera: Choice = {
    how: 'scan',
    icon: Camera,
    label: t('add.camera'),
    hint: t('add.cameraHint'),
    testID: 'add-camera',
  };
  const choices: Choice[] = [
    { how: 'file', icon: FileUp, label: t('add.file'), hint: t('add.fileHint'), testID: 'add-file' },
    ...(props.camera ? [camera] : []),
    { how: 'photo', icon: ImagePlus, label: t('add.picture'), hint: t('add.pictureHint'), testID: 'add-picture' },
  ];
  const angles = ANGLES[choices.length] ?? ANGLES[3] ?? [];
  const turn = progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '45deg'] });
  const shade = progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' });

  return (
    <Modal
      visible={shown}
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={props.onClose}
      onShow={() => focusOn(first)}
    >
      <Animated.View style={[StyleSheet.absoluteFill, styles.shade, { opacity: shade }]}>
        <Pressable
          testID="add-menu-outside"
          accessible={false}
          importantForAccessibility="no"
          onPress={props.onClose}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none" accessibilityViewIsModal testID="add-menu">
        <View
          accessibilityRole="menu"
          accessibilityLabel={t('add.title')}
          style={StyleSheet.absoluteFill}
          pointerEvents="box-none"
          testID="add-menu-choices"
        >
          {choices.map((c, i) => {
            const Icon = c.icon;
            const angle = ((angles[i] ?? 90) * Math.PI) / 180;
            const dx = Math.cos(angle) * RADIUS;
            const dy = -Math.sin(angle) * RADIUS;
            // Each a moment after the one before: they fan out left to right.
            const own = progress.interpolate({ inputRange: [i * 0.1, 1], outputRange: [0, 1], extrapolateLeft: 'clamp' });
            return (
              <Animated.View
                key={c.how}
                pointerEvents={props.visible ? 'auto' : 'none'}
                style={[
                  styles.place,
                  {
                    left: props.at.x - LABEL / 2,
                    top: props.at.y - ITEM / 2,
                    opacity: own.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }),
                    transform: [
                      { translateX: own.interpolate({ inputRange: [0, 1], outputRange: [0, dx] }) },
                      { translateY: own.interpolate({ inputRange: [0, 1], outputRange: [0, dy] }) },
                      { scale: own.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) },
                    ],
                  },
                ]}
              >
                <Pressable
                  ref={i === 0 ? first : undefined}
                  testID={c.testID}
                  accessibilityRole="menuitem"
                  accessibilityLabel={c.label}
                  accessibilityHint={c.hint}
                  onPress={() => props.onChoose(c.how)}
                  style={({ pressed }) => [styles.choice, pressed ? styles.pressed : null]}
                >
                  <Icon color={colours.accent} size={24} accessibilityElementsHidden importantForAccessibility="no" />
                  {/* Its words above it, clear of the tab bar under the arc. */}
                  <View style={styles.above} pointerEvents="none">
                    <View style={styles.tag}>
                      <Text variant="small" weight="600" role="text" style={styles.label}>
                        {c.label}
                      </Text>
                    </View>
                  </View>
                </Pressable>
              </Animated.View>
            );
          })}
        </View>
        {/* The + again, over the tab bar's, turning into an ✕ that closes the menu. */}
        <Pressable
          testID="add-cancel"
          accessibilityRole="button"
          accessibilityLabel={t('add.close')}
          onPress={props.onClose}
          style={({ pressed }) => [
            styles.plus,
            styles.over,
            { left: props.at.x - PLUS / 2, top: props.at.y - PLUS / 2 },
            pressed ? styles.pressed : null,
          ]}
        >
          <Animated.View style={{ transform: [{ rotate: turn }] }}>
            <Plus
              color={colours.onAccent}
              size={28}
              strokeWidth={2.5}
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
          </Animated.View>
        </Pressable>
      </View>
    </Modal>
  );
}

const PLUS = 56;

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    // The tab bar's centre: a fixed width, the + and a little air either
    // side, so the tabs' labels never run up against it.
    slot: { width: PLUS + 8, alignItems: 'center' },
    notice: { position: 'absolute', bottom: 72, width: 300 },
    // As on the web: 56 across.
    plus: {
      width: PLUS,
      height: PLUS,
      borderRadius: PLUS / 2,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colours.accent,
      elevation: 3,
    },
    over: { position: 'absolute', elevation: 6 },
    pressed: { opacity: 0.8 },
    shade: { backgroundColor: colours.scrim },
    // Each choice: a round button centred on its place on the arc, its words above it.
    place: { position: 'absolute', width: LABEL, height: ITEM, alignItems: 'center' },
    choice: {
      width: ITEM,
      height: ITEM,
      borderRadius: ITEM / 2,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colours.surface,
      elevation: 4,
    },
    above: { position: 'absolute', bottom: ITEM + 4, left: (ITEM - LABEL) / 2, width: LABEL, alignItems: 'center' },
    tag: {
      maxWidth: LABEL,
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: radii.pill,
      backgroundColor: colours.surface,
    },
    label: { textAlign: 'center' },
  });
