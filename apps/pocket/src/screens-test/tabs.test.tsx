import { fireEvent, screen } from '@testing-library/react-native';
import PeopleScreen from '../app/(tabs)/people';
import { SecureTokenStore } from '../session/store';
import { audit } from '../test-support/a11y';
import { unlocked } from '../test-support/lookup';
import { fixtureScanner } from '../capture/scanner';
import { installed, renderApp, signedIn, testCapture } from '../test-support/render';
import { resetRoutes, routes } from '../test-support/router';
import { testVault } from '../test-support/vault';
import { TabBar } from '../ui/tab-bar';

jest.mock(
  'expo-router',
  () => jest.requireActual<typeof import('../test-support/router')>('../test-support/router').routerMock,
);

const ORIGIN = 'https://vault.test';
const STATE = {
  index: 0,
  routes: ['index', 'search', 'attention', 'people'].map((name) => ({ key: name, name })),
};

/** Somebody signed in with this role, as the phone keeps it. */
async function as(role: string) {
  installed();
  const t = testVault([ORIGIN]);
  await signedIn(t);
  // The fake signs everybody in as its owner: the phone keeps this role instead.
  const store = new SecureTokenStore();
  const kept = await store.load();
  await store.save({ ...(kept as NonNullable<typeof kept>), role: role as never });
  const navigated: string[] = [];
  await renderApp(<TabBar state={STATE} navigation={{ navigate: (n) => void navigated.push(n) }} />, {
    fetch: t.fetch,
    // A phone with a scanner: whether the camera shows is down to the role.
    capture: testCapture({ scanner: fixtureScanner([]) }),
  });
  return navigated;
}

beforeEach(() => resetRoutes());

describe('the tab bar', () => {
  it('without document.add (a viewer) there is no camera; with it (an owner, a teen) there is', async () => {
    await as('viewer');
    expect(await screen.findByTestId('tab-home')).toBeTruthy();
    expect(screen.queryByTestId('home-scan')).toBeNull();
    screen.unmount();
    for (const role of ['owner', 'teen']) {
      await as(role);
      expect(await screen.findByTestId('home-scan')).toBeTruthy();
      screen.unmount();
    }
  });

  it('Home, Search, the camera, Needs attention, People — each a named tab, in that order', async () => {
    const navigated = await as('owner');
    const order = ['tab-home', 'tab-search', 'home-scan', 'tab-attention', 'tab-people'];
    await screen.findByTestId('tab-people');
    const shown = screen.root
      ?.queryAll((n) => order.includes(String(n.props.testID)) && typeof n.type === 'string')
      .map((n) => String(n.props.testID));
    expect([...new Set(shown)]).toEqual(order);
    expect(screen.getByTestId('tab-home').props.accessibilityState).toEqual({ selected: true });
    await fireEvent.press(screen.getByTestId('tab-attention'));
    expect(navigated).toEqual(['attention']);
    expect(audit()).toEqual([]);
  });

  it('People lists the family, each leading to their documents', async () => {
    installed();
    const t = testVault([ORIGIN]);
    await unlocked(t, <PeopleScreen />);
    expect(await screen.findByTestId('person-fake-member')).toHaveTextContent(/Fake Owner \(you\)/);
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByTestId('person-fake-member'));
    expect(routes().at(-1)).toEqual({ pathname: '/person/[id]', params: { id: 'fake-member', name: 'Fake Owner' } });
  });
});
