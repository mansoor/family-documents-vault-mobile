import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { readPrefs, writePrefs } from '../platform/prefs';

/**
 * Large text: the app's own step up, on top of whatever the phone's font
 * size setting already does (Text scales with it too). One switch, because
 * one is what people use.
 */
export const LARGE = 1.3;

interface TextScale {
  scale: number;
  large: boolean;
  setLarge: (on: boolean) => void;
}

const Context = createContext<TextScale>({ scale: 1, large: false, setLarge: () => undefined });

export function TextScaleProvider(props: { children: ReactNode; initialLarge?: boolean }) {
  const [large, setLargeState] = useState<boolean>(
    () => props.initialLarge ?? readPrefs<{ large?: boolean }>('display', {}).large === true,
  );
  const setLarge = useCallback((on: boolean) => {
    setLargeState(on);
    writePrefs('display', { large: on });
  }, []);
  const value = useMemo(() => ({ scale: large ? LARGE : 1, large, setLarge }), [large, setLarge]);
  return <Context.Provider value={value}>{props.children}</Context.Provider>;
}

export const useTextScale = () => useContext(Context);
