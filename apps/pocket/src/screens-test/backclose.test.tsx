import { fireEvent, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { AppHeader, headerFor } from '../ui/app-header';
import { audit } from '../test-support/a11y';
import { libraryDoc, unlocked } from '../test-support/lookup';
import { installed } from '../test-support/render';
import { push, resetRoutes, routes } from '../test-support/router';
import { testVault } from '../test-support/vault';
import { EssentialPages } from '../essentials/pages';

jest.mock(
  'expo-router',
  () => jest.requireActual<typeof import('../test-support/router')>('../test-support/router').routerMock,
);

/**
 * A ← on a page opened from a list and left again (a document's, a note's,
 * a collection's), and ✕ on the pages (the owner's ask of 12 Nov 2026).
 */

const ORIGIN = 'https://vault.test';

beforeEach(() => {
  installed();
  resetRoutes();
});

describe('the bar’s ←', () => {
  it('on a page that asks for it, before its buttons; it goes back where it came from', async () => {
    const t = testVault([ORIGIN]);
    // Opened from Documents: going back leaves it.
    push('/documents');
    await unlocked(
      t,
      headerFor({ title: '', headerBackVisible: true, headerRight: () => <Text testID="page-buttons">✎ ⋯</Text> }),
    );
    const back = await screen.findByTestId('app-header-back');
    expect(back.props.accessibilityLabel).toBe('Back');
    expect(screen.getByTestId('page-buttons')).toBeTruthy();
    expect(audit()).toEqual([]);
    await fireEvent.press(back);
    expect(routes()).toEqual([]);
  });

  it('none on a page that does not', async () => {
    const t = testVault([ORIGIN]);
    await unlocked(t, <AppHeader title="Sharing" />);
    await screen.findByTestId('app-header-title');
    expect(screen.queryByTestId('app-header-back')).toBeNull();
  });
});

describe('the pages’ ✕', () => {
  it('closes them, back where they were opened from', async () => {
    const t = testVault([ORIGIN]);
    libraryDoc(t, { id: 'passport', title: 'Passport' });
    push('/documents');
    push({ pathname: '/essential/[id]', params: { id: 'passport', online: '1' } });
    await unlocked(t, <EssentialPages id="passport" online />);
    const close = await screen.findByTestId('essential-close');
    expect(close.props.accessibilityLabel).toBe('Close the pages');
    await fireEvent.press(close);
    expect(routes().at(-1)).toEqual({ pathname: '/documents', params: {} });
  });
});
