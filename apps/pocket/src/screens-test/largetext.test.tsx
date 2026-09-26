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
    const after = sizes();
    expect(after.map((a) => a.what)).toEqual(before.map((b) => b.what));
    // The title, three choices and Cancel.
    expect(before.length).toBeGreaterThanOrEqual(5);
    after.forEach((a, i) => {
      const b = before[i];
      if (!b) throw new Error(`nothing to compare ${a.what} with`);
      expect({ what: a.what, size: a.size }).toEqual({ what: a.what, size: expect.closeTo(b.size * LARGE, 5) });
      expect({ what: a.what, cut: a.cut }).toEqual({ what: a.what, cut: false });
    });
    // At the phone's largest text the choices scroll rather than run off the screen.
    expect(within(screen.getByTestId('add-menu-scroll')).getAllByRole('menuitem')).toHaveLength(3);
  });
});
