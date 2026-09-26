import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import Settings from '../app/settings';
import { DocumentDetail } from '../documents/detail';
import { MemoryQueueStore } from '../queue/store';
import { libraryDoc, unlocked } from '../test-support/lookup';
import { installed, testCapture } from '../test-support/render';
import { resetRoutes, routes } from '../test-support/router';
import { testVault } from '../test-support/vault';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-router', () => require('../test-support/router').routerMock);

/**
 * Android's Back, one rule at a time (4.15). A sheet's Back is its Modal's
 * request to close (RN calls onRequestClose for it); elsewhere the rules
 * have their own tests, beside the screens they belong to:
 *
 *  - the capture card with a scan asks before discarding, "save or throw
 *    away" (confirm.test.tsx: Back with a scan on the card asks);
 *  - Show mode goes to the lock screen with the brightness put back
 *    (show.test.tsx: Back leaves Show mode for the lock screen);
 *  - the lock screen leaves the app, and reveals nothing (lock.test.tsx);
 *  - the + menu closes, and nothing is started (tabs.test.tsx: Back closes it).
 */
const back = (inside: string) => fireEvent(screen.getByTestId(inside), 'requestClose');

describe('Back', () => {
  beforeEach(() => {
    installed();
    resetRoutes();
  });

  it('on the step-up sheet cancels it: nothing is shown', async () => {
    const t = testVault();
    libraryDoc(t, { id: 'will', title: 'Will', is_essential: true }, { sensitive: true });
    await unlocked(t, <DocumentDetail id="will" />);
    await fireEvent.press(await screen.findByTestId('document-show'));
    await screen.findByTestId('step-up-sheet');
    await back('step-up-sheet');
    expect(await screen.findByTestId('document-notice')).toHaveTextContent(
      "It wasn't confirmed that it's you, so the pages aren't shown.",
    );
    expect(screen.queryByTestId('step-up-sheet')).toBeNull();
    expect(routes()).toEqual([]);
  });

  it('on "Use another vault?" keeps this one', async () => {
    const t = testVault();
    await unlocked(t, <Settings />);
    await fireEvent.press(await screen.findByTestId('settings-change-vault'));
    await screen.findByTestId('change-vault-question');
    await back('change-vault-question');
    await waitFor(() => expect(screen.queryByTestId('change-vault-question')).toBeNull());
    expect(t.calls.filter((c) => c.endsWith('/auth/logout'))).toEqual([]);
    expect(screen.getByTestId('settings-sign-out')).toBeTruthy();
  });

  it('on the sign-out question signs nobody out', async () => {
    const t = testVault();
    const queue = new MemoryQueueStore();
    await queue.add(
      {
        id: 'q1',
        kind: 'capture',
        target: null,
        key: '5b1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
        origin: 'https://vault.test',
        account: 'fake-member',
        createdAt: 1,
        state: 'needs_you',
        metadata: null,
        filename: 'Scan.pdf',
        mime: 'application/pdf',
        size: 1,
        attempts: 1,
        nextAt: 0,
        askFirst: false,
        problem: { status: 422, code: 'validation_failed', message: null },
        lastCode: null,
      },
      new Uint8Array([1]),
    );
    await unlocked(t, <Settings />, { capture: testCapture({ openStore: async () => queue }) });
    await waitFor(() => expect(screen.getByTestId('settings-sign-out')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('settings-sign-out'));
    await screen.findByTestId('sign-out-question');
    await back('sign-out-question');
    await waitFor(() => expect(screen.queryByTestId('sign-out-question')).toBeNull());
    expect(t.calls.filter((c) => c.endsWith('/auth/logout'))).toEqual([]);
  });
});
