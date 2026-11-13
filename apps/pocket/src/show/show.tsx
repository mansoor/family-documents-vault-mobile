import { radii } from '@fdv/shared';
import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, BackHandler, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEssentials, type OpenCopy } from '../state/essentials';
import { useLock, useScreenGuard } from '../state/lock';
import { Text } from '../ui';
import { PageZoom } from '../ui/page-zoom';
import { atOwnSize, MAX_ZOOM, MIN_ZOOM, stepZoom } from '../ui/zoom';
import { brighten, restoreBrightness } from './brightness';
import { takeForShow } from './handoff';
import { defaultShowPlatform, type ShowPlatform } from './platform';
import { sp } from '../ui/space';

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
  /** Not kept on the phone: the pages the Document screen fetched (and confirmed) first (4.12). */
  online?: boolean;
  platform?: ShowPlatform;
  /** Tests only: shorter than ten minutes and three seconds. */
  showForMs?: number;
  controlsForMs?: number;
}) {
  const { id, onLeave } = props;
  const { t } = useTranslation();
  const { open } = useEssentials();
  const { online } = props;
  const { lockNow } = useLock();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const p = useMemo(() => props.platform ?? defaultShowPlatform(), [props.platform]);
  useScreenGuard('show');

  const [copy, setCopy] = useState<OpenCopy | 'missing' | null>(null);
  const [n, setN] = useState(1);
  const [uri, setUri] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number>(MIN_ZOOM);
  const [aspect, setAspect] = useState<number | undefined>(undefined);
  const [controls, setControls] = useState(true);
  const [touched, setTouched] = useState(0);
  const [reader, setReader] = useState(false);
  const opened = useRef(false);
  const left = useRef(false);

  // Opened once, as a show: the vault is told.
  useEffect(() => {
    if (opened.current || !id) return;
    opened.current = true;
    const load = online ? Promise.resolve(takeForShow(id)) : open(id, 'show');
    void load.then((c) => setCopy(c ?? 'missing')).catch(() => setCopy('missing'));
  }, [id, open, online]);

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
      // Another page starts at its own size.
      setUri(null);
      setAspect(undefined);
      setZoom(MIN_ZOOM);
      setN(to);
    },
    [pages],
  );
  // Turned from however it is now: the phone may have turned it already.
  const turn = () => {
    void p.orientation(width > height ? 'portrait' : 'landscape').catch(() => undefined);
  };

  // A swipe across turns the page and down ends it — at its own size; made
  // larger, one finger moves around the page instead. A pinch zooms, and a
  // double tap (0.7.1: on Gesture Handler, as the Pages viewer).
  const ownSize = atOwnSize(zoom);

  const title = copy && copy !== 'missing' ? (copy.document.title ?? '') : '';
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
      onLoad={(e) => setAspect(e.source.height > 0 ? e.source.width / e.source.height : undefined)}
      style={styles.image}
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
        disabled={ownSize}
        onPress={() => setZoom((z) => stepZoom(z, -1))}
        testID="show-smaller"
      />
      <ShowButton
        label="+"
        accessibilityLabel={t('show.larger')}
        disabled={zoom >= MAX_ZOOM - 0.01}
        onPress={() => setZoom((z) => stepZoom(z, 1))}
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
    >
      <StatusBar hidden style="light" />
      {reader ? top : null}
      <View style={styles.stage}>
        {problem ? (
          <Text style={styles.ink} testID="show-problem">
            {problem}
          </Text>
        ) : null}
        {problem ? null : (
          <PageZoom
            level={zoom}
            onLevel={setZoom}
            page={n}
            canPrevious={n > 1}
            canNext={n < pages}
            onTurn={(d) => go(n + d)}
            onSwipeDown={leave}
            {...(aspect ? { aspect } : {})}
            testID="show-zoom"
            style={styles.zoom}
          >
            {image}
          </PageZoom>
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
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: sp(16) },
  top: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: sp(16),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: sp(12),
  },
  bottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  row: {
    paddingHorizontal: sp(12),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: sp(8),
    flexWrap: 'wrap',
  },
  /** Pinned (a screen reader is on): beside the page, never over it. */
  barInFlow: {
    paddingHorizontal: sp(16),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: sp(12),
  },
  zoom: { alignSelf: 'stretch' },
  image: { width: '100%', height: '100%' },
  button: {
    minHeight: 48,
    minWidth: 48,
    paddingHorizontal: sp(14),
    borderRadius: radii.pill,
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
