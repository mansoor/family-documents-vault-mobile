import { Platform } from 'react-native';
import { emit, on } from '../state/events';
import { forgetHttpCache, watchHttpCache } from './http-cache';

const files = (globalThis as unknown as { __files: Map<string, string> }).__files;

/** What 0.1.10 left in OkHttp's cache, and something beside it that must stay. */
function seed() {
  files.set('cache:/http-cache/journal', 'libcore.io.DiskLruCache');
  files.set('cache:/http-cache/3f2a.0', '{"items":[{"title":"Passport"}]}');
  files.set('cache:/fv-timings.json', '[]');
}

describe("the phone's HTTP cache (0.2.0)", () => {
  const os = Platform.OS;
  beforeEach(() => {
    files.clear();
    Platform.OS = 'android';
  });
  afterAll(() => {
    Platform.OS = os;
  });

  it('what the phone kept of the vault is gone at launch, and nothing else is', () => {
    seed();
    const stop = watchHttpCache();
    expect([...files.keys()]).toEqual(['cache:/fv-timings.json']);
    stop();
  });

  it('and again when a session ends here: signed out, or ended by the vault', () => {
    const stop = watchHttpCache();
    seed();
    emit('signedOut');
    expect(files.has('cache:/http-cache/journal')).toBe(false);
    seed();
    emit('sessionEnded', 'revoked');
    expect(files.has('cache:/http-cache/3f2a.0')).toBe(false);
    stop();
    seed();
    emit('signedOut');
    expect(files.has('cache:/http-cache/journal')).toBe(true);
  });

  it('a folder that will not go never stops a sign-out, nor anybody else listening for it', () => {
    // Android's own delete throws when it cannot finish (UnableToDeleteException).
    const { Directory } = jest.requireMock('expo-file-system') as { Directory: { prototype: { delete(): void } } };
    const refused = jest.spyOn(Directory.prototype, 'delete').mockImplementation(() => {
      throw new Error('UnableToDeleteException');
    });
    try {
      seed();
      const stop = watchHttpCache();
      const heard: string[] = [];
      const off = on('signedOut', () => heard.push('the next listener'));
      expect(() => emit('signedOut')).not.toThrow();
      expect(heard).toEqual(['the next listener']);
      off();
      stop();
    } finally {
      refused.mockRestore();
    }
  });

  it('nothing there, or not Android: nothing to do, and never an error', () => {
    expect(() => forgetHttpCache()).not.toThrow();
    Platform.OS = 'web';
    seed();
    forgetHttpCache();
    expect(files.has('cache:/http-cache/journal')).toBe(true);
  });
});
