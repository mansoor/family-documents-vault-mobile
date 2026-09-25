import { colours } from '@fdv/shared';
import { Lock } from 'lucide-react-native';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, BackHandler, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLock } from '../state/lock';
import { Button, Notice, Text } from '../ui';

/**
 * What the app shows while it is locked, and nothing else: no screen of the
 * app is behind it to be revealed. Back leaves the app.
 */
export function LockScreen() {
  const { t } = useTranslation();
  const lock = useLock();
  const { exitApp, unlock, lockedFor } = lock;
  // After Show mode the phone may still be in a clerk's hand: no prompt of
  // its own; the person it belongs to taps Unlock.
  const autoPrompt = lock.autoPrompt && lockedFor !== 'show';
  const asked = useRef(false);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      exitApp();
      return true;
    });
    return () => sub.remove();
  }, [exitApp]);

  // Straight to the phone's own prompt, once, when the app is in front —
  // never while it is going to the back ("Immediately" locks as it leaves),
  // where the prompt can hang. After that, the button.
  useEffect(() => {
    if (!autoPrompt || asked.current) return;
    const ask = () => {
      if (asked.current) return;
      asked.current = true;
      void unlock();
    };
    if (AppState.currentState === 'active') {
      ask();
      return;
    }
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') ask();
    });
    return () => sub.remove();
  }, [autoPrompt, unlock]);

  return (
    <SafeAreaView style={styles.page} testID="lock-screen">
      <View style={styles.body}>
        <Lock size={40} color={colours.accent} accessibilityElementsHidden importantForAccessibility="no" />
        <Text variant="screen">{t('lock.title')}</Text>
        {lockedFor === 'show' ? <Text testID="lock-after-show">{t('show.carryOn')}</Text> : null}
        {lock.tooManyTries ? (
          <Notice tone="warn" testID="lock-too-many" announce={t('lock.tooMany')}>
            {t('lock.tooMany')}
          </Notice>
        ) : null}
        <Button testID="lock-unlock" label={t('lock.unlock')} onPress={() => void unlock()} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colours.bg },
  body: { flex: 1, justifyContent: 'center', padding: 24, gap: 20, alignItems: 'stretch' },
});
