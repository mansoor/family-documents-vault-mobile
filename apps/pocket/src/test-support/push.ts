import type { Distributor, NativeEvent, NativeState, PushNative } from '../push/native';

/**
 * The phone's push module (4.14), as far as the app can tell: installed
 * distributors, a registration the distributor answers with an address
 * (at once, unless told otherwise), a tapped notification, and the flag a
 * session_ended leaves when the app was closed.
 */
export class FakePushNative implements PushNative {
  installed: Distributor[] = [{ id: 'io.heckel.ntfy', name: 'ntfy' }];
  saved: string | null = null;
  /** The VAPID keys it was asked to register with, in order. */
  registered: string[] = [];
  unregistered = 0;
  /** The address the distributor gives; null, and it gives none. */
  answer: string | null = 'https://ntfy.example.test/upPhone0001';
  s: NativeState = {
    endpoint: null,
    p256dh: null,
    auth: null,
    temporary: false,
    failure: null,
    allowed: true,
  };
  open: string | null = null;
  ended = false;
  private listeners = new Set<(e: NativeEvent) => void>();

  distributors() {
    return this.installed;
  }
  savedDistributor() {
    return this.saved;
  }
  chooseDistributor(id: string) {
    this.saved = id;
  }
  register(vapid: string) {
    this.registered.push(vapid);
    const url = this.answer;
    if (url) setTimeout(() => this.newEndpoint(url), 0);
  }
  /** The distributor gives an address (a new one, or the same again). */
  newEndpoint(url: string) {
    this.s = { ...this.s, endpoint: url, p256dh: 'phone-p256dh', auth: 'phone-auth', failure: null };
    this.emit({ kind: 'endpoint' });
  }
  unregister() {
    this.unregistered += 1;
    this.s = { ...this.s, endpoint: null, p256dh: null, auth: null };
    // As the connector: with its last registration gone, it forgets the distributor too.
    this.saved = null;
  }
  state() {
    return this.s;
  }
  takeOpen() {
    const o = this.open;
    this.open = null;
    return o;
  }
  sessionEnded() {
    return this.ended;
  }
  clearSessionEnded() {
    this.ended = false;
  }
  addListener(_event: 'onPush', listener: (e: NativeEvent) => void) {
    this.listeners.add(listener);
    return { remove: () => void this.listeners.delete(listener) };
  }
  emit(e: NativeEvent) {
    for (const l of [...this.listeners]) l(e);
  }
  /** A notification tapped with the app open. */
  tap(word: string) {
    this.open = word;
    this.emit({ kind: 'open' });
  }
}
