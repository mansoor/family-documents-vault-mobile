import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

/**
 * What the app says about itself on every request: which installation it
 * is, and a User-Agent a person can read in the vault's device list
 * ("FamilyDocumentVault/0.1.1 (Android 15; Google Pixel 8a)"). Older
 * vaults ignore both.
 */
export function userAgent(): string {
  const version = Constants.expoConfig?.version ?? '0.0.0';
  const os = Platform.OS === 'ios' ? 'iOS' : Platform.OS === 'android' ? 'Android' : 'Web';
  const device = [Device.manufacturer, Device.modelName].filter(Boolean).join(' ') || 'unknown device';
  return `FamilyDocumentVault/${version} (${os} ${Device.osVersion ?? ''}; ${device})`.replace(' ;', ';');
}

export function appHeaders(installation: string): Record<string, string> {
  // A browser will not let a page set User-Agent; the web build sends only the id.
  if (Platform.OS === 'web') return { 'x-fdv-installation': installation };
  return { 'x-fdv-installation': installation, 'user-agent': userAgent() };
}
