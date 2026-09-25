import type { DocumentView, OfflineItem } from '@fdv/shared';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useEffect, useState } from 'react';
import Home from '../app/index';
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
import { installed, renderApp, signedIn } from '../test-support/render';
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

function App() {
  const { phase } = useVault();
  const { status } = useLock();
  const [viewing, setViewing] = useState<{ id: string; mode?: string } | null>(null);
  useEffect(() => {
    mockNav.go = (p) => setViewing(p.params);
  }, []);
  const content =
    phase !== 'ready' || status === 'checking' ? null : viewing ? (
      <>
        <Button label="Back" testID="viewer-back" onPress={() => setViewing(null)} />
        <EssentialPages id={viewing.id} {...(viewing.mode ? { mode: viewing.mode } : {})} />
      </>
    ) : (
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

async function start(t: TestVault, parts = phoneParts()) {
  await signedIn(t);
  await renderApp(<App />, { fetch: t.fetch, lock: parts.lock, essentials: parts.essentials });
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
const grabbed: { sync: (() => Promise<void>) | null } = { sync: null };
function Grab() {
  const { sync } = useEssentials();
  useEffect(() => {
    grabbed.sync = sync;
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
  });

  it('an expired session keeps them readable', async () => {
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
    await waitFor(() => expect(screen.queryByTestId('home-calm')).toBeNull());
    expect(parts.mem.removed).toEqual([]);
    expect(await parts.mem.stores.get('everyday')!.document('passport')).not.toBeNull();
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
