import type { DocumentView } from '@fdv/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { DocumentDetail } from '../documents/detail';
import { EssentialPages } from '../essentials/pages';
import { on } from '../state/events';
import { rowActions } from '../documents/menu';
import { SecureTokenStore } from '../session/store';
import { audit } from '../test-support/a11y';
import { libraryDoc, unlocked } from '../test-support/lookup';
import { installed } from '../test-support/render';
import { resetRoutes, routes } from '../test-support/router';
import { caps0519, testVault, type TestVault } from '../test-support/vault';

jest.mock(
  'expo-router',
  () => jest.requireActual<typeof import('../test-support/router')>('../test-support/router').routerMock,
);

/**
 * A document's pages (app 0.24.0, the owner's ask of 24 Nov 2026): ← before
 * its name in place of the ✕ in the corner, and there a ⋮ that opens the
 * same sheet as the document's ⋯ in a list.
 */

const ORIGIN = 'https://vault.test';
const PASSWORD = 'correct horse battery staple';

beforeEach(() => {
  installed();
  resetRoutes();
});

afterEach(() => jest.restoreAllMocks());

/** A vault with collections, as the list's ⋯ tests have it. */
function vault(): TestVault {
  const t = testVault([ORIGIN]);
  t.caps = caps0519();
  return t;
}

/** The phone keeps this role for whoever signed in (the fake signs everybody in as its owner). */
const withRole = (role: string) => async () => {
  const store = new SecureTokenStore();
  const kept = await store.load();
  await store.save({ ...(kept as NonNullable<typeof kept>), role: role as never });
};

/** Its page, then Pages: the pages from the vault, with their first page drawn. */
async function pagesOf(t: TestVault, id: string, opts: { role?: string } = {}) {
  await unlocked(t, <DocumentDetail id={id} />, opts.role ? { before: withRole(opts.role) } : {});
  await fireEvent.press(await screen.findByTestId('document-pages'));
  await waitFor(() => expect(routes().at(-1)).toEqual({ pathname: '/essential/[id]', params: { id, online: '1' } }));
  await screen.findByTestId('essential-image');
}

/** The sheet's choices, by their test IDs, once the vault's copy has come. */
async function choices(): Promise<string[]> {
  const sheet = await screen.findByTestId('row-sheet');
  await waitFor(() => expect(within(sheet).queryByTestId('row-sheet-loading')).toBeNull());
  return within(sheet)
    .getAllByRole('menuitem')
    .map((i) => String(i.props.testID));
}

describe('a document’s pages: ← and ⋮', () => {
  it('← before its name goes back to its page; no ✕ any more', async () => {
    const t = vault();
    libraryDoc(t, { id: 'passport', title: 'Passport' });
    await pagesOf(t, 'passport');
    expect(screen.queryByTestId('essential-close')).toBeNull();
    const back = screen.getByTestId('essential-back');
    expect(back.props.accessibilityLabel).toBe('Back');
    expect(back.props.accessibilityRole).toBe('button');
    // Before its name, the ⋮ after it.
    const top = screen.getByTestId('essential-viewer');
    const order = within(top)
      .getAllByRole('button')
      .map((b) => String(b.props.testID));
    expect(order.indexOf('essential-back')).toBeLessThan(order.indexOf('essential-more'));
    expect(audit()).toEqual([]);
    await fireEvent.press(back);
    expect(routes()).toEqual([]);
    expect(await screen.findByTestId('document')).toBeTruthy();
  });

  it('⋮ opens the ⋯’s sheet, with the same choices as the list’s for the same document', async () => {
    const t = vault();
    const doc = libraryDoc(t, { id: 'passport', title: 'Passport' });
    await pagesOf(t, 'passport');
    const more = screen.getByTestId('essential-more');
    // The list's ⋯'s own words.
    expect(more.props.accessibilityLabel).toBe('Actions for “Passport”');
    expect(more.props.accessibilityState).toEqual({ expanded: false });
    await fireEvent.press(more);
    const got = await choices();
    // The one list the ⋯ draws from, for whoever is signed in (the fake's owner).
    const expected = rowActions(
      { role: 'owner', member_id: 'fake-member' },
      doc as DocumentView,
      { collections: true, renewing: false },
    ).map((a) => `row-sheet-${a}`);
    expect(got).toEqual(expected);
    expect(got).toEqual([
      'row-sheet-share',
      'row-sheet-save',
      'row-sheet-version',
      'row-sheet-essential',
      'row-sheet-collect',
      'row-sheet-print',
    ]);
    // Nothing that is about a list: no Remove from this collection, no Open.
    expect(screen.queryByTestId('row-sheet-remove')).toBeNull();
    expect(screen.queryByTestId('row-sheet-open')).toBeNull();
    expect(audit()).toEqual([]);
    // Cancel closes it, and the pages stay.
    await fireEvent.press(screen.getByTestId('row-sheet-cancel'));
    await waitFor(() => expect(screen.queryByTestId('row-sheet')).toBeNull());
    expect(screen.getByTestId('essential-image')).toBeTruthy();
  });

  it('an Essential: Show first, and Stop it being Essential asks before anything changes', async () => {
    const t = vault();
    libraryDoc(t, { id: 'passport', title: 'Passport', is_essential: true });
    await pagesOf(t, 'passport');
    const changed: unknown[][] = [];
    const off = on('documentChanged', (...args) => void changed.push(args));
    await fireEvent.press(screen.getByTestId('essential-more'));
    const got = await choices();
    expect(got[0]).toBe('row-sheet-show');
    await waitFor(() => expect(screen.getByTestId('row-sheet-essential').props.accessibilityState.disabled).toBe(false));
    await fireEvent.press(screen.getByTestId('row-sheet-essential'));
    expect(await screen.findByTestId('row-sheet-essential-yes')).toBeTruthy();
    expect(t.library.documents.get('passport')?.is_essential).toBe(true);
    // Cancelled: nothing changed, the choices again.
    await fireEvent.press(screen.getByTestId('row-sheet-essential-cancel'));
    expect(await screen.findByTestId('row-sheet-essential')).toBeTruthy();
    expect(t.library.documents.get('passport')?.is_essential).toBe(true);
    // Confirmed, then "Confirm it's you" as from a list's ⋯: not an Essential any more, said in the sheet.
    await fireEvent.press(screen.getByTestId('row-sheet-essential'));
    await fireEvent.press(await screen.findByTestId('row-sheet-essential-yes'));
    await fireEvent.changeText(await screen.findByTestId('step-up-password'), PASSWORD);
    await fireEvent.press(screen.getByTestId('step-up-go'));
    expect(await screen.findByText("It's not an Essential any more.")).toBeTruthy();
    expect(t.library.documents.get('passport')?.is_essential).toBe(false);
    expect(t.library.stepUps).toEqual([PASSWORD]);
    // Said to its page beneath, the lists and the copies kept on the phone, as it is now.
    expect(changed).toEqual([['passport', false]]);
    off();
  });

  it('no ⋮ over an older version: the ⋯’s choices act on the latest', async () => {
    const t = vault();
    libraryDoc(t, { id: 'passport', title: 'Passport' });
    await unlocked(t, <EssentialPages id="passport" online version="passport-v1" />);
    await screen.findByTestId('essential-image');
    expect(screen.getByTestId('essential-back')).toBeTruthy();
    expect(screen.queryByTestId('essential-more')).toBeNull();
  });

  it('a viewer is offered what a list offers them: Save a copy and Print', async () => {
    const t = vault();
    libraryDoc(t, { id: 'bill', title: 'Water bill' });
    await pagesOf(t, 'bill', { role: 'viewer' });
    await fireEvent.press(screen.getByTestId('essential-more'));
    expect(await choices()).toEqual(['row-sheet-save', 'row-sheet-print']);
  });

  it('Share closes the sheet and opens the share sheet over the pages', async () => {
    const t = vault();
    libraryDoc(t, { id: 'passport', title: 'Passport' });
    await pagesOf(t, 'passport');
    await fireEvent.press(screen.getByTestId('essential-more'));
    await choices();
    await fireEvent.press(screen.getByTestId('row-sheet-share'));
    await waitFor(() => expect(screen.queryByTestId('row-sheet')).toBeNull());
    expect(await screen.findByTestId('share-sheet')).toBeTruthy();
    expect(screen.getByTestId('essential-image')).toBeTruthy();
  });
});
