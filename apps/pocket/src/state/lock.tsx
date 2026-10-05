import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, BackHandler } from 'react-native';
import { extra } from '../config';
import { defaultAuth } from '../lock/auth';
import { KeyRing } from '../lock/keys';
import { defaultScreenGuard } from '../lock/screen-guard';
import type { AuthOutcome, AuthPort, LockLevel, ScreenGuardPort } from '../lock/types';
import { log } from '../log';
import { readPrefs, writePrefs } from '../platform/prefs';
import { on } from './events';
import { useVault } from './vault';

/**
 * The app's lock (4.8).
 *
 * The phone's own lock opens it: fingerprint or face, with the phone's PIN
 * or pattern always allowed instead. It is locked when the app starts with
 * somebody signed in, and when it comes back after longer away than the
 * person chose — immediately, a minute (the default) or five. Signing in
 * with a password counts as unlocking. A phone with no screen lock has no
 * app lock either, and keeps nothing offline; everything else works.
 *
 * While the app is away its screen is covered, so coming back never shows
 * the last screen before the lock decides. Opening it reads the everyday
 * Essentials' key into memory; locking drops it. While it is open the
 * screen is kept out of screenshots and the recent apps view, unless the
 * person allows screenshots — which never covers documents or the card.
 */

export type LockTimeout = 'immediately' | '1m' | '5m';
const AWAY_MS: Record<LockTimeout, number> = { immediately: 0, '1m': 60_000, '5m': 300_000 };
/**
 * The app's own screens (the scanner, a picker, the phone's prompt) take it
 * to the back without the person leaving; time spent there counts only
 * past this, so a long scan does not lock — and leaving the phone from
 * inside the scanner still does.
 */
const OWN_SCREEN_GRACE_MS = 5 * 60_000;
/** A prompt that has not answered in this long is taken away (it can hang when asked from the back). */
const PROMPT_TIMEOUT_MS = 60_000;

/** checking: not known yet; none: this phone has no screen lock. */
export type LockStatus = 'checking' | 'locked' | 'unlocked' | 'none';

export interface LockDeps {
  auth: AuthPort;
  keys: KeyRing;
  screen: ScreenGuardPort;
  now: () => number;
  exitApp: () => void;
  /** Ask straight away when the lock appears (not in the e2e build: nothing could answer). */
  autoPrompt: boolean;
}

interface LockPrefs {
  timeout: LockTimeout;
  screenshots: boolean;
}

interface LockValue {
  status: LockStatus;
  level: LockLevel | null;
  /** The app is away: its screen is covered until it is back, or locked. */
  covered: boolean;
  tooManyTries: boolean;
  unlock(): Promise<void>;
  timeout: LockTimeout;
  setTimeout(t: LockTimeout): void;
  screenshots: boolean;
  setScreenshots(allowed: boolean): void;
  keys: KeyRing;
  /** The everyday copies' key while the lock is open (a moment after it opens); null otherwise. */
  everydayKey: string | null;
  /**
   * Something of the app's own that takes it out of the front — the
   * scanner, a picker, the phone's own prompt — is not leaving it.
   */
  away<T>(task: () => Promise<T>): Promise<T>;
  /** A part of the app that is never captured, whatever the setting: the card, a document's pages. */
  guard(name: string): () => void;
  /** Locked now, and why: after Show mode (4.11) the phone may be in someone else's hand. */
  lockNow(why: 'show'): void;
  lockedFor: 'show' | null;
  exitApp(): void;
  autoPrompt: boolean;
}

function defaultDeps(): LockDeps {
  return {
    auth: defaultAuth(),
    keys: new KeyRing(),
    screen: defaultScreenGuard(),
    now: () => Date.now(),
    exitApp: () => BackHandler.exitApp(),
    autoPrompt: !extra.fakeAuth,
  };
}

const Ctx = createContext<LockValue | null>(null);

export function LockProvider(props: { children: ReactNode; deps?: Partial<LockDeps> }) {
  const d = useMemo<LockDeps>(() => ({ ...defaultDeps(), ...props.deps }), [props.deps]);
  const { t } = useTranslation();
  const { phase } = useVault();
  const [status, setStatusState] = useState<LockStatus>('checking');
  const [level, setLevel] = useState<LockLevel | null>(null);
  const [covered, setCovered] = useState(false);
  const [tooManyTries, setTooManyTries] = useState(false);
  const [everydayKey, setEverydayKey] = useState<string | null>(null);
  const [lockedFor, setLockedFor] = useState<'show' | null>(null);
  const [prefs, setPrefsState] = useState<LockPrefs>(() => readPrefs('lock', { timeout: '1m', screenshots: false }));

  // Read by the AppState listener and the prompt, which outlive a render.
  const statusRef = useRef<LockStatus>('checking');
  const setStatus = useCallback((s: LockStatus) => {
    statusRef.current = s;
    setStatusState(s);
  }, []);
  const timeoutRef = useRef(prefs.timeout);
  const leftAt = useRef<number | null>(null);
  // One of the app's own screens is up (holding), and whether the app went
  // to the back while it was (ownScreen): then coming back gets the grace.
  const holding = useRef(0);
  const ownScreen = useRef(false);
  const signedInHere = useRef(false);
  const lastPhase = useRef(phase);

  const lock = useCallback(() => {
    d.keys.drop();
    setEverydayKey(null);
    setStatus('locked');
  }, [d, setStatus]);

  /** Open now; the everyday key follows (nothing reads it before a store opens). */
  const open = useCallback(() => {
    setTooManyTries(false);
    setLockedFor(null);
    setStatus('unlocked');
    void d.keys
      .openEveryday()
      .then((hex) => {
        if (statusRef.current === 'unlocked') setEverydayKey(hex);
      })
      .catch(() => log.error('essentials.key_unreadable', {}));
  }, [d, setStatus]);

  // Starting: locked, if the phone has a lock at all.
  useEffect(() => {
    let cancelled = false;
    d.auth
      .level()
      .catch((): LockLevel => 'none')
      .then((l) => {
        if (cancelled) return;
        setLevel(l);
        if (l === 'none') setStatus('none');
        else if (signedInHere.current) open();
        else if (statusRef.current === 'checking') setStatus('locked');
      });
    return () => {
      cancelled = true;
    };
  }, [d, open, setStatus]);

  // A password sign-in opens the lock in the same moment it signs in: the
  // lock screen never appears, and nothing asks for a fingerprint on top.
  useEffect(
    () =>
      on('signedIn', () => {
        signedInHere.current = true;
        if (statusRef.current === 'locked' || statusRef.current === 'checking') open();
      }),
    [open],
  );

  // Signing out closes everything.
  useEffect(() => {
    const was = lastPhase.current;
    lastPhase.current = phase;
    if (was === 'ready' && phase !== 'ready') {
      signedInHere.current = false;
      if (statusRef.current === 'unlocked') lock();
    }
  }, [phase, lock]);

  // Away and back.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background') {
        leftAt.current = d.now();
        if (holding.current > 0) {
          ownScreen.current = true;
          return;
        }
        if (statusRef.current !== 'unlocked') return;
        // Locked now, so nothing is on screen when it comes back; otherwise
        // covered until it is known whether it locks.
        if (timeoutRef.current === 'immediately') lock();
        else setCovered(true);
        return;
      }
      if (next !== 'active') return;
      const left = leftAt.current;
      const own = ownScreen.current;
      leftAt.current = null;
      ownScreen.current = false;
      if (left !== null && statusRef.current === 'unlocked') {
        const allowed = own ? Math.max(AWAY_MS[timeoutRef.current], OWN_SCREEN_GRACE_MS) : AWAY_MS[timeoutRef.current];
        if (d.now() - left >= allowed) lock();
      }
      setCovered(false);
      if (left === null || own) return;
      // A screen lock added or removed while away changes what the app can do.
      void d.auth
        .level()
        .catch((): LockLevel => 'none')
        .then((l) => {
          setLevel(l);
          if (l === 'none' && statusRef.current !== 'none') {
            d.keys.drop();
            setEverydayKey(null);
            setStatus('none');
          } else if (l !== 'none' && statusRef.current === 'none') {
            open();
          }
        });
    });
    return () => sub.remove();
  }, [d, lock, open, setStatus]);

  const away = useCallback(async <T,>(task: () => Promise<T>): Promise<T> => {
    holding.current += 1;
    try {
      return await task();
    } finally {
      holding.current -= 1;
    }
  }, []);

  const unlock = useCallback(async () => {
    if (statusRef.current !== 'locked' || holding.current > 0) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const outcome = await away(() =>
      Promise.race([
        d.auth.authenticate(t('lock.prompt')),
        new Promise<AuthOutcome>((resolve) => {
          timer = setTimeout(() => {
            void d.auth.cancel?.().catch(() => undefined);
            resolve('cancelled');
          }, PROMPT_TIMEOUT_MS);
        }),
      ]),
    ).finally(() => clearTimeout(timer));
    if (outcome === 'ok') open();
    else if (outcome === 'lockout') setTooManyTries(true);
    else if (outcome === 'unavailable') {
      const l = await d.auth.level().catch((): LockLevel => 'none');
      setLevel(l);
      if (l === 'none') setStatus('none');
    }
  }, [d, t, away, open, setStatus]);

  // Kept out of screenshots while open, unless the person allows them. Open
  // while signed out means kept Essentials are being read: the same.
  const showing = phase === 'ready' ? status !== 'locked' && status !== 'checking' : status === 'unlocked';
  const shielded = showing && !prefs.screenshots;
  useEffect(() => {
    void (shielded ? d.screen.prevent('app') : d.screen.allow('app'));
  }, [d, shielded]);

  // How many parts of the app hold each name: the screen is shielded under
  // a name while any of them does. Two identity cards, one under the other on
  // the stack, share a name, and the one taken away must not lift the
  // other's shield (the screen guard below counts nothing: it keeps a set).
  const claims = useRef(new Map<string, number>());
  const guard = useCallback(
    (name: string) => {
      const held = claims.current.get(name) ?? 0;
      claims.current.set(name, held + 1);
      if (held === 0) void d.screen.prevent(name);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const left = (claims.current.get(name) ?? 1) - 1;
        if (left > 0) {
          claims.current.set(name, left);
          return;
        }
        claims.current.delete(name);
        void d.screen.allow(name);
      };
    },
    [d],
  );

  const setPrefs = useCallback((next: LockPrefs) => {
    timeoutRef.current = next.timeout;
    setPrefsState(next);
    writePrefs('lock', next);
  }, []);

  // Why it is locked, even when it locked a moment before by itself (with
  // "Immediately", going to the back from Show locks first on Android).
  const lockNow = useCallback(
    (why: 'show') => {
      if (statusRef.current !== 'unlocked' && statusRef.current !== 'locked') return;
      setLockedFor(why);
      if (statusRef.current === 'unlocked') lock();
    },
    [lock],
  );

  const value = useMemo<LockValue>(
    () => ({
      status,
      level,
      covered,
      tooManyTries,
      unlock,
      timeout: prefs.timeout,
      setTimeout: (timeout) => setPrefs({ ...prefs, timeout }),
      screenshots: prefs.screenshots,
      setScreenshots: (screenshots) => setPrefs({ ...prefs, screenshots }),
      keys: d.keys,
      everydayKey,
      away,
      guard,
      lockNow,
      lockedFor,
      exitApp: d.exitApp,
      autoPrompt: d.autoPrompt,
    }),
    [status, level, covered, tooManyTries, unlock, prefs, setPrefs, d, everydayKey, away, guard, lockNow, lockedFor],
  );
  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>;
}

/** Outside a LockProvider (some tests): a phone with no lock, where nothing is kept. */
const NO_LOCK: LockValue = {
  status: 'none',
  level: 'none',
  covered: false,
  tooManyTries: false,
  unlock: async () => undefined,
  timeout: '1m',
  setTimeout: () => undefined,
  screenshots: false,
  setScreenshots: () => undefined,
  keys: new KeyRing(),
  everydayKey: null,
  away: (task) => task(),
  guard: () => () => undefined,
  lockNow: () => undefined,
  lockedFor: null,
  exitApp: () => undefined,
  autoPrompt: false,
};

export function useLock(): LockValue {
  return useContext(Ctx) ?? NO_LOCK;
}

/** This screen is never captured while it is shown, whatever the setting. */
export function useScreenGuard(name: string): void {
  const { guard } = useLock();
  useEffect(() => guard(name), [guard, name]);
}
