import { readPrefs, writePrefs } from '../platform/prefs';
import type { ShowPlatform } from './platform';

/**
 * Show mode's brightness (4.11), safe across a crash: the brightness from
 * before is written down before the screen goes to full, and put back —
 * on leaving, on going to the back, on unmount, and at the next launch if
 * it is still written down (the app stopped while showing). One step at a
 * time: a quick leave never lands before the enter it follows.
 */
const KEY = 'show-brightness';

let queue: Promise<void> = Promise.resolve();
function serial(step: () => Promise<void>): Promise<void> {
  queue = queue.then(step, step).catch(() => undefined);
  return queue;
}

export function brighten(p: ShowPlatform): Promise<void> {
  return serial(async () => {
    // Already written down (shown again, or left by a crash): that is the one to go back to.
    if (!readPrefs<{ value: number } | null>(KEY, null)) writePrefs(KEY, { value: await p.brightness() });
    await p.setBrightness(1);
  });
}

export function restoreBrightness(p: ShowPlatform): Promise<void> {
  return serial(async () => {
    const saved = readPrefs<{ value: number } | null>(KEY, null);
    if (!saved) return;
    await p.restoreBrightness(saved.value);
    writePrefs(KEY, null);
  });
}

/** At launch: a brightness left behind by a crash goes back. */
export const recoverBrightness = restoreBrightness;
