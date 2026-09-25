import { useEffect, useReducer } from 'react';

/**
 * expo-router, as far as the screens' tests need it (4.12): pushes go on a
 * stack the test's own app renders from; Back pops it. Used as
 * `jest.mock('expo-router', () => require('../test-support/router').routerMock)`.
 */
export interface Route {
  pathname: string;
  params: Record<string, string>;
}

const nav = { stack: [] as Route[], listeners: new Set<() => void>() };
const notify = () => {
  for (const l of [...nav.listeners]) l();
};

export function push(to: string | { pathname: string; params?: Record<string, string> }) {
  nav.stack.push(
    typeof to === 'string' ? { pathname: to, params: {} } : { pathname: to.pathname, params: to.params ?? {} },
  );
  notify();
}
export function back() {
  nav.stack.pop();
  notify();
}
export function resetRoutes() {
  nav.stack = [];
}
export const routes = () => nav.stack;

/** The route on top, re-rendered as it changes. */
export function useTopRoute(): Route | null {
  const [, again] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    nav.listeners.add(again);
    return () => {
      nav.listeners.delete(again);
    };
  }, []);
  return nav.stack[nav.stack.length - 1] ?? null;
}

export const routerMock = {
  Link: (p: { children: unknown }) => p.children,
  useRouter: () => ({ push, back, replace: push, canGoBack: () => nav.stack.length > 0 }),
  useNavigation: () => ({ addListener: () => () => undefined, dispatch: () => undefined }),
  useLocalSearchParams: () => nav.stack[nav.stack.length - 1]?.params ?? {},
};
