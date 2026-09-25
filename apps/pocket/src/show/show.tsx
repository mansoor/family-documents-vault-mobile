import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AppState,
  BackHandler,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { openOnline } from '../documents/online';
import { useEssentials, type OpenCopy } from '../state/essentials';
import { useLock, useScreenGuard } from '../state/lock';
import { useStepUp } from '../state/step-up';
import { useVault } from '../state/vault';
import { Text } from '../ui';
import { brighten, restoreBrightness } from './brightness';
import { defaultShowPlatform, type ShowPlatform } from './platform';

const ZOOMS = [1, 1.5, 2, 3];
/** Showing ends by itself after this long: the phone may have been left with someone. */
export const SHOW_FOR_MS = 10 * 60_000;
/** The controls fade after this long (never while a screen reader is on); a tap brings them back. */
export const CONTROLS_FOR_MS = 3_000;
const INK = '#ffffff';
const DIM = 'rgba(255,255,255,0.72)';

/**
 * Show mode (4.11): a kept Essential held up for somebody else to read —
 * at a desk, a gate, a counter. Black, the page fitted, the screen at full
 * brightness and kept awake, the system bars hidden, never captured. It
 * turns with the phone, and a button turns it (ID cards are landscape;
 * many phones have auto-rotate off). Done, Back or a swipe down ends it;
 * so does going to the back, and ten minutes. Ending it always leaves the
 * app locked: whoever is holding the phone gets nothing more.
 */
export function ShowMode(props: {
  id: string;
  onLeave: () => void;
  /** Not kept on the phone: from the vault, confirming it is you first if it asks (4.12). */
  online?: boolean;
  platform?: ShowPlatform;
  /** Tests only: shorter than ten minutes and three seconds. */
  showForMs?: number;
  controlsForMs?: number;
}) {
  const { id, onLeave } = props;
  const { t } = useTranslation();
  const { open } = useEssentials();
  const { withToken } = useVault();
  const { guarded } = useStepUp();
  const { online } = props;
  const { lockNow } = useLock();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const p = useMemo(() => props.platform ?? defaultShowPlatform(), [props.platform]);
  useScreenGuard('show');

  const [copy, setCopy] = useState<OpenCopy | 'missing' | null>(null);
  const [n, setN] = useState(1);
  const [uri, setUri] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0);
  const [controls, setControls] = useState(true);
  const [touched, setTouched] = useState(0);
  const [reader, setReader] = useState(false);
  const [stage, setStage] = useState<{ w: number; h: number } | null>(null);
  const opened = useRef(false);
  const left = useRef(false);

  // Opened once, as a show: the vault is told.
  useEffect(() => {
    if (opened.current || !id) return;
    opened.current = true;
    const load = online ? openOnline(withToken, guarded, id) : open(id, 'show');
    void load.then((c) => setCopy(c ?? 'missing')).catch(() => setCopy('missing'));
  }, [id, open, online, withToken, guarded]);

  useEffect(() => {
    if (!copy || copy === 'missing' || copy.pages === 0) return;
    let cancelled = false;
    void copy.page(n).then((u) => {
      if (!cancelled) setUri(u);
    });
    return () => {
      cancelled = true;
    };
  }, [copy, n]);

  // Showing: full brightness (the old value written down first), awake,
  // free to turn, the bars hidden. All of it undone when the screen goes.
  useEffect(() => {
    void brighten(p);
    void p.keepAwake(true).catch(() => undefined);
    void p.orientation('free').catch(() => undefined);
    void p.immersive(true).catch(() => undefined);
    return () => {
      void restoreBrightness(p);
      void p.keepAwake(false).catch(() => undefined);
      void p.orientation('portrait').catch(() => undefined);
      void p.immersive(false).catch(() => undefined);
    };
  }, [p]);

  /**
   * Out: brightness back first, and the rest undone here too (not only when
   * the screen goes); then off the stack, and locked.
   */
  const leave = useCallback(() => {
    if (left.current) return;
    left.current = true;
    void restoreBrightness(p);
    void p.keepAwake(false).catch(() => undefined);
    void p.orientation('portrait').catch(() => undefined);
    void p.immersive(false).catch(() => undefined);
    onLeave();
    lockNow('show');
  }, [p, onLeave, lockNow]);

  useEffect(() => {
    const timer = setTimeout(leave, props.showForMs ?? SHOW_FOR_MS);
    return () => clearTimeout(timer);
  }, [leave, props.showForMs]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') leave();
    });
    return () => sub.remove();
  }, [leave]);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      leave();
      return true;
    });
    return () => sub.remove();
  }, [leave]);

  // A screen reader keeps every control in reach; otherwise they fade.
  useEffect(() => {
    let live = true;
    void p.screenReader().then((on) => {
      if (live) setReader(on);
    });
    const off = p.onScreenReader(setReader);
    return () => {
      live = false;
      off();
    };
  }, [p]);
  // Faded three seconds after the last touch, not the first.
  useEffect(() => {
    if (reader || !controls) return;
    const timer = setTimeout(() => setControls(false), props.controlsForMs ?? CONTROLS_FOR_MS);
    return () => clearTimeout(timer);
  }, [reader, controls, touched, props.controlsForMs]);
  const shown = reader || controls;

  const pages = copy && copy !== 'missing' ? copy.pages : 0;
  const go = useCallback(
    (to: number) => {
      if (to < 1 || to > pages) return;
      setUri(null);
      setN(to);
    },
    [pages],
  );
  // Turned from however it is now: the phone may have turned it already.
  const turn = () => {
    void p.orientation(width > height ? 'portrait' : 'landscape').catch(() => undefined);
  };

  // A swipe across turns the page and down ends it — at its own size; made
  // larger, one finger moves around the page instead. A pinch zooms.
  const gesture = useRef({ n, go, leave, zoom, spread: 0 });
  useEffect(() => {
    gesture.current = { ...gesture.current, n, go, leave, zoom };
  }, [n, go, leave, zoom]);
  const responder = useMemo(
    () =>
      // The handlers read the ref on a touch, not while rendering; the
      // compiler cannot see that from here.
      // eslint-disable-next-line react-hooks/refs
      PanResponder.create({
        onMoveShouldSetPanResponder: (_evt, g) =>
          g.numberActiveTouches > 1 || (gesture.current.zoom === 0 && (Math.abs(g.dx) > 20 || Math.abs(g.dy) > 20)),
        onPanResponderGrant: () => {
          gesture.current.spread = 0;
        },
        onPanResponderTerminate: () => {
          gesture.current.spread = 0;
        },
        onPanResponderMove: (evt) => {
          const touches = evt.nativeEvent.touches;
          if (touches.length !== 2) return;
          const [a, b] = touches;
          const spread = Math.hypot((a?.pageX ?? 0) - (b?.pageX ?? 0), (a?.pageY ?? 0) - (b?.pageY ?? 0));
          if (!gesture.current.spread) gesture.current.spread = spread;
          else if (spread / gesture.current.spread > 1.3) {
            gesture.current.spread = spread;
            setZoom((z) => Math.min(ZOOMS.length - 1, z + 1));
          } else if (spread / gesture.current.spread < 0.75) {
            gesture.current.spread = spread;
            setZoom((z) => Math.max(0, z - 1));
          }
        },
        onPanResponderRelease: (_evt, g) => {
          const pinched = gesture.current.spread > 0;
          gesture.current.spread = 0;
          if (pinched || gesture.current.zoom > 0) return;
          if (g.dy > 120 && Math.abs(g.dx) < 60) gesture.current.leave();
          else if (g.dx < -60) gesture.current.go(gesture.current.n + 1);
          else if (g.dx > 60) gesture.current.go(gesture.current.n - 1);
        },
      }),
    [],
  );

  const title = copy && copy !== 'missing' ? (copy.document.title ?? '') : '';
  const scale = ZOOMS[zoom] ?? 1;
  const problem =
    copy === 'missing'
      ? t('show.notKept')
      : copy && copy.pages === 0
        ? t(copy.pending ? 'show.pending' : 'show.noPreview')
        : null;

  const image = uri ? (
    <Image
      source={{ uri }}
      // From memory only: never written to the image cache.
      cachePolicy="none"
      contentFit="contain"
      accessibilityIgnoresInvertColors
      accessibilityLabel={t('show.pageAlt', { n, title })}
      testID="show-image"
      style={{ width: (stage?.w ?? width) * scale, height: (stage?.h ?? height) * scale }}
    />
  ) : null;
  const top = shown ? (
    <View style={[reader ? styles.barInFlow : styles.top, { paddingTop: insets.top + 8 }]}>
      <Text style={styles.dim}>{t('show.hint')}</Text>
      <ShowButton label={t('show.done')} testID="show-done" onPress={leave} strong />
    </View>
  ) : null;
  const bottom = shown ? (
    <View style={[reader ? styles.barInFlow : styles.bottom, styles.row, { paddingBottom: insets.bottom + 8 }]}>
      <ShowButton
        label="‹"
        accessibilityLabel={t('show.previous')}
        disabled={n <= 1}
        onPress={() => go(n - 1)}
        testID="show-previous"
      />
      {pages > 0 ? (
        <Text style={styles.ink} testID="show-page">
          {t('show.page', { n, total: pages })}
        </Text>
      ) : null}
      <ShowButton
        label="›"
        accessibilityLabel={t('show.next')}
        disabled={n >= pages}
        onPress={() => go(n + 1)}
        testID="show-next"
      />
      <ShowButton
        label="−"
        accessibilityLabel={t('show.smaller')}
        disabled={zoom === 0}
        onPress={() => setZoom((z) => Math.max(0, z - 1))}
        testID="show-smaller"
      />
      <ShowButton
        label="+"
        accessibilityLabel={t('show.larger')}
        disabled={zoom === ZOOMS.length - 1}
        onPress={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))}
        testID="show-larger"
      />
      <ShowButton
        label={t('show.rotate')}
        accessibilityHint={t('show.rotateHint')}
        onPress={turn}
        testID="show-rotate"
      />
    </View>
  ) : null;

  return (
    <View
      style={styles.black}
      testID="show-screen"
      onTouchStart={() => {
        setControls(true);
        setTouched((x) => x + 1);
      }}
      {...responder.panHandlers}
    >
      <StatusBar hidden style="light" />
      {reader ? top : null}
      <View
        style={styles.stage}
        onLayout={(e) => setStage({ w: e.nativeEvent.layout.width - 32, h: e.nativeEvent.layout.height - 32 })}
      >
        {problem ? (
          <Text style={styles.ink} testID="show-problem">
            {problem}
          </Text>
        ) : null}
        {zoom > 0 && image ? (
          // Larger than the screen: moved around with a finger.
          <ScrollView horizontal contentContainerStyle={styles.center}>
            <ScrollView contentContainerStyle={styles.center}>{image}</ScrollView>
          </ScrollView>
        ) : (
          image
        )}
      </View>
      {reader ? bottom : null}
      {reader ? null : top}
      {reader ? null : bottom}
    </View>
  );
}

/** A control on black: light, at least 48 dp, and always named. */
function ShowButton(props: {
  label: string;
  onPress: () => void;
  testID: string;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  disabled?: boolean;
  strong?: boolean;
}) {
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      {...(props.accessibilityHint ? { accessibilityHint: props.accessibilityHint } : {})}
      accessibilityState={{ disabled: !!props.disabled }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.button,
        props.strong ? styles.strong : null,
        props.disabled ? styles.disabled : null,
        pressed ? styles.pressed : null,
      ]}
    >
      <Text style={props.strong ? styles.strongInk : styles.ink} weight="600">
        {props.label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  black: { flex: 1, backgroundColor: '#000000' },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  top: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  bottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  row: {
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  /** Pinned (a screen reader is on): beside the page, never over it. */
  barInFlow: {
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  center: { alignItems: 'center', justifyContent: 'center' },
  button: {
    minHeight: 48,
    minWidth: 48,
    paddingHorizontal: 14,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  strong: { backgroundColor: INK },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
  ink: { color: INK },
  strongInk: { color: '#000000' },
  dim: { color: DIM, flex: 1 },
});
