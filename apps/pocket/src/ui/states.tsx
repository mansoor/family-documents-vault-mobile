import { ApiRequestError, isSessionOver } from '@fdv/client';
import { radii } from '@fdv/shared';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { wordsFor } from '../errors/words';
import { log } from '../log';
import { noConnection } from '../net/no-connection';
import { Button, Notice, Text } from './index';
import { sp } from './space';
import { useStyles, type Palette } from './theme';

/**
 * What a screen shows while it loads, and when it could not (P5). Before
 * this, a list showed nothing at all while it loaded, and a failure that
 * was not the connection was dropped without a word: the same hiding the
 * queue had before 0.3.3.
 *
 * - No connection, or a vault the phone may not reach here: the screen's
 *   own offline notice says so, as before; nothing more here.
 * - Signed out: the sign-in screen takes over.
 * - Anything else: "Couldn't load this", or the vault's own words for its
 *   answer, with Try again; and the log is told what kind of failure it
 *   was, never its words, which could quote a document.
 */
export function loadFailure(screen: string, err: unknown, t: TFunction): string | null {
  if (noConnection(err)) return null;
  if (isSessionOver(err) || (err instanceof ApiRequestError && err.status === 401)) return null;
  const kind = err instanceof ApiRequestError ? err.code : err instanceof Error ? err.name : typeof err;
  log.error(`${screen}.load_failed`, { kind });
  return err instanceof ApiRequestError ? wordsFor(err, t, 'states.loadFailed') : t('states.loadFailed');
}

/** "Couldn't load this", with Try again. */
export function LoadFailed(props: { words: string; onRetry: () => void; testID?: string }) {
  const { t } = useTranslation();
  return (
    <Notice tone="warn" testID={props.testID ?? 'load-failed'} announce={props.words}>
      <Text>{props.words}</Text>
      <Button kind="quiet" label={t('common.tryAgain')} onPress={props.onRetry} testID="load-failed-retry" />
    </Notice>
  );
}

/**
 * Rows the shape of what is coming, while it comes: still, so nothing moves
 * for somebody who asked their phone for less motion, and said once to a
 * screen reader as loading.
 */
export function Placeholder(props: { rows?: number; testID?: string }) {
  const { t } = useTranslation();
  const styles = useStyles(makeStyles);
  const rows = Array.from({ length: props.rows ?? 3 }, (_, i) => i);
  return (
    <View
      testID={props.testID ?? 'loading'}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t('common.loading')}
      accessibilityLiveRegion="polite"
      style={styles.rows}
    >
      {rows.map((i) => (
        <View key={i} style={styles.row} importantForAccessibility="no-hide-descendants">
          <View style={styles.tile} />
          <View style={styles.words}>
            <View style={[styles.bar, { width: `${70 - i * 12}%` }]} />
            <View style={[styles.bar, styles.short]} />
          </View>
        </View>
      ))}
    </View>
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    rows: { gap: sp(8) },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: sp(12),
      padding: sp(10),
      minHeight: 72,
      borderRadius: radii.l,
      borderWidth: 1,
      borderColor: colours.border,
      backgroundColor: colours.surface,
    },
    tile: { width: 48, height: 64, borderRadius: radii.s, backgroundColor: colours.border },
    words: { flex: 1, gap: sp(8) },
    bar: { height: 12, borderRadius: radii.pill, backgroundColor: colours.border },
    short: { width: '40%' },
  });
