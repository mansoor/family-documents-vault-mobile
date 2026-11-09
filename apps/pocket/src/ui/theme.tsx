import { themes, type ColourRole } from '@fdv/shared';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { readPrefs, writePrefs } from '../platform/prefs';

/**
 * The app's colours, light or dark (P4; the web's soft dark theme of
 * 0.9.0, from @fdv/shared's `themes`): every role the light palette has,
 * with the same job, and the same pairs passing WCAG AA. By default it
 * follows the phone's own setting; Settings can fix it to Light or Dark,
 * remembered on this phone. Show mode keeps its own black, and a page's
 * own white (`paper`) stays white in either.
 */
export type Palette = Readonly<Record<ColourRole, string>>;
export type Scheme = 'light' | 'dark';
export type ThemeChoice = 'auto' | Scheme;

const PREF = 'theme';
const CHOICES: readonly ThemeChoice[] = ['auto', 'light', 'dark'];

interface ThemeValue {
  palette: Palette;
  scheme: Scheme;
  choice: ThemeChoice;
  choose: (choice: ThemeChoice) => void;
}

const ThemeContext = createContext<ThemeValue>({
  palette: themes.light,
  scheme: 'light',
  choice: 'auto',
  choose: () => undefined,
});

function storedChoice(): ThemeChoice {
  const kept = readPrefs<string>(PREF, 'auto');
  return CHOICES.includes(kept as ThemeChoice) ? (kept as ThemeChoice) : 'auto';
}

export function ThemeProvider(props: { children: ReactNode }) {
  const system = useColorScheme();
  const [choice, setChoice] = useState<ThemeChoice>(storedChoice);
  const choose = useCallback((next: ThemeChoice) => {
    setChoice(next);
    try {
      writePrefs(PREF, next);
    } catch {
      // Kept until the app closes, then.
    }
  }, []);
  const scheme: Scheme = choice === 'auto' ? (system === 'dark' ? 'dark' : 'light') : choice;
  const value = useMemo<ThemeValue>(
    () => ({ palette: themes[scheme], scheme, choice, choose }),
    [scheme, choice, choose],
  );
  return <ThemeContext.Provider value={value}>{props.children}</ThemeContext.Provider>;
}

/** The colours to draw with now. */
export function useColours(): Palette {
  return useContext(ThemeContext).palette;
}

/** Light or dark now, and what the person chose (Auto follows the phone). */
export function useTheme(): ThemeValue {
  return useContext(ThemeContext);
}

/**
 * A file's styles, made from the colours of the theme in use: made once
 * for each palette and kept, so a screen is not restyled on every render.
 */
const made = new WeakMap<object, Map<Palette, unknown>>();

export function useStyles<T>(make: (colours: Palette) => T): T {
  const palette = useColours();
  let byPalette = made.get(make);
  if (!byPalette) {
    byPalette = new Map();
    made.set(make, byPalette);
  }
  if (!byPalette.has(palette)) byPalette.set(palette, make(palette));
  return byPalette.get(palette) as T;
}
