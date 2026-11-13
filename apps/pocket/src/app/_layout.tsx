// First: the shared client's uploads need Web Crypto's random numbers, which Hermes lacks.
import '../platform/web-crypto';
import '../i18n';

import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { extra, SPIKE } from '../config';
import { LockGate } from '../lock/gate';
import { AttentionProvider } from '../state/attention';
import { CaptureProvider } from '../state/capture';
import { saveCopyIo } from '../documents/save-copy';
import { watchHttpCache } from '../net/http-cache';
import { recoverBrightness } from '../show/brightness';
import { defaultShowPlatform } from '../show/platform';
import { PushLinks } from '../push/links';
import { PushProvider } from '../push/push';
import { EssentialsProvider, useEssentials } from '../state/essentials';
import { LockProvider, useLock } from '../state/lock';
import { StepUpProvider } from '../state/step-up';
import { useVault, VaultProvider } from '../state/vault';
import { headerFor, type HeaderOptions } from '../ui/app-header';
import { font } from '../ui/fonts';
import { TextScaleProvider, useTextScale } from '../ui/text-scale';
import { WEB_FONTS } from '../ui/web-fonts';
import { sp } from '../ui/space';
import { ThemeProvider, useColours, useStyles, useTheme, type Palette } from '../ui/theme';
import { useReduceMotion } from '../ui/feel';
import { FamilyTimeProvider } from '../state/family-time';

/**
 * Preview builds say so on every screen: they point at throwaway vaults
 * only. Read out once as words, not as a heading — TalkBack's headings are
 * each screen's own (P10) — and as large as the app's Large text.
 */
function TestBanner() {
  const styles = useStyles(makeStyles);
  const { t } = useTranslation();
  const { scale } = useTextScale();
  return (
    <SafeAreaView edges={['top']} style={styles.banner}>
      <Text
        style={[styles.bannerText, { fontSize: 13 * scale }]}
        accessibilityRole="text"
        accessibilityLabel={t('common.testBuildSaid')}
      >
        {t('common.testBuild')}
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
  const colours = useColours();
  const styles = useStyles(makeStyles);
  const { phase } = useVault();
  const { status } = useLock();
  const { keptWhileSignedOut } = useEssentials();
  const { t } = useTranslation();
  // Remove animations (P10): one screen gives way to the next at once.
  const still = useReduceMotion();
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
        headerTitleStyle: { color: colours.ink, ...font('600') },
        // Back and any other header button, in the theme in use (P4).
        headerTintColor: colours.ink,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colours.bg },
        // The vault's bar at the top of every page, the page's title and buttons below it
        // (the owner's ask of 11 Nov 2026): no back arrow, Android's back goes back.
        header: ({ options }) => headerFor(options as HeaderOptions),
        ...(still ? { animation: 'none' as const } : {}),
      }}
    >
      <Stack.Protected guard={phase === 'ready'}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false, title: t('tabs.home') }} />
        {/* A ← before its ✎ and ⋯ (the owner's ask of 12 Nov 2026): a document's page and a note's. */}
        <Stack.Screen name="document/[id]" options={{ title: '', headerBackVisible: true }} />
        <Stack.Screen name="edit/[id]" options={{ title: '', headerShown: false }} />
        {/* Its title is its page's, with the + beside it, as Notes': no bar above it (the owner's ask of 11 Nov 2026). */}
        <Stack.Screen name="collections" options={{ title: t('collections.title'), headerTitle: '' }} />
        <Stack.Screen name="trash" options={{ title: t('trashList.title') }} />
        <Stack.Screen name="sharing" options={{ title: t('sharing.title') }} />
        <Stack.Screen name="collection/[id]" options={{ title: '', headerBackVisible: true }} />
        <Stack.Screen name="new-note" options={{ title: '', headerShown: false }} />
        <Stack.Screen name="person/[id]" options={{ title: '' }} />
        <Stack.Screen name="attention" options={{ title: t('attention.title') }} />
        <Stack.Screen name="account" options={{ title: t('more.account') }} />
        <Stack.Screen name="capture" options={{ title: '', gestureEnabled: false, headerShown: false }} />
        <Stack.Screen name="settings" options={{ title: t('settings.title') }} />
        <Stack.Screen name="licences" options={{ title: t('settings.licences') }} />
        <Stack.Screen name="timings" options={{ title: t('timings.title') }} />
      </Stack.Protected>
      <Stack.Protected guard={reading}>
        <Stack.Screen name="essential/[id]" options={{ title: '', headerShown: false }} />
        <Stack.Screen name="show/[id]" options={{ headerShown: false, animation: still ? 'none' : 'fade', gestureEnabled: false }} />
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

/**
 * What the phone's HTTP stack kept of the vault goes at launch — before the
 * first request, as a child's effects run before its providers' — and again
 * whenever a session ends here.
 */
function ForgetHttpCache() {
  useEffect(() => watchHttpCache(), []);
  return null;
}

/** A brightness Show mode left behind (the app stopped while showing) goes back at launch. */
function ShowRecovery() {
  useEffect(() => {
    try {
      void recoverBrightness(defaultShowPlatform());
    } catch {
      // Never in the way of the app starting.
    }
    // A copy being saved when the app stopped (4.12) does not stay behind.
    void saveCopyIo.sweep().catch(() => undefined);
  }, []);
  return null;
}

// Gesture Handler sees touches only under its root view (0.7.1: the pages'
// swipe and pinch), so it holds everything.
export default function RootLayout() {
  return (
    <GestureHandlerRootView style={fill.root}>
      <ThemeProvider>
        <Root />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

const fill = StyleSheet.create({ root: { flex: 1 } });

/**
 * The window behind every screen, and the bars the system draws over it,
 * in the theme in use (P4): no white flash between screens in the dark.
 */
function SystemColours() {
  const colours = useColours();
  const { scheme } = useTheme();
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colours.bg).catch(() => undefined);
  }, [colours.bg]);
  return <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />;
}

function Root() {
  const styles = useStyles(makeStyles);
  // The web build draws nothing until its typefaces are in; a phone has
  // them embedded, and asks for none.
  const [fontsReady, fontsFailed] = useFonts(WEB_FONTS);
  const drawn = fontsReady || fontsFailed !== null;
  return (
    <SafeAreaProvider>
      <SystemColours />
      <TextScaleProvider>
        <VaultProvider>
          <FamilyTimeProvider>
            <LockProvider>
              <EssentialsProvider>
                <CaptureProvider>
                  <AttentionProvider>
                  <PushProvider>
                    <StepUpProvider>
                      <View style={styles.root}>
                        {drawn ? null : <View style={styles.loading} />}
                        <ForgetHttpCache />
                        <ShowRecovery />
                        <PushLinks />
                        {extra.testBanner ? <TestBanner /> : null}
                        {drawn ? (
                          <LockGate>
                            <Gates />
                          </LockGate>
                        ) : null}
                      </View>
                    </StepUpProvider>
                  </PushProvider>
                  </AttentionProvider>
                </CaptureProvider>
              </EssentialsProvider>
            </LockProvider>
          </FamilyTimeProvider>
        </VaultProvider>
      </TextScaleProvider>
    </SafeAreaProvider>
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colours.bg },
    loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colours.bg },
    banner: { backgroundColor: colours.warn },
    bannerText: {
      color: colours.onAccent,
      ...font('700'),
      textAlign: 'center',
      paddingVertical: sp(4),
      fontSize: 13,
    },
  });
