import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import DocumentsScreen from '../app/(tabs)/documents';
import Home from '../test-support/home';
import { unlocked } from '../test-support/lookup';
import { installed } from '../test-support/render';
import { resetRoutes, routes } from '../test-support/router';
import { capabilities, testVault, type TestVault } from '../test-support/vault';

jest.mock(
  'expo-router',
  () => jest.requireActual<typeof import('../test-support/router')>('../test-support/router').routerMock,
);

const ORIGIN = 'https://vault.test';

beforeEach(() => {
  installed();
  resetRoutes();
});

/** What each GET /documents of this screen asked, as its query (the capture card asks too, unsorted). */
const asked = (t: TestVault) =>
  t.calls
    .filter((c) => c.startsWith(`GET ${ORIGIN}/api/v1/documents?`))
    .map((c) => Object.fromEntries(new URL(c.slice(4)).searchParams))
    .filter((q) => q.sort !== undefined);

/** A vault with the Documents table (0.6.0): its column sorts. */
function tableVault(): TestVault {
  const t = testVault([ORIGIN]);
  t.caps = capabilities({ server_version: '0.9.0', features: { ...capabilities().features, document_table: true } });
  return t;
}

function papers(t: TestVault, n: number) {
  for (let i = 1; i <= n; i += 1) {
    t.vault.state.documents.push({ id: `doc-${String(i).padStart(3, '0')}`, title: `Paper ${i}`, type_key: 'other' });
  }
}

describe('all your documents (P7)', () => {
  it('lists every document, recently added first; 50 at a time, the next 50 as it scrolls', async () => {
    const t = tableVault();
    papers(t, 60);
    await unlocked(t, <DocumentsScreen />);
    await waitFor(() => expect(asked(t)[0]).toEqual({ sort: 'recent', limit: '50' }));
    // Paged by the table's own sort (the client's fake pages only those): in
    // title order, the first 50, then at the end of the list the next page by its cursor.
    await fireEvent.press(await screen.findByTestId('documents-sort-title'));
    const held = () => (screen.getByTestId('documents').props.data as unknown[]).length;
    await waitFor(() => expect(held()).toBe(50));
    await fireEvent(screen.getByTestId('documents'), 'onEndReached');
    await waitFor(() => expect(held()).toBe(60));
    const titled = asked(t).filter((q) => q.sort === 'title');
    expect(titled[0]).toEqual({ sort: 'title', direction: 'asc', limit: '50' });
    expect(titled[1]).toEqual({ sort: 'title', direction: 'asc', limit: '50', cursor: expect.any(String) });
    // No more after the last page, however often the end is reached.
    await fireEvent(screen.getByTestId('documents'), 'onEndReached');
    expect(asked(t).filter((q) => q.sort === 'title')).toHaveLength(2);
  });

  it('sorts by title or expiry with the table’s columns, where the vault has them', async () => {
    const t = tableVault();
    papers(t, 3);
    await unlocked(t, <DocumentsScreen />);
    await waitFor(() => expect(screen.getAllByTestId(/^doc-row-/)).toHaveLength(3));
    await fireEvent.press(screen.getByTestId('documents-sort-title'));
    await waitFor(() => expect(asked(t).at(-1)).toEqual({ sort: 'title', direction: 'asc', limit: '50' }));
    await fireEvent.press(screen.getByTestId('documents-sort-expires'));
    await waitFor(() => expect(asked(t).at(-1)).toEqual({ sort: 'expires', direction: 'asc', limit: '50' }));
  });

  it('an older vault is asked with its older sorts', async () => {
    const t = testVault([ORIGIN]);
    papers(t, 2);
    await unlocked(t, <DocumentsScreen />);
    await waitFor(() => expect(screen.getAllByTestId(/^doc-row-/)).toHaveLength(2));
    await fireEvent.press(screen.getByTestId('documents-sort-title'));
    await waitFor(() => expect(asked(t).at(-1)).toEqual({ sort: 'alpha', limit: '50' }));
    await fireEvent.press(screen.getByTestId('documents-sort-expires'));
    await waitFor(() => expect(asked(t).at(-1)).toEqual({ sort: 'expiring', limit: '50' }));
  });

  it('narrows by status and who can see it, and says when nothing matches', async () => {
    const t = tableVault();
    papers(t, 2);
    await unlocked(t, <DocumentsScreen />);
    await waitFor(() => expect(screen.getAllByTestId(/^doc-row-/)).toHaveLength(2));
    await fireEvent.press(screen.getByTestId('documents-status-expired'));
    await waitFor(() => expect(asked(t).at(-1)).toEqual(expect.objectContaining({ status: 'expired' })));
    await fireEvent.press(screen.getByTestId('documents-visibility-private'));
    await waitFor(() =>
      expect(asked(t).at(-1)).toEqual(expect.objectContaining({ status: 'expired', visibility: 'private' })),
    );
    expect(await screen.findByTestId('documents-none')).toHaveTextContent(
      'Nothing matches these choices. Try fewer of them.',
    );
    // A chip pressed again lets go of it.
    await fireEvent.press(screen.getByTestId('documents-status-expired'));
    await waitFor(() => expect(asked(t).at(-1)?.status).toBeUndefined());
  });

  it('is reached from Home (and is the Documents tab since R3)', async () => {
    const t = testVault([ORIGIN]);
    await unlocked(t, <Home />);
    await fireEvent.press(await screen.findByTestId('home-all-documents'));
    expect(routes().at(-1)).toEqual({ pathname: '/documents', params: {} });
  });
});
