import { darkColours, colours as lightColours } from '@fdv/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import * as ReactNative from 'react-native';
import Settings from '../app/settings';
import { readPrefs, writePrefs } from '../platform/prefs';
import { installed, renderApp, signedIn } from '../test-support/render';
import { testVault } from '../test-support/vault';

jest.mock('expo-router', () => ({
  Link: (p: { children: unknown }) => p.children,
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
  useNavigation: () => ({ addListener: () => () => undefined, dispatch: jest.fn() }),
}));

const ORIGIN = 'https://vault.test';

/** The colour a piece of text is drawn in. */
const ink = (words: string) => StyleSheet.flatten(screen.getByText(words).props.style).color;

beforeEach(() => {
  installed();
  writePrefs('theme', 'auto');
  jest.restoreAllMocks();
});

describe('light or dark (P4)', () => {
  it('follows the phone by default', async () => {
    jest.spyOn(ReactNative, 'useColorScheme').mockReturnValue('dark');
    const t = testVault([ORIGIN]);
    await signedIn(t);
    await renderApp(<Settings />, { fetch: t.fetch });
    expect(await screen.findByText('Large text')).toBeTruthy();
    expect(ink('Large text')).toBe(darkColours.ink);
    expect(screen.getByTestId('settings-theme-auto').props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );
  });

  it('Settings can fix it to Dark or Light, whatever the phone says, and the phone remembers', async () => {
    jest.spyOn(ReactNative, 'useColorScheme').mockReturnValue('light');
    const t = testVault([ORIGIN]);
    await signedIn(t);
    const first = await renderApp(<Settings />, { fetch: t.fetch });
    expect(await screen.findByText('Large text')).toBeTruthy();
    expect(ink('Large text')).toBe(lightColours.ink);

    await fireEvent.press(screen.getByTestId('settings-theme-dark'));
    await waitFor(() => expect(ink('Large text')).toBe(darkColours.ink));
    expect(readPrefs('theme', 'auto')).toBe('dark');

    // Opened again: still dark.
    first.unmount();
    await renderApp(<Settings />, { fetch: t.fetch });
    expect(await screen.findByText('Large text')).toBeTruthy();
    expect(ink('Large text')).toBe(darkColours.ink);

    await fireEvent.press(screen.getByTestId('settings-theme-light'));
    await waitFor(() => expect(ink('Large text')).toBe(lightColours.ink));
    expect(readPrefs('theme', 'auto')).toBe('light');
  });

  it('every role of the dark palette is there, so nothing is left in the light one', () => {
    expect(Object.keys(darkColours).sort()).toEqual(Object.keys(lightColours).sort());
    // A page's own white stays white in the dark: scans, previews, photos.
    expect(darkColours.paper).toBe('#FFFFFF');
  });
});
