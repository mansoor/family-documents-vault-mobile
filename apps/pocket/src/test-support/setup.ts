/**
 * In-memory stand-ins for the native modules the app's storage uses, so
 * the tests exercise the app's own logic on top of them.
 */
const secure = new Map<string, string>();
const files = new Map<string, string>();

(globalThis as Record<string, unknown>).__secureStore = secure;
(globalThis as Record<string, unknown>).__files = files;

jest.mock('expo-secure-store', () => {
  const store = (globalThis as unknown as { __secureStore: Map<string, string> }).__secureStore;
  return {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
    deleteItemAsync: jest.fn(async (k: string) => {
      store.delete(k);
    }),
    canUseBiometricAuthentication: () => false,
  };
});

jest.mock('expo-file-system', () => {
  const fs = (globalThis as unknown as { __files: Map<string, string> }).__files;
  class File {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = parts.map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri)).join('/');
    }
    get exists() {
      return fs.has(this.uri);
    }
    create() {
      fs.set(this.uri, '');
    }
    delete() {
      fs.delete(this.uri);
    }
    write(text: string) {
      fs.set(this.uri, text);
    }
    textSync() {
      return fs.get(this.uri) ?? '';
    }
  }
  return { File, Paths: { document: { uri: 'doc:' }, cache: { uri: 'cache:' } } };
});

jest.mock('expo-network', () => ({
  NetworkStateType: { WIFI: 'WIFI', CELLULAR: 'CELLULAR', ETHERNET: 'ETHERNET', NONE: 'NONE', UNKNOWN: 'UNKNOWN' },
  getNetworkStateAsync: jest.fn(async () => ({ type: 'WIFI', isConnected: true, isInternetReachable: true })),
}));

jest.mock('expo-device', () => ({ manufacturer: 'Test', modelName: 'Phone 1', osVersion: '15' }));

jest.mock('expo-crypto', () => {
  const node = jest.requireActual<typeof import('crypto')>('crypto');
  return {
    randomUUID: () => node.randomUUID(),
    getRandomValues: <T extends ArrayBufferView>(a: T) => node.getRandomValues(a as never) as T,
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    digest: async (_alg: string, data: Uint8Array) => node.createHash('sha256').update(data).digest().buffer,
  };
});

beforeEach(() => {
  secure.clear();
  files.clear();
});

// Under Jest there is no app.config to read, so the app would call itself
// 0.0.0 and fail every vault's min_client_version. Give it its real version.
jest.mock('expo-constants', () => {
  const actual = jest.requireActual<{ default: Record<string, unknown> }>('expo-constants');
  const { version } = jest.requireActual<{ version: string }>('../../package.json');
  return { ...actual, __esModule: true, default: { ...actual.default, expoConfig: { version, extra: {} } } };
});
