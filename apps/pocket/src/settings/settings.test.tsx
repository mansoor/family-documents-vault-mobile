import type { DocumentView } from '@fdv/shared';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Linking from 'expo-linking';
import { AppState } from 'react-native';
import Settings from '../app/settings';
import { MemoryEssentialsStore } from '../essentials/store';
import { CHECKED_KEY } from '../essentials/sync';
import { OWNER_KEY } from '../essentials/wipe';
import { readPrefs, writePrefs } from '../platform/prefs';
import type { QueueItem } from '../queue/item';
import { MemoryQueueStore } from '../queue/store';
import { readVaults } from '../state/vaults';
import { audit } from '../test-support/a11y';
import { LookupApp, phoneParts, unlocked } from '../test-support/lookup';
import { installed, renderApp, signedIn, testCapture } from '../test-support/render';
import { resetRoutes, routes } from '../test-support/router';
import { testVault } from '../test-support/vault';
import { sizeWords } from './offline';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-router', () => require('../test-support/router').routerMock);
jest.mock('expo-linking', () => ({ openURL: jest.fn(async () => true) }));

const OWNER = 'https://vault.test|fake-member';

/** A phone that keeps one Essential of 3 KB, checked today. */
async function keepOne(parts: ReturnType<typeof phoneParts>) {
  const kept = new MemoryEssentialsStore();
  parts.stores.set('everyday', kept);
  const view = { id: 'passport', title: 'Passport', owner_member_id: 'fake-member' } as DocumentView;
  await kept.putDocument({
    id: 'passport',
    version_id: 'passport-v1',
    view: JSON.stringify(view),
    pages: 1,
    kept_at: 1,
  });
  await kept.putPage('passport-v1', 1, new Uint8Array(3 * 1024));
  await kept.setState(OWNER_KEY, OWNER);
  await kept.setState(
    CHECKED_KEY,
    JSON.stringify({ server_time: '2026-09-25T00:00:00Z', at: Date.now(), max_offline_days: 90 }),
  );
  writePrefs('essentials', { enrolled: true, offered: true, kept: true, owner: OWNER });
}

/** A scan still waiting for the vault (not due to be sent for an hour). */
const waiting = (): QueueItem => ({
  id: 'q1',
  kind: 'capture',
  target: null,
  key: '5b1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
  origin: 'https://vault.test',
  account: 'fake-member',
  createdAt: 1,
  state: 'waiting',
  metadata: { title: 'Waiting letter' },
  filename: 'Scan.pdf',
  mime: 'application/pdf',
  size: 4,
  attempts: 1,
  nextAt: Date.now() + 3_600_000,
  askFirst: false,
  problem: null,
  lastCode: null,
});

describe('Settings, in full (4.15)', () => {
  beforeEach(() => {
    installed();
    resetRoutes();
    jest.mocked(Linking.openURL).mockClear();
  });

  it('signing out another device calls DELETE /auth/sessions/{id}', async () => {
    const t = testVault();
    await unlocked(t, <Settings />);
    expect(await screen.findByText('the app on a Test Phone 1 (this phone)')).toBeTruthy();
    // This phone is signed out with Sign out, not from the list.
    expect(screen.queryByTestId('settings-device-sign-out-this-phone')).toBeNull();
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByTestId('settings-device-sign-out-laptop'));
    await fireEvent.press(screen.getByTestId('settings-device-confirm-laptop'));
    await waitFor(() => expect(t.calls).toContain('DELETE https://vault.test/api/v1/auth/sessions/laptop'));
    await waitFor(() => expect(screen.queryByTestId('settings-device-laptop')).toBeNull());
    expect(screen.getByTestId('settings-device-this-phone')).toBeTruthy();
  });

  it('Remove offline copies ends the grant and wipes', async () => {
    const t = testVault();
    const parts = phoneParts();
    await keepOne(parts);
    // Signed in, then the vault out of reach: what is kept is not synced away before it is looked at.
    await unlocked(t, <Settings />, { parts, before: () => void t.reachable.delete('https://vault.test') });
    expect(await screen.findByTestId('settings-offline-summary')).toHaveTextContent(
      'One document kept on this phone, taking 3 KB.',
    );
    expect(audit()).toEqual([]);
    t.reachable.add('https://vault.test');
    await fireEvent.press(screen.getByTestId('settings-offline-remove'));
    await fireEvent.press(await screen.findByTestId('settings-offline-remove-yes'));
    await waitFor(() => expect(t.calls).toContain('DELETE https://vault.test/api/v1/offline/grant'));
    await waitFor(() => expect(parts.stores.size).toBe(0));
    expect(readPrefs<{ enrolled?: boolean }>('essentials', {}).enrolled).toBe(false);
    // Nothing kept any more (and, the vault not heard from since the start, nothing offered either).
    await waitFor(() => expect(screen.queryByTestId('settings-offline-summary')).toBeNull());
  });

  it("Change server wipes that server's data", async () => {
    const t = testVault();
    const parts = phoneParts();
    await keepOne(parts);
    const queue = new MemoryQueueStore();
    await queue.add(waiting(), new Uint8Array([1, 2, 3, 4]));
    await unlocked(t, <Settings />, { parts, capture: testCapture({ openStore: async () => queue }) });
    await fireEvent.press(await screen.findByTestId('settings-change-vault'));
    const question = await screen.findByTestId('change-vault-question');
    expect(question).toHaveTextContent('Changing the vault signs you out and removes everything kept on this phone.', {
      exact: false,
    });
    expect(question).toHaveTextContent("A scan hasn't reached this vault yet. It will be removed too.", {
      exact: false,
    });
    await fireEvent.press(screen.getByTestId('change-vault-yes'));
    await waitFor(() => expect(readVaults().known).toEqual([]));
    expect(t.calls).toContain('POST https://vault.test/api/v1/auth/logout');
    expect(await queue.list()).toEqual([]);
    await waitFor(() => expect(parts.stores.size).toBe(0));
  });

  it("Use another vault removes everybody's waiting scans for it, and says which are already on their way", async () => {
    const t = testVault();
    const queue = new MemoryQueueStore();
    await queue.add(waiting(), new Uint8Array([1]));
    await queue.add({ ...waiting(), id: 'q2', account: 'someone-else' }, new Uint8Array([2]));
    await queue.add({ ...waiting(), id: 'q3', state: 'sending' }, new Uint8Array([3]));
    await queue.add({ ...waiting(), id: 'q4', origin: 'https://other.test' }, new Uint8Array([4]));
    await queue.cache('card|https://vault.test|fake-member', { types: [] });
    await unlocked(t, <Settings />, { capture: testCapture({ openStore: async () => queue }) });
    await fireEvent.press(await screen.findByTestId('settings-change-vault'));
    const question = await screen.findByTestId('change-vault-question');
    expect(question).toHaveTextContent("2 scans haven't reached this vault yet. They will be removed too.", {
      exact: false,
    });
    expect(question).toHaveTextContent('One is already on its way and will reach the vault.', { exact: false });
    await fireEvent.press(screen.getByTestId('change-vault-yes'));
    await waitFor(() => expect(readVaults().known).toEqual([]));
    // The one on its way is left to arrive; another vault's scan is not this one's to remove.
    expect((await queue.list()).map((i) => i.id).sort()).toEqual(['q3', 'q4']);
    expect(await queue.cached('card|https://vault.test|fake-member')).toBeNull();
  });

  it('Remove offline copies without a connection keeps what was opened, and tells the vault later', async () => {
    const t = testVault();
    const parts = phoneParts();
    await keepOne(parts);
    await parts.stores.get('everyday')?.recordOpen({
      id: 'open-1',
      document_id: 'passport',
      version_id: 'passport-v1',
      at: Date.now(),
      mode: 'view',
      online: false,
    });
    await unlocked(t, <Settings />, { parts, before: () => void t.reachable.delete('https://vault.test') });
    await fireEvent.press(await screen.findByTestId('settings-offline-remove'));
    await fireEvent.press(await screen.findByTestId('settings-offline-remove-yes'));
    await waitFor(() => expect(parts.stores.size).toBe(0));
    expect(readPrefs<{ id: string }[]>('essentials-unsent-opens', []).map((o) => o.id)).toEqual(['open-1']);
    expect(t.calls.filter((c) => c.includes('/offline/opens'))).toEqual([]);
    // The connection comes back: they are told, and forgotten here.
    Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
    t.reachable.add('https://vault.test');
    const listeners = (globalThis as unknown as { __networkListeners: Set<() => void> }).__networkListeners;
    await act(async () => {
      for (const l of [...listeners]) l();
    });
    await waitFor(() => expect(t.calls.some((c) => c.includes('/offline/opens'))).toBe(true));
    await waitFor(() => expect(readPrefs('essentials-unsent-opens', null)).toEqual([]));
  });

  it('About lists the licences, and the rest is in the browser', async () => {
    const t = testVault();
    await unlocked(t, <Settings />);
    await fireEvent.press(await screen.findByTestId('settings-licences'));
    expect(routes().map((r) => r.pathname)).toEqual(['/licences']);
    resetRoutes();
    await fireEvent.press(screen.getByTestId('settings-in-browser'));
    expect(Linking.openURL).toHaveBeenCalledWith('https://vault.test');
  });

  it('a vault reached over plain http is marked not secure', async () => {
    const t = testVault(['http://192.168.1.20:8080']);
    await signedIn(t, 'http://192.168.1.20:8080');
    const parts = phoneParts();
    await renderApp(<LookupApp start={<Settings />} />, {
      fetch: t.fetch,
      lock: parts.lock,
      essentials: parts.essentials,
    });
    await fireEvent.press(await screen.findByTestId('lock-unlock'));
    expect(await screen.findByTestId('settings-not-secure')).toHaveTextContent(
      'Not secure: reached without encryption, on your home network only.',
    );
  });

  it('sizes read as people say them', () => {
    expect(sizeWords(0)).toBe('1 KB');
    expect(sizeWords(3 * 1024)).toBe('3 KB');
    expect(sizeWords(4.25 * 1024 * 1024)).toBe('4.3 MB');
  });
});
