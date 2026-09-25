import type { FetchLike } from '@fdv/client';
import type { DocumentView, OfflineItem } from '@fdv/shared';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { useEffect, useState } from 'react';
import Home from '../app/index';
import SignIn from '../app/sign-in';
import type { Tier } from '../essentials/open';
import { EssentialPages } from '../essentials/pages';
import { MemoryEssentialsStore } from '../essentials/store';
import { CHECKED_KEY } from '../essentials/sync';
import { OWNER_KEY } from '../essentials/wipe';
import { LockGate } from '../lock/gate';
import { KeyRing } from '../lock/keys';
import { writePrefs } from '../platform/prefs';
import { useEssentials, type EssentialsDeps } from '../state/essentials';
import { useLock, type LockDeps } from '../state/lock';
import { useVault } from '../state/vault';
import { audit } from '../test-support/a11y';
import { installed, knownVault, renderApp, signedIn } from '../test-support/render';
import { testVault, type TestVault } from '../test-support/vault';
import { Button } from '../ui';

/** Where Home sends a row (Open or Show): the test's own screen shows it. */
const mockNav: { go: (p: { params: { id: string; mode?: string } }) => void } = { go: () => undefined };
jest.mock('expo-router', () => ({
  Link: (p: { children: unknown }) => p.children,
  useRouter: () => ({
    push: (p: unknown) => mockNav.go(p as { params: { id: string; mode?: string } }),
    back: jest.fn(),
    replace: jest.fn(),
  }),
  useNavigation: () => ({ addListener: () => () => undefined, dispatch: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));

const ORIGIN = 'https://vault.test';
const PASSWORD = 'correct horse battery staple';

/** The app's own gates (see _layout), with the test's navigation. */
function App() {
  const { phase } = useVault();
  const { status } = useLock();
  const { keptWhileSignedOut } = useEssentials();
  const [viewing, setViewing] = useState<{ id: string; mode?: string } | null>(null);
  useEffect(() => {
    mockNav.go = (p) => setViewing(p.params);
  }, []);
  const reading = phase === 'ready' || (phase === 'sign_in' && keptWhileSignedOut && status === 'unlocked');
  const content =
    viewing && reading ? (
      <>
        <Button label="Back" testID="viewer-back" onPress={() => setViewing(null)} />
        <EssentialPages id={viewing.id} {...(viewing.mode ? { mode: viewing.mode } : {})} />
      </>
    ) : phase === 'sign_in' ? (
      <SignIn />
    ) : phase !== 'ready' || status === 'checking' ? null : (
      <Home />
    );
  return (
    <LockGate>
      <Grab />
      {content}
    </LockGate>
  );
}

function passport(pages = 2): OfflineItem {
  return {
    document: {
      id: 'passport',
      title: 'Passport',
      type_key: 'passport',
      visibility: 'household',
      owner_member_id: 'fake-member',
      is_essential: true,
    } as DocumentView,
    version: {
      id: 'passport-v1',
      mime: 'application/pdf',
      page_count: pages,
      preview_pages: pages,
      preview_state: 'ready',
    },
    private: false,
  };
}

/** Both offline stores, in memory; and which were removed. */
function memoryIo() {
  const stores = new Map<Tier, MemoryEssentialsStore>();
  const removed: Tier[] = [];
  const io = {
    open: async (tier: Tier) => {
      let s = stores.get(tier);
      if (!s) {
        s = new MemoryEssentialsStore();
        stores.set(tier, s);
      }
      return s;
    },
    remove: async (tier: Tier) => {
      removed.push(tier);
      stores.delete(tier);
    },
  };
  return { stores, removed, io };
}

function phoneParts() {
  const lock: Partial<LockDeps> = {
    auth: { level: async () => 'strong', authenticate: async () => 'ok' },
    keys: new KeyRing(),
    screen: { prevent: async () => undefined, allow: async () => undefined },
    exitApp: () => undefined,
    autoPrompt: false,
  };
  const mem = memoryIo();
  let n = 0;
  const essentials: Partial<EssentialsDeps> = {
    io: mem.io,
    now: () => Date.now(),
    uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  };
  return { lock, essentials, mem };
}

async function start(t: TestVault, parts = phoneParts(), fetch: FetchLike = t.fetch) {
  await signedIn(t);
  await renderApp(<App />, { fetch, lock: parts.lock, essentials: parts.essentials });
  await fireEvent.press(await screen.findByTestId('lock-unlock'));
  await screen.findByTestId('home-calm');
  return parts;
}

async function keep(password = PASSWORD) {
  await fireEvent.press(await screen.findByTestId('essentials-keep'));
  await fireEvent.changeText(await screen.findByTestId('essentials-password-field'), password);
  await fireEvent.press(screen.getByTestId('essentials-password-go'));
}

/** What pull-to-refresh does for the kept Essentials: a sync, now. */
const grabbed: { sync: (() => Promise<void>) | null; vault: ReturnType<typeof useVault> | null } = {
  sync: null,
  vault: null,
};
function Grab() {
  const { sync } = useEssentials();
  const vault = useVault();
  useEffect(() => {
    grabbed.sync = sync;
    grabbed.vault = vault;
  });
  return null;
}
const pullToRefresh = () => act(async () => grabbed.sync?.());

beforeEach(() => installed());

describe('Essentials in airplane mode', () => {
  it('keeping them asks for the password once, and fills the phone', async () => {
    const t = testVault([ORIGIN]);
    t.vault.state.offlineEssentials.items = [passport()];
    const parts = await start(t);
    await keep('not my password');
    expect(await screen.findByText("That password isn't right.")).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('essentials-password-field'), PASSWORD);
    await fireEvent.press(screen.getByTestId('essentials-password-go'));
    expect(await screen.findByTestId('essential-passport')).toBeTruthy();
    expect(screen.getByText('1 on this phone')).toBeTruthy();
    const kept = parts.mem.stores.get('everyday')!;
    expect(await kept.page('passport-v1', 2)).not.toBeNull();
  });

  it('with no connection, a kept Essential opens — and the opening is told once back online', async () => {
    const t = testVault([ORIGIN]);
    t.vault.state.offlineEssentials.items = [passport()];
    const parts = await start(t);
    await keep();
    await screen.findByTestId('essential-passport');

    // Airplane mode.
    t.reachable.delete(ORIGIN);
    await fireEvent.press(screen.getByLabelText('Open: Passport'));
    expect(await screen.findByTestId('essential-image')).toBeTruthy();
    expect(screen.getByTestId('essential-page')).toHaveTextContent('Page 1 of 2');
    await fireEvent.press(screen.getByTestId('essential-next'));
    await waitFor(() => expect(screen.getByTestId('essential-page')).toHaveTextContent('Page 2 of 2'));
    const kept = parts.mem.stores.get('everyday')!;
    expect(await kept.opens()).toHaveLength(1);

    // Back online: told, once, and forgotten here.
    t.reachable.add(ORIGIN);
    await fireEvent.press(screen.getByTestId('viewer-back'));
    await pullToRefresh();
    await waitFor(() => expect(t.vault.state.offlineEssentials.received.size).toBe(1));
    expect(await kept.opens()).toHaveLength(0);
  });

  it('a revoked session wipes every copy', async () => {
    const t = testVault([ORIGIN]);
    t.vault.state.offlineEssentials.items = [passport()];
    const parts = await start(t);
    await keep();
    await screen.findByTestId('essential-passport');
    for (const s of t.vault.state.sessions) s.revoked = true;
    await pullToRefresh();
    await waitFor(() => expect(parts.mem.removed).toEqual(expect.arrayContaining(['everyday', 'private'])));
    expect(parts.mem.stores.size).toBe(0);
    // Said on the sign-in screen, where the person now is; and nothing kept is offered.
    expect(
      await screen.findByText('This phone was signed out of the vault, so the documents kept on it have been removed.'),
    ).toBeTruthy();
    expect(screen.queryByTestId('essentials-signed-out')).toBeNull();
  });

  it('an expired session keeps them readable, from sign-in and behind the lock', async () => {
    const t = testVault([ORIGIN]);
    t.vault.state.offlineEssentials.items = [passport()];
    const parts = await start(t);
    await keep();
    await screen.findByTestId('essential-passport');
    for (const s of t.vault.state.sessions) {
      s.revoked = true;
      s.endedBecause = 'expired' as never;
    }
    await pullToRefresh();
    // Signed out, by the vault's clock — and the copies are still here.
    expect(await screen.findByTestId('essentials-signed-out')).toBeTruthy();
    expect(screen.getByText('Sign in again to keep these up to date. You can still open them.')).toBeTruthy();
    expect(parts.mem.removed).toEqual([]);
    // Locked with the sign-out: nothing kept is listed until it opens.
    expect(screen.queryByTestId('essential-passport')).toBeNull();
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByTestId('essentials-open-kept'));
    await screen.findByLabelText('Open: Passport');
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByLabelText('Open: Passport'));
    expect(await screen.findByTestId('essential-image')).toBeTruthy();
    // Read, not synced: nothing asked of the vault while signed out.
    expect(t.vault.state.offlineEssentials.received.size).toBe(0);
  });

  /** Kept, then the session expires, then signed in again on the sign-in screen. */
  async function expireAndSignInAgain(t: TestVault) {
    for (const s of t.vault.state.sessions) {
      s.revoked = true;
      s.endedBecause = 'expired' as never;
    }
    await pullToRefresh();
    await screen.findByTestId('essentials-signed-out');
    await fireEvent.changeText(screen.getByTestId('sign-in-email'), 'owner@example.test');
    await fireEvent.changeText(screen.getByTestId('sign-in-password'), PASSWORD);
    await fireEvent.press(screen.getByTestId('sign-in-go'));
  }

  it('signing in again after expiry renews the grant with that password, and keeps them up to date', async () => {
    const t = testVault([ORIGIN]);
    t.vault.state.offlineEssentials.items = [passport()];
    const parts = await start(t);
    await keep();
    await screen.findByTestId('essential-passport');
    await expireAndSignInAgain(t);
    // The new session has its grant — so the vault's set is not "keep nothing".
    expect(await screen.findByTestId('essential-passport')).toBeTruthy();
    expect(screen.queryByTestId('essentials-signed-out')).toBeNull();
    expect(screen.queryByTestId('essentials-renew')).toBeNull();
    const current = t.vault.state.sessions.find((s) => !s.revoked);
    expect(current?.offlineGrant).toBeTruthy();
    expect(parts.mem.removed).toEqual([]);
  });

  it('signed in again with no grant yet, nothing kept is removed; one password brings them up to date', async () => {
    const t = testVault([ORIGIN]);
    t.vault.state.offlineEssentials.items = [passport()];
    let grants = 0;
    // The first grant goes through; the one at the next sign-in finds no connection.
    const fetch: FetchLike = async (url, init) => {
      if (String(url).endsWith('/api/v1/offline/grant') && ++grants === 2)
        throw new TypeError('Network request failed');
      return t.fetch(url, init);
    };
    const parts = await start(t, phoneParts(), fetch);
    await keep();
    await screen.findByTestId('essential-passport');
    await expireAndSignInAgain(t);
    // Held: the vault would say "keep nothing" to a session with no grant.
    expect(await screen.findByTestId('essentials-renew')).toBeTruthy();
    await pullToRefresh();
    expect(screen.getByTestId('essential-passport')).toBeTruthy();
    expect(parts.mem.removed).toEqual([]);
    // One password, and they are kept up to date again.
    await fireEvent.press(screen.getByTestId('essentials-renew'));
    await fireEvent.changeText(await screen.findByTestId('essentials-password-field'), PASSWORD);
    await fireEvent.press(screen.getByTestId('essentials-password-go'));
    await waitFor(() => expect(screen.queryByTestId('essentials-renew')).toBeNull());
    expect(t.vault.state.sessions.find((s) => !s.revoked)?.offlineGrant).toBeTruthy();
    expect(screen.getByTestId('essential-passport')).toBeTruthy();
  });

  it('the offer, the password, the list and the viewer work with a screen reader and a thumb — and with buttons alone', async () => {
    const t = testVault([ORIGIN]);
    t.vault.state.offlineEssentials.items = [passport()];
    await start(t);
    expect(await screen.findByTestId('essentials-keep')).toBeTruthy();
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByTestId('essentials-keep'));
    await screen.findByTestId('essentials-password-field');
    expect(audit()).toEqual([]);
    await fireEvent.changeText(screen.getByTestId('essentials-password-field'), PASSWORD);
    await fireEvent.press(screen.getByTestId('essentials-password-go'));
    await screen.findByTestId('essential-passport');
    expect(audit()).toEqual([]);

    await fireEvent.press(screen.getByLabelText('Open: Passport'));
    await screen.findByTestId('essential-image');
    expect(audit()).toEqual([]);
    // Pages by Previous and Next; size by Larger and Smaller — no swipe, no pinch.
    const width = () => Number(StyleSheet.flatten(screen.getByTestId('essential-image').props.style).width);
    const at = width();
    await fireEvent.press(screen.getByTestId('essential-larger'));
    await waitFor(() => expect(width()).toBeGreaterThan(at));
    await fireEvent.press(screen.getByTestId('essential-smaller'));
    await waitFor(() => expect(width()).toBe(at));
    await fireEvent.press(screen.getByTestId('essential-next'));
    await waitFor(() => expect(screen.getByTestId('essential-page')).toHaveTextContent('Page 2 of 2'));
    await fireEvent.press(screen.getByTestId('essential-previous'));
    await waitFor(() => expect(screen.getByTestId('essential-page')).toHaveTextContent('Page 1 of 2'));
  });

  it('somebody else signing in is offered afresh: the last person’s choice is not theirs, and no grant is taken', async () => {
    const t = testVault([ORIGIN]);
    t.vault.state.offlineEssentials.items = [passport()];
    const parts = phoneParts();
    // The last person kept theirs here, and their session simply expired.
    const left = await parts.mem.io.open('everyday');
    await left.putDocument({
      id: 'their-will',
      version_id: 'w1',
      view: '{"title":"Their will"}',
      pages: 1,
      kept_at: 1,
    });
    await left.setState(OWNER_KEY, 'https://vault.test|somebody-else');
    writePrefs('essentials', {
      enrolled: true,
      offered: true,
      kept: true,
      expired: true,
      owner: 'https://vault.test|somebody-else',
    });
    knownVault(ORIGIN, { email: 'owner@example.test' });
    t.vault.state.email = 'owner@example.test';
    t.vault.state.password = PASSWORD;
    await renderApp(<App />, { fetch: t.fetch, lock: parts.lock, essentials: parts.essentials });
    await fireEvent.changeText(await screen.findByTestId('sign-in-email'), 'owner@example.test');
    await fireEvent.changeText(screen.getByTestId('sign-in-password'), PASSWORD);
    await fireEvent.press(screen.getByTestId('sign-in-go'));
    // Offered, as to anyone new — the password typed to sign in was not used for a grant.
    expect(await screen.findByTestId('essentials-keep')).toBeTruthy();
    expect(t.vault.state.sessions.some((x) => x.offlineGrant)).toBe(false);
    expect(parts.mem.removed).toContain('everyday');
    expect(screen.queryByText('Their will')).toBeNull();
  });

  it('a lapsed grant asks for the password on Home, and one brings the copies back', async () => {
    const t = testVault([ORIGIN]);
    t.vault.state.offlineEssentials.items = [passport()];
    await start(t);
    await keep();
    await screen.findByTestId('essential-passport');
    // Thirty days on: the vault's set says keep nothing.
    for (const x of t.vault.state.sessions) x.offlineGrant = null;
    await pullToRefresh();
    await waitFor(() => expect(screen.queryByTestId('essential-passport')).toBeNull());
    await fireEvent.press(await screen.findByTestId('essentials-renew'));
    await fireEvent.changeText(await screen.findByTestId('essentials-password-field'), PASSWORD);
    await fireEvent.press(screen.getByTestId('essentials-password-go'));
    expect(await screen.findByTestId('essential-passport')).toBeTruthy();
    expect(screen.queryByTestId('essentials-renew')).toBeNull();
  });

  it('a cold start with no connection still shows what is kept', async () => {
    const t = testVault([ORIGIN]);
    const parts = phoneParts();
    const kept = await parts.mem.io.open('everyday');
    await kept.putDocument({
      id: 'passport',
      version_id: 'passport-v1',
      view: JSON.stringify(passport(1).document),
      pages: 1,
      kept_at: 1,
    });
    await kept.putPage('passport-v1', 1, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
    await kept.setState(OWNER_KEY, 'https://vault.test|fake-member');
    await kept.setState(
      CHECKED_KEY,
      JSON.stringify({ server_time: '2026-09-20T00:00:00Z', at: Date.now() - 86_400_000, max_offline_days: 90 }),
    );
    writePrefs('essentials', { enrolled: true, offered: true, kept: true, owner: 'https://vault.test|fake-member' });
    await signedIn(t);
    // Airplane mode from the first moment: what the vault can do is not known.
    t.reachable.delete(ORIGIN);
    await renderApp(<App />, { fetch: t.fetch, lock: parts.lock, essentials: parts.essentials });
    await fireEvent.press(await screen.findByTestId('lock-unlock'));
    expect(await screen.findByTestId('essential-passport')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Open: Passport'));
    expect(await screen.findByTestId('essential-image')).toBeTruthy();
  });

  it('a document whose pages are still being drawn says so, not that it cannot be shown', async () => {
    const t = testVault([ORIGIN]);
    const drawing = passport();
    drawing.version = { ...drawing.version, preview_pages: null, preview_state: 'queued' };
    t.vault.state.offlineEssentials.items = [drawing];
    await start(t);
    await keep();
    await fireEvent.press(await screen.findByLabelText('Open: Passport'));
    expect(await screen.findByTestId('essential-pending')).toBeTruthy();
    expect(screen.queryByTestId('essential-no-preview')).toBeNull();
  });

  it('a revoke that lands while the copies are still opening removes them all the same', async () => {
    const t = testVault([ORIGIN]);
    const parts = phoneParts();
    // As expo-sqlite does: an open database is not deleted.
    const store = new MemoryEssentialsStore();
    await store.putDocument({
      id: 'passport',
      version_id: 'passport-v1',
      view: '{"title":"Passport"}',
      pages: 1,
      kept_at: 1,
    });
    await store.setState(OWNER_KEY, 'https://vault.test|fake-member');
    let open = 0;
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => {
      release = r;
    });
    const removed: string[] = [];
    const realClose = store.close.bind(store);
    store.close = async () => {
      open = Math.max(0, open - 1);
      await realClose();
    };
    parts.essentials.io = {
      // Held open from the moment opening starts, as a real database is.
      open: async () => {
        open += 1;
        await held;
        return store;
      },
      remove: async (tier) => {
        if (open > 0) throw new Error('Unable to delete database: it is currently open');
        removed.push(tier);
      },
    };
    writePrefs('essentials', { enrolled: true, offered: true, kept: true, owner: 'https://vault.test|fake-member' });
    await start(t, parts);
    // The store is still opening when the vault says the session is over.
    for (const x of t.vault.state.sessions) x.revoked = true;
    await act(async () => {
      await grabbed.vault?.withToken((a, token) => a.documents(token, { limit: 1 })).catch(() => undefined);
    });
    await act(async () => release());
    await waitFor(() => expect(removed).toEqual(expect.arrayContaining(['everyday', 'private'])));
    expect(open).toBe(0);
  });

  it('somebody else’s copies are gone before anything is shown', async () => {
    const t = testVault([ORIGIN]);
    const parts = phoneParts();
    const left = await parts.mem.io.open('everyday');
    await left.putDocument({
      id: 'their-will',
      version_id: 'w1',
      view: '{"title":"Their will"}',
      pages: 1,
      kept_at: 1,
    });
    await left.setState(OWNER_KEY, 'https://vault.test|somebody-else');
    writePrefs('essentials', { enrolled: true, offered: true, kept: true });
    await start(t, parts);
    await waitFor(() => expect(parts.mem.removed).toContain('everyday'));
    expect(screen.queryByText('Their will')).toBeNull();
  });

  it('copies unchecked past the limit are removed at the next unlock, and it says so', async () => {
    const t = testVault([ORIGIN]);
    const parts = phoneParts();
    const old = await parts.mem.io.open('everyday');
    await old.putDocument({
      id: 'passport',
      version_id: 'passport-v1',
      view: '{"title":"Passport"}',
      pages: 1,
      kept_at: 1,
    });
    await old.setState(OWNER_KEY, 'https://vault.test|fake-member');
    await old.setState(
      CHECKED_KEY,
      JSON.stringify({ server_time: '2026-01-01T00:00:00Z', at: Date.now() - 200 * 86_400_000, max_offline_days: 90 }),
    );
    writePrefs('essentials', { enrolled: true, offered: true, kept: true });
    await start(t, parts);
    expect(
      await screen.findByText(
        "These copies went a long time without checking in with the vault, so they've been removed. They'll come back when you're online.",
      ),
    ).toBeTruthy();
    expect(parts.mem.removed).toContain('everyday');
  });
});
