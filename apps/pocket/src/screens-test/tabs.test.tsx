import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { AccessibilityInfo } from 'react-native';
import Home from '../app/(tabs)/index';
import PeopleScreen from '../app/(tabs)/people';
import { SecureTokenStore } from '../session/store';
import { audit } from '../test-support/a11y';
import { unlocked } from '../test-support/lookup';
import { fixtureScanner, type ScanOutcome } from '../capture/scanner';
import { MAX_PAGES } from '../queue/commit';
import { reply } from '../test-support/capture';
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

/**
 * Somebody signed in with this role, as the phone keeps it, looking at the
 * tab bar (or `ui`); by default on a phone with a scanner.
 */
async function as(role: string, scanner = fixtureScanner([]), ui?: ReactElement) {
  installed();
  const t = testVault([ORIGIN]);
  await signedIn(t);
  // The fake signs everybody in as its owner: the phone keeps this role instead.
  const store = new SecureTokenStore();
  const kept = await store.load();
  await store.save({ ...(kept as NonNullable<typeof kept>), role: role as never });
  // …and the vault says so too, whenever it says who this is (who am I, a refreshed session).
  const fetch: typeof t.fetch = async (url, init) => {
    const res = await t.fetch(url, init);
    if (!/\/api\/v1\/(me|auth\/)/.test(url) || res.status !== 200) return res;
    const body = (await res.json()) as Record<string, unknown>;
    return reply(200, 'role' in body ? { ...body, role } : body);
  };
  const navigated: string[] = [];
  await renderApp(ui ?? <TabBar state={STATE} navigation={{ navigate: (n) => void navigated.push(n) }} />, {
    fetch,
    capture: testCapture({ scanner }),
  });
  return navigated;
}

/** The menu's choices, as a screen reader lists them. */
const choices = () => within(screen.getByTestId('add-menu')).getAllByRole('menuitem');

beforeEach(() => resetRoutes());

describe('the tab bar', () => {
  it('without document.add (a viewer) there is no +; with it (an owner, a teen) there is, scanner or not', async () => {
    await as('viewer');
    expect(await screen.findByTestId('tab-home')).toBeTruthy();
    expect(screen.queryByTestId('home-add')).toBeNull();
    await screen.unmount();
    for (const role of ['owner', 'teen']) {
      for (const scans of [true, false]) {
        await as(role, fixtureScanner([], scans));
        expect(await screen.findByTestId('home-add')).toBeTruthy();
        await screen.unmount();
      }
    }
  });

  it('Home, Search, the +, Needs attention, People — each a named tab, in that order', async () => {
    const navigated = await as('owner');
    const order = ['tab-home', 'tab-search', 'home-add', 'tab-attention', 'tab-people'];
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

  it('Needs attention is "Attention" on its tab, and its whole name to a screen reader', async () => {
    await as('owner');
    const tab = await screen.findByTestId('tab-attention');
    expect(within(tab).getByText('Attention')).toBeTruthy();
    expect(tab.props.accessibilityLabel).toBe('Needs attention');
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

describe('Home, with the + as the way to add', () => {
  it('has no add buttons of its own; with nothing yet, it points to the +', async () => {
    await as('owner', fixtureScanner([]), <Home />);
    expect(await screen.findByTestId('home-none')).toHaveTextContent(
      'No documents yet. Add one with the + button below.',
    );
    expect(screen.queryByText('Add a file')).toBeNull();
    expect(screen.queryByText('Add a photo')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Add a/ })).toBeNull();
  });

  it('to a viewer, who has no +, it only says there is nothing yet', async () => {
    await as('viewer', fixtureScanner([]), <Home />);
    expect(await screen.findByTestId('home-none')).toHaveTextContent(/^No documents yet\.$/);
  });
});

describe('the + and its menu', () => {
  const focus = jest.mocked(AccessibilityInfo.sendAccessibilityEvent);
  beforeEach(() => focus.mockClear());

  it('says what it does, and opens a menu: Add a file, Camera, Add a picture', async () => {
    await as('owner');
    const plus = await screen.findByTestId('home-add');
    expect(plus.props.accessibilityRole).toBe('button');
    expect(plus.props.accessibilityLabel).toBe('Add a document');
    expect(plus.props.accessibilityHint).toBe('Opens a menu: add a file, use the camera or add a picture.');
    expect(plus.props.accessibilityState).toEqual({ expanded: false });
    expect(screen.queryByTestId('add-menu')).toBeNull();

    await fireEvent.press(plus);
    const menu = await screen.findByTestId('add-menu');
    expect(menu.props.accessibilityViewIsModal).toBe(true);
    // A menu (not one element: TalkBack would read it as a single block) of menu items.
    const list = within(menu).getByTestId('add-menu-choices');
    expect(list.props).toMatchObject({ accessibilityRole: 'menu', accessibilityLabel: 'Add a document' });
    expect(within(list).getAllByRole('menuitem')).toHaveLength(3);
    expect(choices().map((c) => c.props.accessibilityLabel)).toEqual(['Add a file', 'Camera', 'Add a picture']);
    expect(choices().map((c) => c.props.testID)).toEqual(['add-file', 'add-camera', 'add-picture']);
    expect(within(menu).getByText('Add a file')).toBeTruthy();
    expect(within(menu).getByText('Camera')).toBeTruthy();
    expect(within(menu).getByText('Add a picture')).toBeTruthy();
    expect(screen.getByTestId('home-add').props.accessibilityState).toEqual({ expanded: true });
    // Every choice, Cancel included, is a named target of at least 44 dp.
    expect(audit()).toEqual([]);

    // Once it is on the screen, a screen reader starts on the first choice.
    await fireEvent(menu, 'show');
    expect(focus).toHaveBeenCalledTimes(1);
    expect(focus.mock.calls[0]?.[1]).toBe('focus');
  });

  it('on a phone without a scanner there is no Camera', async () => {
    await as('owner', fixtureScanner([], false));
    const plus = await screen.findByTestId('home-add');
    expect(plus.props.accessibilityHint).toBe('Opens a menu: add a file or a picture.');
    await fireEvent.press(plus);
    await screen.findByTestId('add-menu');
    expect(choices().map((c) => c.props.accessibilityLabel)).toEqual(['Add a file', 'Add a picture']);
    expect(screen.queryByTestId('add-camera')).toBeNull();
  });

  it.each([
    ['add-file', 'file'],
    ['add-camera', `scan:${MAX_PAGES}`],
    ['add-picture', 'photo'],
  ])('%s starts that capture, closes the menu and goes to the card', async (choice, asked) => {
    const scanner = fixtureScanner([{ kind: 'pages', pages: [{ uri: 'cache:/scan/1.jpg' }] }]);
    await as('owner', scanner);
    await fireEvent.press(await screen.findByTestId('home-add'));
    await fireEvent.press(await screen.findByTestId(choice));
    await waitFor(() => expect(routes()).toEqual([{ pathname: '/capture', params: {} }]));
    expect(scanner.asked).toEqual([asked]);
    expect(screen.queryByTestId('add-menu')).toBeNull();
  });

  it('Camera with a scanner that cannot start says so, where the + is', async () => {
    const failed: ScanOutcome = { kind: 'failed' };
    await as('owner', fixtureScanner([failed]));
    await fireEvent.press(await screen.findByTestId('home-add'));
    await fireEvent.press(await screen.findByTestId('add-camera'));
    expect(await screen.findByTestId('home-scanner-failed')).toHaveTextContent(/The scanner couldn't start/);
    expect(screen.queryByTestId('add-menu')).toBeNull();
    expect(routes()).toEqual([]);
  });

  it.each([
    ['Back', () => fireEvent(screen.getByTestId('add-menu'), 'requestClose')],
    // Outside the sheet is hidden from screen readers (they have Back and Cancel), not from a finger.
    ['a tap outside', () => fireEvent.press(screen.getByTestId('add-menu-outside', { includeHiddenElements: true }))],
    ['Cancel', () => fireEvent.press(screen.getByTestId('add-cancel'))],
  ])('%s closes it, starts nothing, and focus goes back to the +', async (_how, close) => {
    const scanner = fixtureScanner([]);
    await as('owner', scanner);
    await fireEvent.press(await screen.findByTestId('home-add'));
    await screen.findByTestId('add-menu');
    await close();
    expect(screen.queryByTestId('add-menu')).toBeNull();
    expect(screen.getByTestId('home-add').props.accessibilityState).toEqual({ expanded: false });
    expect(scanner.asked).toEqual([]);
    await waitFor(() => expect(focus).toHaveBeenCalledWith(expect.anything(), 'focus'));
  });
});
