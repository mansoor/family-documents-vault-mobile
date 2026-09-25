import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * One app, four builds, told apart by APP_VARIANT:
 *
 * - dev: the development client; JavaScript comes from Metro.
 * - preview: a release build with the JavaScript embedded and a TEST BUILD
 *   banner, debug-signed. It talks only to throwaway stacks.
 * - e2e: an x86_64 build for the emulator, with fixtures and a fake
 *   authenticator (first built in 4.5).
 * - release: the owner's build, signed with the owner's key (from 4.18).
 *
 * Each has its own application id, so all four can sit on one phone.
 */
type Variant = 'dev' | 'preview' | 'e2e' | 'release';

const VARIANTS: Record<Variant, { id: string; name: string }> = {
  dev: { id: 'io.github.mansoor.familyvault.dev', name: 'FV dev' },
  preview: { id: 'io.github.mansoor.familyvault.preview', name: 'FV test' },
  e2e: { id: 'io.github.mansoor.familyvault.e2e', name: 'FV e2e' },
  release: { id: 'io.github.mansoor.familyvault', name: 'Family Vault' },
};

function variantOf(value: string | undefined): Variant {
  if (value === undefined || value === '') return 'dev';
  if (value in VARIANTS) return value as Variant;
  throw new Error(`APP_VARIANT must be one of ${Object.keys(VARIANTS).join(', ')}; got "${value}"`);
}

const FACE_ID = 'Family Vault uses Face ID to unlock your documents on this phone.';
const CAMERA = 'Family Vault uses the camera to scan your documents.';

const font = (family: string, file: string) =>
  `./node_modules/@expo-google-fonts/${family}/${file.split('_')[1]?.replace('.ttf', '')}/${file}`;

export default ({ config }: ConfigContext): ExpoConfig => {
  const variant = variantOf(process.env.APP_VARIANT);
  const { id, name } = VARIANTS[variant];
  return {
    ...config,
    name,
    slug: 'family-vault',
    scheme: variant === 'release' ? 'familyvault' : `familyvault-${variant}`,
    version: '0.1.4',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    ios: {
      bundleIdentifier: id,
      supportsTablet: false,
      deploymentTarget: '16.4',
      infoPlist: {
        NSCameraUsageDescription: CAMERA,
        NSFaceIDUsageDescription: FACE_ID,
        // Reaching a vault on the home network by its address.
        NSAppTransportSecurity: { NSAllowsLocalNetworking: true },
      },
    },
    android: {
      package: id,
      adaptiveIcon: {
        backgroundColor: '#FAF8F4',
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
      // Predictive back stays off until 4.15 handles it everywhere.
      predictiveBackGestureEnabled: false,
    },
    web: {
      favicon: './assets/favicon.png',
      bundler: 'metro',
      output: 'single',
    },
    plugins: [
      'expo-router',
      [
        'expo-build-properties',
        {
          android: {
            minSdkVersion: 29,
            compileSdkVersion: 36,
            targetSdkVersion: 36,
            buildArchs: variant === 'e2e' ? ['x86_64'] : ['arm64-v8a'],
            enableMinifyInReleaseBuilds: variant !== 'dev',
          },
        },
      ],
      ['expo-sqlite', { useSQLCipher: true }],
      // Our own backup rules replace the module's (with-data-extraction).
      ['expo-secure-store', { configureAndroidBackup: false, faceIDPermission: FACE_ID }],
      ['expo-local-authentication', { faceIDPermission: FACE_ID }],
      ['@preeternal/react-native-document-scanner-plugin', { cameraPermission: CAMERA }],
      [
        'expo-font',
        {
          fonts: [
            font('figtree', 'Figtree_400Regular.ttf'),
            font('figtree', 'Figtree_500Medium.ttf'),
            font('figtree', 'Figtree_600SemiBold.ttf'),
            font('figtree', 'Figtree_700Bold.ttf'),
            font('fraunces', 'Fraunces_600SemiBold.ttf'),
          ],
        },
      ],
      'expo-sharing',
      'expo-image',
      'expo-localization',
      'expo-status-bar',
      './plugins/with-network-security.js',
      './plugins/with-data-extraction.js',
    ],
    experiments: { typedRoutes: true },
    extra: {
      variant,
      testBanner: variant === 'preview',
      fixtures: variant === 'e2e',
      fakeAuth: variant === 'e2e',
    },
  };
};
