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
