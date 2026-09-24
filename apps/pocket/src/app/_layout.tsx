import { colours } from '@fdv/shared';
import Constants from 'expo-constants';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

const extra = (Constants.expoConfig?.extra ?? {}) as { testBanner?: boolean; variant?: string };

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

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <View style={styles.root}>
        {extra.testBanner ? <TestBanner /> : null}
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colours.bg },
            headerTitleStyle: { color: colours.ink },
            contentStyle: { backgroundColor: colours.bg },
          }}
        >
          <Stack.Screen name="index" options={{ title: 'Scanner spike' }} />
          <Stack.Screen name="probes" options={{ title: 'Probes' }} />
        </Stack>
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colours.bg },
  banner: { backgroundColor: colours.warn },
  bannerText: {
    color: colours.onAccent,
    fontWeight: '700',
    textAlign: 'center',
    paddingVertical: 4,
    fontSize: 13,
  },
});
