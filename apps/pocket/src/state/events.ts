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
  /**
   * A document's details, who can see it, or the Trash changed on the phone (P8): lists showing it look
   * again. `essential`, where the one who says it knows: whether it is an Essential now (0.21.0), so the
   * copies kept on the phone follow only a change that touches them.
   */
  documentChanged: [id: string, essential?: boolean];
  /** Documents put in a collection or taken out of it on the phone (P9): its list and its page look again. */
  collectionChanged: [id: string];
  /** A collection's checklist kept, cleared or filled from on the phone (0.8.0): its page looks again. */
  checklistChanged: [id: string];
  /** A collection's managers chosen, changed or taken away on the phone (0.10.0): its page looks again. */
  managersChanged: [id: string];
  /** A link made or ended on the phone: Sharing looks again. */
  sharesChanged: [];
  /**
   * A request to send documents made, changed, emailed, ended or turned back
   * on (0.16.0; made and changed on the phone since 0.18.0): Sharing looks
   * again, and says what was done when it is given words.
   */
  requestsChanged: [said?: string];
  /** The person's mobile number added, confirmed or removed (SMS4): what hangs on it looks again. */
  phoneChanged: [];
  /** A person's emergency information saved on the phone (0.19.0): their page looks again, and says so. */
  emergencyChanged: [memberId: string, said: string];
  /**
   * The app held back no more (0.20.0: updated, or two-step sign-in set up):
   * the screens kept underneath look again at what they could not load.
   */
  carryOn: [];
}

type Listener<K extends keyof Events> = (...args: Events[K]) => void;

const listeners: { [K in keyof Events]: Set<Listener<K>> } = {
  signedIn: new Set(),
  signedOut: new Set(),
  sessionEnded: new Set(),
  remindersChanged: new Set(),
  noticesChanged: new Set(),
  phoneChanged: new Set(),
  documentChanged: new Set(),
  collectionChanged: new Set(),
  checklistChanged: new Set(),
  managersChanged: new Set(),
  sharesChanged: new Set(),
  requestsChanged: new Set(),
  emergencyChanged: new Set(),
  carryOn: new Set(),
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
