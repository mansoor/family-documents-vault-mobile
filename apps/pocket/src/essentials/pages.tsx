import { Minimize2, X } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { radii } from '@fdv/shared';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { openOnline } from '../documents/online';
import { useEssentials, type OpenCopy } from '../state/essentials';
import { useScreenGuard } from '../state/lock';
import { useStepUp } from '../state/step-up';
import { useVault } from '../state/vault';
import { Button, Notice, StatusLine, Text } from '../ui';
import { IconButton } from '../ui/icon-button';
import { sp } from '../ui/space';
import { PageZoom } from '../ui/page-zoom';
import { useColours, useStyles, type Palette } from '../ui/theme';
import { atOwnSize, MAX_ZOOM, MIN_ZOOM, stepZoom } from '../ui/zoom';
import { relativeWords, useFamilyZone } from '../state/family-time';

/**
 * A kept Essential, from the phone (4.10): its pages as the vault drew
 * them, straight from the encrypted store into memory — nothing of it is
 * written out as a file, and nothing is cached. Buttons move between pages
 * and zoom; so do a swipe, a pinch and a double tap (0.7.1: on Gesture
 * Handler, which a real phone hands the touches to). Never captured.
 */
export function EssentialPages(props: { id: string; mode?: string; online?: boolean; version?: string }) {
  const router = useRouter();
  // Closed: back where it was opened from; opened on its own, Home.
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const styles = useStyles(makeStyles);
  const colours = useColours();
  const { id, mode, online, version } = props;
  const { t } = useTranslation();
  const zone = useFamilyZone();
  const e = useEssentials();
  const { offline, withToken } = useVault();
  const { guarded } = useStepUp();
  useScreenGuard('viewer');

  const [copy, setCopy] = useState<OpenCopy | 'missing' | 'unconfirmed' | 'failed' | null>(null);
  const [n, setN] = useState(1);
  const [uri, setUri] = useState<string | null>(null);
  const [pageProblem, setPageProblem] = useState<'unconfirmed' | 'failed' | null>(null);
  const [zoom, setZoom] = useState<number>(MIN_ZOOM);
  const [aspect, setAspect] = useState<number | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  const opened = useRef(-1);
  const { open } = e;

  // Opened once (again on Try again): the vault is told about each opening.
  useEffect(() => {
    if (opened.current === attempt || !id) return;
    opened.current = attempt;
    // Not kept on the phone (4.12): from the vault, confirming it is you if it asks.
    const load = online ? openOnline(withToken, guarded, id, version) : open(id, mode === 'show' ? 'show' : 'view');
    void load
      .then((c) => setCopy(c ?? (online ? 'failed' : 'missing')))
      .catch(() => setCopy(online ? 'failed' : 'missing'));
  }, [id, mode, open, online, version, withToken, guarded, attempt]);

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
  // Another page starts at its own size.
  const go = (to: number) => {
    if (to < 1 || to > pages) return;
    setUri(null);
    setAspect(undefined);
    setZoom(MIN_ZOOM);
    setN(to);
  };

  const title = ready ? (ready.document.title ?? t('essentials.untitled')) : '';
  // Larger or smaller with the fingers or the buttons, one zoom between
  // them; Fit page goes back to the page's own size.
  const ownSize = atOwnSize(zoom);

  return (
    <View style={styles.page} testID="essential-viewer">
      {/* Its name, and ✕ in the corner the screen left empty (the owner's ask of 12 Nov 2026). */}
      <View style={styles.top}>
        <Text variant="title" style={styles.flex} numberOfLines={2}>
          {pages > 0 ? title : ''}
        </Text>
        <IconButton testID="essential-close" label={t('essentials.close')} icon={X} onPress={close} />
      </View>
      {offline && e.checked ? (
        <Notice tone="warn" testID="essential-offline">
          {t('essentials.offlineBanner', { when: relativeWords(new Date(e.checked.at).toISOString(), zone) })}
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
            {/* Back to the whole page in one tap (the owner's ask of 13 Nov 2026). */}
            <Pressable
              testID="essential-fit"
              accessibilityRole="button"
              accessibilityLabel={t('essentials.fit')}
              accessibilityState={{ disabled: ownSize }}
              disabled={ownSize}
              onPress={() => setZoom(MIN_ZOOM)}
              style={({ pressed }) => [
                styles.fit,
                ownSize ? styles.disabled : null,
                pressed ? styles.pressed : null,
              ]}
            >
              <Minimize2 color={colours.ink} size={20} accessibilityElementsHidden importantForAccessibility="no" />
            </Pressable>
            <View style={styles.gap} />
            <Button
              kind="quiet"
              label="−"
              accessibilityLabel={t('essentials.smaller')}
              disabled={ownSize}
              onPress={() => setZoom((z) => stepZoom(z, -1))}
              testID="essential-smaller"
            />
            <Button
              kind="quiet"
              label="+"
              accessibilityLabel={t('essentials.larger')}
              disabled={zoom >= MAX_ZOOM - 0.01}
              onPress={() => setZoom((z) => stepZoom(z, 1))}
              testID="essential-larger"
            />
          </View>
          <View style={styles.frame}>
            <PageZoom
              level={zoom}
              onLevel={setZoom}
              page={n}
              canPrevious={n > 1}
              canNext={n < pages}
              onTurn={(d) => go(n + d)}
              {...(aspect ? { aspect } : {})}
              testID="essential-zoom"
            >
              {uri ? (
                <Image
                  source={{ uri }}
                  // From memory only: never written to the image cache.
                  cachePolicy="none"
                  contentFit="contain"
                  accessibilityIgnoresInvertColors
                  accessibilityLabel={t('essentials.pageAlt', { n, title })}
                  testID="essential-image"
                  onLoad={(e) => setAspect(e.source.height > 0 ? e.source.width / e.source.height : undefined)}
                  style={styles.image}
                />
              ) : null}
            </PageZoom>
          </View>
        </>
      ) : null}
    </View>
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    page: { flex: 1, padding: sp(16), gap: sp(12), backgroundColor: colours.bg },
    top: { flexDirection: 'row', alignItems: 'center', gap: sp(8) },
    flex: { flex: 1 },
    tools: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: sp(8) },
    gap: { flex: 1 },
    frame: { flex: 1, borderRadius: radii.m, backgroundColor: colours.paper, overflow: 'hidden' },
    image: { width: '100%', height: '100%' },
    fit: {
      width: 48,
      height: 48,
      borderRadius: radii.m,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colours.surface,
      borderWidth: 1,
      borderColor: colours.borderInput,
    },
    disabled: { opacity: 0.5 },
    pressed: { opacity: 0.85 },
  });
