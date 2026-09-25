import { Platform } from 'react-native';

/**
 * UnifiedPush on the phone (4.14): the app's own native module
 * (modules/unifiedpush), on Android only. Anywhere else — an iPhone, the
 * web build — there is none, and push is not offered.
 */
export interface Distributor {
  /** Its package, e.g. io.heckel.ntfy. */
  id: string;
  name: string;
}

export interface NativeState {
  /** The address the distributor gave, and the keys the vault encrypts to. */
  endpoint: string | null;
  p256dh: string | null;
  auth: string | null;
  temporary: boolean;
  /** Why the last registration failed (the connector's reason), or null. */
  failure: string | null;
  /** Whether the app may show notifications (Android 13 and later ask). */
  allowed: boolean;
}

export type NativeEvent =
  | { kind: 'endpoint' }
  | { kind: 'unregistered' }
  | { kind: 'failed'; reason: string }
  | { kind: 'message'; type: string }
  | { kind: 'open' };

export interface PushNative {
  distributors(): Distributor[];
  savedDistributor(): string | null;
  chooseDistributor(id: string): void;
  /** Asks the distributor for an address; it arrives later, as an `endpoint` event. */
  register(vapid: string): void;
  unregister(): void;
  state(): NativeState;
  /** Where a tapped notification asked to go ('needs-attention', 'devices'), once. */
  takeOpen(): string | null;
  /** The vault said this phone was signed out while the app was closed. */
  sessionEnded(): boolean;
  clearSessionEnded(): void;
  addListener(event: 'onPush', listener: (e: NativeEvent) => void): { remove(): void };
}

let found: PushNative | null | undefined;

/** The module, or null where there is none. */
export function pushNative(): PushNative | null {
  if (found !== undefined) return found;
  found = null;
  if (Platform.OS !== 'android') return found;
  try {
    // Loaded when first asked for: the tests and the web build never do.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { requireOptionalNativeModule } = require('expo') as typeof import('expo');
    found = requireOptionalNativeModule<PushNative>('FdvUnifiedPush');
  } catch {
    found = null;
  }
  return found;
}
