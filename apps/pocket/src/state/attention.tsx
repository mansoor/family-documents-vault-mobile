import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { useCapture } from './capture';
import { on } from './events';
import { useVault } from './vault';

interface Attention {
  /** How many reminders are due now; null until the vault has said. */
  count: number | null;
  refresh: () => void;
}

const Context = createContext<Attention>({ count: null, refresh: () => undefined });

/**
 * The bell's number (R3; the owner, 10 Nov 2026: Needs attention behind a
 * bell with a count, not a panel on Home): how many reminders are due now,
 * asked of the vault when signed in, again when one is put off or done,
 * when a document changes, when a capture arrives, when the connection
 * returns and when the app comes back to the front. Without a connection,
 * the last count stays.
 */
export function AttentionProvider(props: { children: ReactNode }) {
  const { phase, offline, withTokenQuick } = useVault();
  const capture = useCapture();
  const [count, setCount] = useState<number | null>(null);
  const [asked, setAsked] = useState(0);
  const refresh = useCallback(() => setAsked((n) => n + 1), []);
  const ready = phase === 'ready';

  useEffect(() => {
    if (!ready) {
      // Signed out: no number on anybody's bell.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCount(null);
      return;
    }
    if (offline) return;
    let live = true;
    withTokenQuick((a, token) => a.reminders(token, 'due'))
      .then((r) => {
        if (live) setCount(r.items.length);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [ready, offline, withTokenQuick, asked, capture.delivered]);

  useEffect(() => {
    const offs = [
      on('remindersChanged', refresh),
      on('documentChanged', refresh),
      on('noticesChanged', refresh),
    ];
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refresh();
    });
    return () => {
      for (const off of offs) off();
      sub.remove();
    };
  }, [refresh]);

  const value = useMemo(() => ({ count, refresh }), [count, refresh]);
  return <Context.Provider value={value}>{props.children}</Context.Provider>;
}

export const useAttention = () => useContext(Context);
