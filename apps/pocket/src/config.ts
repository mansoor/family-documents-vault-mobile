import Constants from 'expo-constants';

/** What this build is, from app.config.ts's extra. */
export const extra = (Constants.expoConfig?.extra ?? {}) as {
  testBanner?: boolean;
  variant?: 'dev' | 'preview' | 'e2e' | 'release';
};

/** The scanner spike's screens exist in dev and preview builds only. */
export const SPIKE = extra.variant === 'dev' || extra.variant === 'preview';

/** The app's own version, for negotiating with the vault. */
export const APP_VERSION = Constants.expoConfig?.version ?? '0.0.0';

/**
 * The oldest vault this app works with: 0.4.4 is the first that reports
 * its real version and its installation id, which the http rules need.
 */
export const MIN_SERVER_VERSION = '0.4.4';
