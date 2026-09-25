import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { LockGate } from '../lock/gate';
import { phoneParts } from '../test-support/lookup';
import { FakePushNative } from '../test-support/push';
import { installed, renderApp, signedIn } from '../test-support/render';
import { resetRoutes, routes } from '../test-support/router';
import { testVault } from '../test-support/vault';
import { PushLinks } from './links';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-router', () => require('../test-support/router').routerMock);

describe('a tapped notification (4.14)', () => {
  beforeEach(() => {
    installed();
    resetRoutes();
  });

  it('a tap opens Needs attention only after unlock', async () => {
    const t = testVault();
    const fake = new FakePushNative();
    // The tap that started the app: "3 things need attention".
    fake.open = 'needs-attention';
    const parts = phoneParts();
    await signedIn(t);
    await renderApp(
      <>
        <PushLinks />
        <LockGate>
          <Text>The app</Text>
        </LockGate>
      </>,
      { fetch: t.fetch, lock: parts.lock, essentials: parts.essentials, push: { native: fake } },
    );
    await screen.findByTestId('lock-unlock');
    // Locked: nothing opened, and the tap is kept for later.
    expect(routes()).toEqual([]);
    expect(fake.open).toBe('needs-attention');
    await fireEvent.press(screen.getByTestId('lock-unlock'));
    await waitFor(() => expect(routes().map((r) => r.pathname)).toEqual(['/attention']));
    expect(fake.open).toBeNull();

    // Open and unlocked: "a new device signed in" opens Settings.
    await act(async () => fake.tap('devices'));
    await waitFor(() => expect(routes().map((r) => r.pathname)).toEqual(['/attention', '/settings']));
    // A word the app does not know opens nothing.
    await act(async () => fake.tap('somewhere-else'));
    expect(routes()).toHaveLength(2);
  });
});
