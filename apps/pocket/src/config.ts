import Constants from 'expo-constants';
import { Platform } from 'react-native';

/** What this build is, from app.config.ts's extra. */
export const extra = (Constants.expoConfig?.extra ?? {}) as {
  testBanner?: boolean;
  variant?: 'dev' | 'preview' | 'e2e' | 'release';
  /** The e2e build: the fixture scanner instead of the camera. */
  fixtures?: boolean;
  /** The e2e build: a fake phone lock, opened by a tap (4.8). */
  fakeAuth?: boolean;
  /** Android: this build trusts a certificate installed by hand (plugins/with-network-security.js's switch). */
  userCertificates?: boolean;
};

/** The scanner spike's screens exist in dev and preview builds only. */
// The spike screens: development builds only (P6), never one somebody installs to try.
export const SPIKE = extra.variant === 'dev';

/**
 * Whether this build may reach a vault over plain http (0.21.0). Android's
 * release build may not: its network security config refuses cleartext
 * (plugins/with-network-security.js), so Connect asks for the vault's https
 * address instead of trying. The test builds (dev, preview, e2e), the
 * browser build and iPhone keep the home-network rules of net/policy.ts.
 * Asked when it is needed, not when the app starts.
 */
export function plainHttp(): boolean {
  return !(Platform.OS === 'android' && !['dev', 'preview', 'e2e'].includes(extra.variant ?? ''));
}

/**
 * Whether a certificate installed on the phone by hand is trusted: on
 * Android, as the network security config was written
 * (plugins/with-network-security.js, one switch: on for now, in every build).
 */
export function userCertificates(): boolean {
  // The plugin always says; a build without it (the tests) as the switch is set now.
  return Platform.OS !== 'android' || (extra.userCertificates ?? true);
}

/** The app's own version, for negotiating with the vault. */
export const APP_VERSION = Constants.expoConfig?.version ?? '0.0.0';

/**
 * The oldest vault this app works with. 0.4.4 was the first to report its
 * real version and its installation id, which the http rules need; a scan
 * needs more: an upload that can be retried safely (0.4.8), the card's
 * details sent with the file (0.4.9) and who issued it (0.4.10).
 */
export const MIN_SERVER_VERSION = '0.4.10';

/**
 * Where the app is updated from (0.20.0): this repository's releases page,
 * for now (the owner's choice). The update screen's button opens it.
 *
 * Publish the release there BEFORE the vault raises `min_client_version`
 * past an app people have: a phone told to update must find the update.
 */
export const APP_RELEASES_URL = 'https://github.com/mansoor/family-documents-vault-mobile/releases';
