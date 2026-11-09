import { radii, TAP_MIN } from '@fdv/shared';
import { useRouter } from 'expo-router';
import { Camera, FileUp, ImagePlus, Plus, type LucideIcon } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useCapture, type StartOutcome } from '../state/capture';
import { Button, Notice, Text } from '../ui';
import { Sheet } from '../ui/sheet';
import { sp } from '../ui/space';
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

/**
 * The +, in the middle of the tab bar (4.12; as on the web, Phase 5): for
 * those who may add documents. It opens the ways to add one — a file, the
 * camera (on a phone with a scanner) or a picture.
 */
export function AddButton() {
  const colours = useColours();
  const styles = useStyles(makeStyles);
  const { t } = useTranslation();
  const capture = useCapture();
  const { begin, scannerFailed, setScannerFailed } = useBeginCapture();
  const [open, setOpen] = useState(false);
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
        onPress={() => setOpen(true)}
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
      <AddMenu visible={open} camera={scans} onChoose={(how) => void choose(how)} onClose={close} />
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

/**
 * The ways to add a document, in a sheet over the screen: a file, the
 * camera, a picture — in the owner's order. Back, a tap outside or Cancel
 * close it; a screen reader starts on the first choice.
 */
export function AddMenu(props: {
  visible: boolean;
  /** The phone has a scanner: Camera is offered. */
  camera: boolean;
  onChoose: (how: How) => void;
  onClose: () => void;
}) {
  const colours = useColours();
  const styles = useStyles(makeStyles);
  const { t } = useTranslation();
  const first = useRef<View>(null);
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
  return (
    <Sheet
      visible={props.visible}
      onClose={props.onClose}
      testID="add-menu"
      outside="add-menu-outside"
      tall
      onShow={() => focusOn(first)}
    >
      <Text variant="screen">{t('add.title')}</Text>
      {/* At the largest text the choices scroll rather than run off the screen. */}
      <ScrollView style={styles.scroll} testID="add-menu-scroll">
        <View
          accessibilityRole="menu"
          accessibilityLabel={t('add.title')}
          style={styles.choices}
          testID="add-menu-choices"
        >
          {choices.map((c, i) => {
            const Icon = c.icon;
            return (
              <Pressable
                key={c.how}
                ref={i === 0 ? first : undefined}
                testID={c.testID}
                accessibilityRole="menuitem"
                accessibilityLabel={c.label}
                accessibilityHint={c.hint}
                onPress={() => props.onChoose(c.how)}
                style={({ pressed }) => [styles.choice, pressed ? styles.pressed : null]}
              >
                <View style={styles.icon}>
                  <Icon
                    color={colours.accent}
                    size={24}
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                  />
                </View>
                <Text weight="600" role="text" style={styles.label}>
                  {c.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
      <Button kind="quiet" label={t('common.cancel')} onPress={props.onClose} testID="add-cancel" />
    </Sheet>
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
    pressed: { opacity: 0.8 },
    scroll: { flexGrow: 0, flexShrink: 1 },
    choices: { gap: sp(8) },
    choice: {
      minHeight: TAP_MIN + 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: sp(14),
      paddingHorizontal: sp(14),
      paddingVertical: sp(8),
      borderRadius: radii.m,
      borderWidth: 1,
      borderColor: colours.border,
      backgroundColor: colours.surface,
    },
    icon: {
      width: 40,
      height: 40,
      borderRadius: radii.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colours.accentSoft,
    },
    label: { flexShrink: 1 },
  });
