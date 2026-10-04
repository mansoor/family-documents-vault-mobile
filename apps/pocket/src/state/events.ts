/**
 * What the vault's session tells the rest of the app, the moment it happens
 * (4.8, 4.10): a password sign-in (the lock opens in the same render), a
 * sign-out, and a session the vault ended, with its reason (the phone's
 * copies may go with it).
 */
interface Events {
  signedIn: [];
  signedOut: [];
  sessionEnded: [reason: string];
  /** A reminder put off or done (4.12): lists showing it look again. */
  remindersChanged: [];
  /** The vault pushed `notice` (5.31): something about the person's details is changing; Home looks again. */
  noticesChanged: [];
}

type Listener<K extends keyof Events> = (...args: Events[K]) => void;

const listeners: { [K in keyof Events]: Set<Listener<K>> } = {
  signedIn: new Set(),
  signedOut: new Set(),
  sessionEnded: new Set(),
  remindersChanged: new Set(),
  noticesChanged: new Set(),
};

export function on<K extends keyof Events>(event: K, fn: Listener<K>): () => void {
  listeners[event].add(fn);
  return () => {
    listeners[event].delete(fn);
  };
}

export function emit<K extends keyof Events>(event: K, ...args: Events[K]): void {
  for (const fn of [...listeners[event]]) fn(...args);
}
