import * as Network from 'expo-network';
import { Platform } from 'react-native';
import type { NetworkKind } from './policy';

/** What kind of network the phone is on, in the policy's terms. */
export async function currentNetwork(): Promise<NetworkKind> {
  if (Platform.OS === 'web') return 'unknown';
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
