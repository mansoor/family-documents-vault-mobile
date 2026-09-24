import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Small secrets: the refresh token, the installation id.
 *
 * On the phone, the OS keystore, readable only while this device is
 * unlocked and never carried to another device (a restored backup starts
 * signed out). On the web build — development and the browser tests only —
 * localStorage.
 */
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

const web = Platform.OS === 'web';

export async function secureGet(key: string): Promise<string | null> {
  if (web) return globalThis.localStorage?.getItem(key) ?? null;
  return SecureStore.getItemAsync(key, OPTIONS);
}

export async function secureSet(key: string, value: string): Promise<void> {
  if (web) {
    globalThis.localStorage?.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value, OPTIONS);
}

export async function secureDelete(key: string): Promise<void> {
  if (web) {
    globalThis.localStorage?.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key, OPTIONS);
}
