import '../i18n';
import { colours } from '@fdv/shared';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { extra, SPIKE } from '../config';
import { LockGate } from '../lock/gate';
import { CaptureProvider } from '../state/capture';
import { EssentialsProvider, useEssentials } from '../state/essentials';
import { LockProvider, useLock } from '../state/lock';
import { useVault, VaultProvider } from '../state/vault';
import { TextScaleProvider } from '../ui/text-scale';

/** Preview builds say so on every screen: they point at throwaway vaults only. */
function TestBanner() {
  return (
    <SafeAreaView edges={['top']} style={styles.banner}>
      <Text style={styles.bannerText} accessibilityRole="header">
        TEST BUILD — for throwaway vaults only
      </Text>
    </SafeAreaView>
  );
}

/**
 * What can be reached depends on where things stand: no vault yet —
 * Connect; a vault but nobody signed in — Sign in; otherwise Home and the
 * rest. Anything else is not on the stack at all.
 */
function Gates() {
  const { phase } = useVault();
  const { status } = useLock();
  const { keptWhileSignedOut } = useEssentials();
  const { t } = useTranslation();
  // A kept Essential opens signed in, or — after the session expired — from
  // sign-in while the lock is open; locking again takes it off the stack.
  const reading = phase === 'ready' || (phase === 'sign_in' && keptWhileSignedOut && status === 'unlocked');
  if (phase === 'loading' || (phase === 'ready' && status === 'checking')) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colours.accent} accessibilityLabel={t('common.working')} />
      </View>
    );
  }
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colours.bg },
        headerTitleStyle: { color: colours.ink },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colours.bg },
      }}
    >
      <Stack.Protected guard={phase === 'ready'}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="capture" options={{ title: '', gestureEnabled: false }} />
        <Stack.Screen name="settings" options={{ title: t('settings.title') }} />
        <Stack.Screen name="timings" options={{ title: t('timings.title') }} />
      </Stack.Protected>
      <Stack.Protected guard={reading}>
        <Stack.Screen name="essential/[id]" options={{ title: '' }} />
      </Stack.Protected>
      <Stack.Protected guard={phase === 'sign_in'}>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={phase === 'connect'}>
        <Stack.Screen name="connect" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={SPIKE}>
        <Stack.Screen name="spike/index" options={{ title: 'Scanner spike' }} />
        <Stack.Screen name="spike/probes" options={{ title: 'Probes' }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <TextScaleProvider>
        <VaultProvider>
          <LockProvider>
            <EssentialsProvider>
              <CaptureProvider>
                <View style={styles.root}>
                  {extra.testBanner ? <TestBanner /> : null}
                  <LockGate>
                    <Gates />
                  </LockGate>
                </View>
              </CaptureProvider>
            </EssentialsProvider>
          </LockProvider>
        </VaultProvider>
      </TextScaleProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colours.bg },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colours.bg },
  banner: { backgroundColor: colours.warn },
  bannerText: {
    color: colours.onAccent,
    fontWeight: '700',
    textAlign: 'center',
    paddingVertical: 4,
    fontSize: 13,
  },
});
