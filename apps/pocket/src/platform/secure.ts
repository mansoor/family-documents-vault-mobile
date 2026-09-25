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

/**
 * A secret behind the phone's strong biometrics (4.8): no PIN instead, and
 * gone for good when a fingerprint or face is added or changed — reading it
 * then gives null. Reading or writing asks; declining throws. Only on the
 * phone: the web build has none, and says so with canUseStrongBiometrics.
 */
const guarded = (prompt: string): SecureStore.SecureStoreOptions => ({
  ...OPTIONS,
  requireAuthentication: true,
  authenticationPrompt: prompt,
});

export function canUseStrongBiometrics(): boolean {
  if (web) return false;
  try {
    return SecureStore.canUseBiometricAuthentication();
  } catch {
    return false;
  }
}

export async function secureGetGuarded(key: string, prompt: string): Promise<string | null> {
  if (web) return null;
  return SecureStore.getItemAsync(key, guarded(prompt));
}

export async function secureSetGuarded(key: string, value: string, prompt: string): Promise<void> {
  if (web) throw new Error('no strong biometrics on the web build');
  await SecureStore.setItemAsync(key, value, guarded(prompt));
}
