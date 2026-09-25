import { colours, whenWords } from '@fdv/shared';
import { Image } from 'expo-image';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PanResponder, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { openOnline } from '../documents/online';
import { useEssentials, type OpenCopy } from '../state/essentials';
import { useScreenGuard } from '../state/lock';
import { useStepUp } from '../state/step-up';
import { useVault } from '../state/vault';
import { Button, Notice, StatusLine, Text } from '../ui';

const ZOOMS = [1, 1.5, 2, 3];

/**
 * A kept Essential, from the phone (4.10): its pages as the vault drew
 * them, straight from the encrypted store into memory — nothing of it is
 * written out as a file, and nothing is cached. Buttons move between pages
 * and zoom; so do a swipe and a pinch. Never captured.
 */
export function EssentialPages(props: { id: string; mode?: string; online?: boolean }) {
  const { id, mode, online } = props;
  const { t } = useTranslation();
  const e = useEssentials();
  const { offline, withToken } = useVault();
  const { guarded } = useStepUp();
  const { width, height } = useWindowDimensions();
  useScreenGuard('viewer');

  const [copy, setCopy] = useState<OpenCopy | 'missing' | 'unconfirmed' | 'failed' | null>(null);
  const [n, setN] = useState(1);
  const [uri, setUri] = useState<string | null>(null);
  const [pageProblem, setPageProblem] = useState<'unconfirmed' | 'failed' | null>(null);
  const [zoom, setZoom] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const opened = useRef(-1);
  const { open } = e;

  // Opened once (again on Try again): the vault is told about each opening.
  useEffect(() => {
    if (opened.current === attempt || !id) return;
    opened.current = attempt;
    // Not kept on the phone (4.12): from the vault, confirming it is you if it asks.
    const load = online ? openOnline(withToken, guarded, id) : open(id, mode === 'show' ? 'show' : 'view');
    void load
      .then((c) => setCopy(c ?? (online ? 'failed' : 'missing')))
      .catch(() => setCopy(online ? 'failed' : 'missing'));
  }, [id, mode, open, online, withToken, guarded, attempt]);

  const ready = copy && typeof copy === 'object' ? copy : null;
  useEffect(() => {
    if (!ready || ready.pages === 0) return;
    let cancelled = false;
    ready
      .page(n)
      .then((u) => {
        if (cancelled) return;
        setUri(u);
        // From the vault, a page is null only when it was not confirmed.
        setPageProblem(u === null && online ? 'unconfirmed' : null);
      })
      .catch(() => {
        if (!cancelled) setPageProblem('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [ready, n, online, attempt]);

  const again = () => {
    setPageProblem(null);
    if (!ready) setCopy(null);
    setAttempt((x) => x + 1);
  };
  const problem =
    copy === 'unconfirmed' || pageProblem === 'unconfirmed'
      ? t('document.notConfirmed')
      : copy === 'failed' || pageProblem === 'failed'
        ? t('document.pageFailed')
        : null;
  const pages = ready ? ready.pages : 0;
  const go = (to: number) => {
    if (to < 1 || to > pages) return;
    setUri(null);
    setN(to);
  };

  // A swipe turns the page (at its own size); a pinch makes it larger or smaller.
  const gesture = useRef({ n, pages, zoom, spread: 0 });
  useEffect(() => {
    gesture.current = { ...gesture.current, n, pages, zoom };
  }, [n, pages, zoom]);
  const responder = useMemo(
    () =>
      // The handlers read the ref on a touch, not while rendering; the
      // compiler cannot see that from here.
      // eslint-disable-next-line react-hooks/refs
      PanResponder.create({
        onMoveShouldSetPanResponder: (_evt, g) => Math.abs(g.dx) > 20 || g.numberActiveTouches > 1,
        onPanResponderMove: (evt) => {
          const touches = evt.nativeEvent.touches;
          if (touches.length === 2) {
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
          }
        },
        onPanResponderRelease: (_evt, g) => {
          const pinched = gesture.current.spread !== 0;
          gesture.current.spread = 0;
          if (pinched || gesture.current.zoom !== 0) return;
          if (g.dx < -60) go(gesture.current.n + 1);
          else if (g.dx > 60) go(gesture.current.n - 1);
        },
      }),
    // go reads gesture.current; nothing else changes the responder.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const title = ready ? (ready.document.title ?? t('essentials.untitled')) : '';
  const pageWidth = (width - 32) * (ZOOMS[zoom] ?? 1);

  return (
    <View style={styles.page} testID="essential-viewer">
      {offline && e.checked ? (
        <Notice tone="warn" testID="essential-offline">
          {t('essentials.offlineBanner', { when: whenWords(new Date(e.checked.at).toISOString()) })}
        </Notice>
      ) : null}
      {copy === 'missing' ? <Notice tone="warn">{t('essentials.notKept')}</Notice> : null}
      {problem ? (
        <Notice tone="warn" testID="essential-problem">
          <Text>{problem}</Text>
          <Button kind="quiet" label={t('document.tryAgain')} onPress={again} testID="essential-try-again" />
        </Notice>
      ) : null}
      {ready && pages === 0 ? (
        <Notice tone="info" testID={ready.pending ? 'essential-pending' : 'essential-no-preview'}>
          {t(
            ready.pending
              ? online
                ? 'document.pending'
                : 'essentials.pending'
              : online
                ? 'document.noPreview'
                : 'essentials.noPreview',
          )}
        </Notice>
      ) : null}
      {pages > 0 ? (
        <>
          <Text variant="title">{title}</Text>
          {/* Worked out for today on the phone: the vault's may be days old. */}
          {ready?.status ? <StatusLine status={ready.status} /> : null}
          <View style={styles.tools}>
            <Button
              kind="quiet"
              label="‹"
              accessibilityLabel={t('essentials.previous')}
              disabled={n <= 1}
              onPress={() => go(n - 1)}
              testID="essential-previous"
            />
            <Text testID="essential-page">{t('essentials.page', { n, total: pages })}</Text>
            <Button
              kind="quiet"
              label="›"
              accessibilityLabel={t('essentials.next')}
              disabled={n >= pages}
              onPress={() => go(n + 1)}
              testID="essential-next"
            />
            <View style={styles.gap} />
            <Button
              kind="quiet"
              label="−"
              accessibilityLabel={t('essentials.smaller')}
              disabled={zoom === 0}
              onPress={() => setZoom((z) => Math.max(0, z - 1))}
              testID="essential-smaller"
            />
            <Button
              kind="quiet"
              label="+"
              accessibilityLabel={t('essentials.larger')}
              disabled={zoom === ZOOMS.length - 1}
              onPress={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))}
              testID="essential-larger"
            />
          </View>
          <View style={styles.frame} {...responder.panHandlers}>
            <ScrollView horizontal={zoom > 0} scrollEnabled={zoom > 0} contentContainerStyle={styles.center}>
              <ScrollView scrollEnabled={zoom > 0} contentContainerStyle={styles.center}>
                {uri ? (
                  <Image
                    source={{ uri }}
                    // From memory only: never written to the image cache.
                    cachePolicy="none"
                    contentFit="contain"
                    accessibilityIgnoresInvertColors
                    accessibilityLabel={t('essentials.pageAlt', { n, title })}
                    testID="essential-image"
                    style={{ width: pageWidth, height: zoom > 0 ? pageWidth * 1.3 : height * 0.62 }}
                  />
                ) : null}
              </ScrollView>
            </ScrollView>
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 16, gap: 12, backgroundColor: colours.bg },
  tools: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  gap: { flex: 1 },
  frame: { flex: 1, borderRadius: 12, backgroundColor: colours.surface, overflow: 'hidden' },
  center: { alignItems: 'center', justifyContent: 'center', flexGrow: 1 },
});
