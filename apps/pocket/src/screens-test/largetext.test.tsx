import { type as typeScale } from '@fdv/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import Connect from '../app/connect';
import { AddButton } from '../capture/add-button';
import { fixtureScanner } from '../capture/scanner';
import Settings from '../app/settings';
import SignIn from '../app/sign-in';
import { readPrefs } from '../platform/prefs';
import { installed, knownVault, renderApp, signedIn, testCapture } from '../test-support/render';
import { testVault } from '../test-support/vault';
import { TabBar } from '../ui/tab-bar';
import { LARGE } from '../ui/text-scale';

jest.mock('expo-router', () => ({
  Link: (p: { children: unknown }) => p.children,
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

/** Every piece of text and every field on the screen, with its size. */
function sizes(): { what: string; size: number; cut: boolean }[] {
  const root = screen.root;
  if (!root) return [];
  return root
    .queryAll((n) => n.type === 'Text' || n.type === 'TextInput')
    .map((n) => {
      const style = StyleSheet.flatten(n.props.style) ?? {};
      const words = n.children.filter((c) => typeof c === 'string').join('');
      return {
        what: `${n.type} ${n.props.testID ?? words.slice(0, 30)}`,
        size: Number(style.fontSize ?? 0),
        cut: n.props.numberOfLines !== undefined || n.props.adjustsFontSizeToFit === true || n.props.allowFontScaling === false,
      };
    });
}

/** The same words, each 1.3 times the size, and none cut short. */
function expectScaled(before: ReturnType<typeof sizes>, after: ReturnType<typeof sizes>) {
  expect(after.map((a) => a.what)).toEqual(before.map((b) => b.what));
  after.forEach((a, i) => {
    const b = before[i];
    if (!b) throw new Error(`nothing to compare ${a.what} with`);
    expect({ what: a.what, size: a.size }).toEqual({ what: a.what, size: expect.closeTo(b.size * LARGE, 5) });
    expect({ what: a.what, cut: a.cut }).toEqual({ what: a.what, cut: false });
  });
}

/**
 * How wide a word is drawn in Roboto, Android's own face: its letters'
 * advance widths (in 1/2048 em), and a tenth more for a selected tab's
 * heavier weight. A guard against a label that cannot fit, not a
 * measurement; a letter not listed here fails the test until it is.
 */
const ROBOTO: Record<string, number> = {
  A: 1336, H: 1428, P: 1292, S: 1216,
  a: 1088, c: 1049, e: 1058, h: 1103, i: 486, l: 486, m: 1753, n: 1103, o: 1140, p: 1120, r: 677, t: 654,
};
function drawnWidth(word: string, fontSize: number): number {
  const units = [...word].reduce((sum, c) => {
    const w = ROBOTO[c];
    if (w === undefined) throw new Error(`no advance width for "${c}" (in "${word}"): add it to ROBOTO`);
    return sum + w;
  }, 0);
  return (units / 2048) * fontSize * 1.1;
}

const TAB_STATE = {
  index: 0,
  routes: ['index', 'search', 'attention', 'people'].map((name) => ({ key: name, name })),
};

describe('Large text', () => {
  beforeEach(() => installed());

  it.each([
    ['Connect', () => <Connect />],
    ['Sign in', () => <SignIn />],
  ])('%s: every word is 1.3 times the size, and nothing is cut short', async (_name, screenFor) => {
    knownVault();
    const normal = await renderApp(screenFor(), { large: false });
    await screen.findAllByText(/.+/);
    const before = sizes();
    await normal.unmount();

    await renderApp(screenFor(), { large: true });
    await screen.findAllByText(/.+/);
    const after = sizes();

    expect(after.map((a) => a.what)).toEqual(before.map((b) => b.what));
    expect(before.length).toBeGreaterThan(3);
    after.forEach((a, i) => {
      const b = before[i];
      if (!b) throw new Error(`nothing to compare ${a.what} with`);
      expect({ what: a.what, size: a.size }).toEqual({ what: a.what, size: expect.closeTo(b.size * LARGE, 5) });
      expect({ what: a.what, cut: a.cut }).toEqual({ what: a.what, cut: false });
    });
  });

  it('the switch in Settings changes it at once, and it is still on next time', async () => {
    const t = testVault();
    await signedIn(t);
    const first = await renderApp(<Settings />, { fetch: t.fetch });
    await screen.findByTestId('settings-sign-out');
    const signOutSize = () =>
      Number(StyleSheet.flatten(screen.getByText('Sign out').props.style)?.fontSize ?? 0);
    expect(signOutSize()).toBe(typeScale.body);

    await fireEvent(screen.getByTestId('settings-large-text'), 'valueChange', true);
    await waitFor(() => expect(signOutSize()).toBeCloseTo(typeScale.body * LARGE, 5));
    expect(readPrefs<{ large?: boolean }>('display', {})).toEqual({ large: true });
    await first.unmount();

    // The next launch reads what was chosen.
    await renderApp(<Settings />, { fetch: t.fetch });
    await screen.findByTestId('settings-sign-out');
    expect(signOutSize()).toBeCloseTo(typeScale.body * LARGE, 5);
    expect(screen.getByTestId('settings-large-text').props.value).toBe(true);
  });

  it("the +'s menu: every word is 1.3 times the size, nothing is cut short, and the choices scroll", async () => {
    const t = testVault();
    await signedIn(t);
    const open = async (large: boolean) => {
      const r = await renderApp(<AddButton />, {
        fetch: t.fetch,
        large,
        capture: testCapture({ scanner: fixtureScanner([]) }),
      });
      await fireEvent.press(await screen.findByTestId('home-add'));
      await screen.findByTestId('add-menu');
      return r;
    };
    const normal = await open(false);
    const before = sizes();
    await normal.unmount();

    await open(true);
    // The title, three choices and Cancel.
    expect(before.length).toBeGreaterThanOrEqual(5);
    expectScaled(before, sizes());
    // At the phone's largest text the choices scroll rather than run off the screen.
    expect(within(screen.getByTestId('add-menu-scroll')).getAllByRole('menuitem')).toHaveLength(3);
  });

  it.each([false, true])(
    'the tab bar on a 360 dp phone (Large text %s): each label fits its own tab, clear of the +',
    async (large) => {
      const t = testVault();
      await signedIn(t);
      const bar = async (at: boolean) => {
        const r = await renderApp(<TabBar state={TAB_STATE} navigation={{ navigate: () => undefined }} />, {
          fetch: t.fetch,
          large: at,
          capture: testCapture({ scanner: fixtureScanner([]) }),
        });
        await screen.findByTestId('home-add');
        return r;
      };
      if (large) {
        // Every word 1.3 times the size of the same bar without Large text, nothing cut short.
        const normal = await bar(false);
        const before = sizes();
        await normal.unmount();
        await bar(true);
        expectScaled(before, sizes());
      } else {
        await bar(false);
      }

      const style = (id: string) => StyleSheet.flatten(screen.getByTestId(id).props.style) ?? {};
      // The + keeps a fixed slot with air either side; each tab an equal share, never more.
      const slot = Number(style('home-add-slot').width);
      const plus = Number(style('home-add').width);
      expect(plus).toBeGreaterThanOrEqual(44);
      expect(slot).toBeGreaterThanOrEqual(plus + 8);
      const tabs = ['tab-home', 'tab-search', 'tab-attention', 'tab-people'];
      for (const id of tabs) expect(style(id)).toMatchObject({ flex: 1 });
      const edge = Number(style('tab-bar').paddingHorizontal ?? 0);
      const inset = Number(style('tab-home').paddingHorizontal ?? 0);
      const room = (360 - 2 * edge - slot) / tabs.length - 2 * inset;

      for (const id of tabs) {
        const label = within(screen.getByTestId(id)).getByText(/\S/);
        const word = String(label.props.children);
        const size = Number(StyleSheet.flatten(label.props.style)?.fontSize);
        // One word: nothing to break onto a second line.
        expect({ id, word, oneWord: !/\s/.test(word) }).toEqual({ id, word, oneWord: true });
        expect({ id, word, fits: drawnWidth(word, size) <= room }).toEqual({ id, word, fits: true });
      }
      // The shortened label still says it all to a screen reader.
      expect(screen.getByTestId('tab-attention').props.accessibilityLabel).toBe('Needs attention');
      expect(within(screen.getByTestId('tab-attention')).getByText('Attention')).toBeTruthy();
    },
  );
});
