import { colours } from '@fdv/shared';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLock } from '../state/lock';
import { useVault } from '../state/vault';
import { LockScreen } from './lock-screen';

/**
 * What the lock allows on screen: while locked, the lock screen and nothing
 * else — no screen of the app behind it; while the app is away, the app
 * covered, so coming back never shows the last screen before the lock has
 * decided. The app stays mounted under the cover: back within the time,
 * the person is where they were.
 */
export function LockGate(props: { children: ReactNode }) {
  const { phase } = useVault();
  const { status, covered, lockedFor } = useLock();
  // After Show mode, the lock screen whatever the phase: signed out (an
  // expired session's kept copies), the sign-in screen is not for whoever
  // is holding the phone.
  if (status === 'locked' && (phase === 'ready' || lockedFor === 'show')) return <LockScreen />;
  return (
    <View style={styles.root}>
      {props.children}
      {/* Covered only ever while open: signed in, or reading what is kept. */}
      {covered ? <View testID="lock-cover" style={styles.cover} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  cover: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colours.bg },
});
