import * as Network from 'expo-network';
import { Platform } from 'react-native';
import type { NetworkKind } from './policy';

/**
 * What kind of network the phone is on, in the policy's terms. On Android a
 * VPN over mobile data still says cellular (it is checked first); anything
 * the phone cannot name is 'unknown', which the policy treats as mobile data.
 */
export async function currentNetwork(): Promise<NetworkKind> {
  if (Platform.OS === 'web') return 'browser';
  try {
    const state = await Network.getNetworkStateAsync();
    switch (state.type) {
      case Network.NetworkStateType.WIFI:
        return 'wifi';
      case Network.NetworkStateType.ETHERNET:
        return 'ethernet';
      case Network.NetworkStateType.CELLULAR:
        return 'cellular';
      case Network.NetworkStateType.NONE:
        return 'none';
      default:
        return 'unknown';
    }
  } catch {
    return 'unknown';
  }
}

/**
 * Whether the network reaches the internet (Android says so once it has
 * checked): false behind a Wi-Fi sign-in page. Null when it cannot say.
 */
export async function internetReachable(): Promise<boolean | null> {
  if (Platform.OS === 'web') return null;
  try {
    const state = await Network.getNetworkStateAsync();
    return state.isInternetReachable ?? null;
  } catch {
    return null;
  }
}

/**
 * Why an https request fails, in the platform's words (4.15): expo/fetch
 * passes the error on (the certificate's trouble among it), where the
 * phone's own fetch says only "Network request failed". Null when it goes
 * through, or on the web.
 */
export async function whyFailed(url: string): Promise<unknown> {
  if (Platform.OS === 'web') return null;
  // Loaded when first used: it is native code.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { fetch } = require('expo/fetch') as typeof import('expo/fetch');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    await fetch(url, { signal: controller.signal });
    return null;
  } catch (err) {
    return err;
  } finally {
    clearTimeout(timer);
  }
}

/** Calls back whenever the phone's network changes; returns the unsubscribe. */
export function onNetworkChange(callback: () => void): () => void {
  if (Platform.OS === 'web') {
    const w = globalThis as unknown as {
      addEventListener?: (type: string, fn: () => void) => void;
      removeEventListener?: (type: string, fn: () => void) => void;
    };
    const fn = () => callback();
    w.addEventListener?.('online', fn);
    w.addEventListener?.('offline', fn);
    return () => {
      w.removeEventListener?.('online', fn);
      w.removeEventListener?.('offline', fn);
    };
  }
  const subscription = Network.addNetworkStateListener(() => callback());
  return () => subscription.remove();
}
