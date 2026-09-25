/**
 * The phone's own Show platform, as the app resolves it (platform.native.ts
 * under jest-expo, as on a device): it loads and answers. 4.11's review
 * found it importing itself, which threw here and at every launch.
 */
import * as Brightness from 'expo-brightness';
import * as ScreenOrientation from 'expo-screen-orientation';
import { defaultShowPlatform } from './platform';

// Hoisted above the imports by jest.
jest.mock('expo-brightness', () => ({
  getBrightnessAsync: jest.fn(async () => 0.5),
  setBrightnessAsync: jest.fn(async () => undefined),
  restoreSystemBrightnessAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: jest.fn(async () => undefined),
  deactivateKeepAwake: jest.fn(async () => undefined),
}));
jest.mock('expo-navigation-bar', () => ({ setVisibilityAsync: jest.fn(async () => undefined) }));
jest.mock('expo-screen-orientation', () => ({
  unlockAsync: jest.fn(async () => undefined),
  lockAsync: jest.fn(async () => undefined),
  OrientationLock: { LANDSCAPE: 5, PORTRAIT_UP: 3 },
}));

describe('the phone’s Show platform', () => {
  it('loads, and does what it says', async () => {
    const p = defaultShowPlatform();
    expect(await p.brightness()).toBe(0.5);
    await p.setBrightness(1);
    expect(Brightness.setBrightnessAsync).toHaveBeenCalledWith(1);
    await p.orientation('landscape');
    expect(ScreenOrientation.lockAsync).toHaveBeenCalledWith(5);
    await p.orientation('free');
    expect(ScreenOrientation.unlockAsync).toHaveBeenCalled();
    expect(typeof (await p.screenReader())).toBe('boolean');
    p.onScreenReader(() => undefined)();
  });
});
