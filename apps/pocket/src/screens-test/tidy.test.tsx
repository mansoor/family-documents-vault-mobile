import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import Home from '../app/(tabs)/index';
import DocumentsScreen from '../app/(tabs)/documents';
import NotesScreen from '../app/(tabs)/notes';
import CollectionsScreen from '../app/collections';
import { DocumentDetail } from '../documents/detail';
import { listQuery, NO_FILTERS, searchQuery } from '../documents/filter-model';
import { audit } from '../test-support/a11y';
import { libraryDoc, unlocked } from '../test-support/lookup';
import { installed } from '../test-support/render';
import { resetRoutes, routes } from '../test-support/router';
import { caps0519, capabilities, testVault, type TestVault } from '../test-support/vault';

jest.mock(
  'expo-router',
  () => jest.requireActual<typeof import('../test-support/router')>('../test-support/router').routerMock,
);

/**
 * The owner's tidy-up of 11 Nov 2026: a Notes count on Home; Documents
 * without the notes, and tags among its filters; Notes' rows one line,
 * with a ⋯, and a + beside the bell; a note's page in a document's order;
 * Collections' + beside its title.
 */

const ORIGIN = 'https://vault.test';

beforeEach(() => {
  installed();
  resetRoutes();
});

/** A vault of 0.9.0-dev.28: the table, V1's filters, notes, several tags, and notes left out. */
function vault(over: { apart?: boolean } = {}): TestVault {
  const t = testVault([ORIGIN]);
  const apart = over.apart ?? true;
  t.caps = capabilities({
    server_version: '0.9.0',
    features: {
      ...caps0519().features,
      document_table: true,
      document_filters: true,
      notes: true,
      ...(apart ? { tag_filters: true, notes_apart: true } : {}),
    },
  });
  return t;
}

function doc(t: TestVault, id: string, title: string, type_key: string, tags: string[] = [], notes: string | null = null) {
  t.vault.state.documents.push({
    id,
    title,
    type_key,
    owner_member_id: 'fake-member',
    visibility: 'household',
    identifier: null,
    issued_by: null,
    issued: null,
    expires: null,
    physical_location: null,
    tags,
    notes,
    notes_updated_at: notes === null ? null : '2026-11-01T10:00:00Z',
    extra: {},
  } as never);
}

/** The list's queries as Documents asked them, every value of each field. */
const asked = (t: TestVault) =>
  t.calls
    .filter((c) => c.startsWith(`GET ${ORIGIN}/api/v1/documents?`))
    .map((c) => new URL(c.slice(4)).searchParams)
    .filter((q) => q.get('limit') !== '1');

describe('Home: a Notes count beside the three', () => {
  it('four on a row, the notes opening Notes; documents counted without them', async () => {
    const t = vault();
    doc(t, 'p1', 'Passport', 'passport');
    doc(t, 'n1', 'Boiler', 'note', [], 'Serviced in March.');
    doc(t, 'n2', 'Bins', 'note', [], 'Tuesday.');
    await unlocked(t, <Home />);
    const notes = await screen.findByTestId('home-count-notes');
    expect(notes).toHaveTextContent('2notes');
    expect(screen.getByTestId('home-count-documents')).toHaveTextContent('1document');
    expect(audit()).toEqual([]);
    await fireEvent.press(notes);
    expect(routes().at(-1)).toEqual({ pathname: '/notes', params: {} });
  });

  it('an older vault, without notes: the three, as before', async () => {
    const t = vault();
    t.caps = capabilities({ features: { ...caps0519().features, document_table: true } });
    await unlocked(t, <Home />);
    await screen.findByTestId('home-count-documents');
    expect(screen.queryByTestId('home-count-notes')).toBeNull();
  });
});

describe('Documents: without the notes, and tags among the filters', () => {
  it('the vault is asked to leave the notes out, and for several tags, on the list and in search', () => {
    const f = { ...NO_FILTERS, tags: ['Tax, 2025', 'travel'] };
    const apart = { tags: true, notes: true };
    expect(listQuery(f, { sort: 'title', table: true, several: true, apart })).toEqual({
      sort: 'title',
      direction: 'asc',
      tag: ['Tax, 2025', 'travel'],
      notes: 'exclude',
    });
    expect(searchQuery(f, { several: true, categoryOf: () => null, apart })).toEqual({
      tag: ['Tax, 2025', 'travel'],
      notes: 'exclude',
    });
    // An older vault is asked neither.
    expect(listQuery(f, { sort: 'title', table: true, several: true })).toEqual({ sort: 'title', direction: 'asc' });
  });

  it('a note is not listed; a tag chosen in the panel narrows the list, and its chip takes it off', async () => {
    const t = vault();
    doc(t, 'p1', 'Passport', 'passport', ['Travel']);
    doc(t, 'b1', 'Bank', 'bank_statement', ['Money']);
    doc(t, 'n1', 'Gate code', 'note', ['Travel'], '4821');
    await unlocked(t, <DocumentsScreen />);
    await screen.findByTestId('doc-row-p1');
    expect(screen.queryByTestId('doc-row-n1')).toBeNull();
    expect(asked(t).at(-1)?.get('notes')).toBe('exclude');

    await fireEvent.press(screen.getByTestId('documents-filters'));
    const travel = await screen.findByTestId('filter-tag-Travel');
    // No Note among the kinds: notes have their own tab.
    expect(screen.queryByTestId('filter-kind-note')).toBeNull();
    expect(audit()).toEqual([]);
    await fireEvent.press(travel);
    await fireEvent.press(screen.getByTestId('filters-apply'));
    await waitFor(() => expect(screen.queryByTestId('doc-row-b1')).toBeNull());
    expect(screen.getByTestId('doc-row-p1')).toBeTruthy();
    expect(asked(t).at(-1)?.getAll('tag')).toEqual(['Travel']);
    await fireEvent.press(await screen.findByTestId('documents-chip-tags'));
    await screen.findByTestId('doc-row-b1');
  });

  it('an older vault keeps its notes in Documents, and offers no tags', async () => {
    const t = vault({ apart: false });
    doc(t, 'p1', 'Passport', 'passport', ['Travel']);
    doc(t, 'n1', 'Gate code', 'note', [], '4821');
    await unlocked(t, <DocumentsScreen />);
    await screen.findByTestId('doc-row-n1');
    await fireEvent.press(screen.getByTestId('documents-filters'));
    await screen.findByTestId('filter-status-expired');
    expect(screen.queryByTestId('filter-tag-Travel')).toBeNull();
  });
});

describe('Notes: one line each, a ⋯, and a + beside the bell', () => {
  it('the first line only; the ⋯ offers Edit, Share and Add to a collection; Edit opens the editor', async () => {
    const t = vault();
    doc(t, 'n1', 'Boiler', 'note', [], 'Serviced in March.\nNext due in March 2027.');
    await unlocked(t, <NotesScreen />);
    const preview = await screen.findByTestId('note-preview-n1');
    // What the vault lists of its words, cut to one line on the screen: the rest is on its page.
    expect(preview).toHaveTextContent(/^Serviced in March\./);
    expect(preview.props.numberOfLines).toBe(1);
    expect(screen.getByTestId('notes-new').props.accessibilityLabel).toBe('New note');
    expect(audit()).toEqual([]);

    await fireEvent.press(screen.getByTestId('doc-menu-n1'));
    const sheet = await screen.findByTestId('row-sheet');
    await waitFor(() =>
      expect(within(sheet).getAllByRole('menuitem').map((i) => String(i.props.accessibilityLabel))).toEqual([
        'Edit',
        'Share…',
        'Add to a collection',
      ]),
    );
    await fireEvent.press(screen.getByTestId('row-sheet-edit'));
    expect(routes().at(-1)).toEqual({ pathname: '/edit/[id]', params: { id: 'n1' } });
  });

  it('the + writes a new note', async () => {
    const t = vault();
    await unlocked(t, <NotesScreen />);
    await fireEvent.press(await screen.findByTestId('notes-new'));
    expect(routes().at(-1)).toEqual({ pathname: '/new-note', params: {} });
  });
});

describe("a note's page, in a document's order", () => {
  it('its words first; who can see it below them; when they were edited, and by whom, at the foot', async () => {
    const t = vault();
    libraryDoc(t, {
      id: 'n1',
      title: 'Boiler',
      type_key: 'note',
      notes: 'Serviced in March.',
      notes_updated_at: '2026-11-11T07:34:00Z',
      notes_updated_by_name: 'Sarah',
      versions: 0,
      latest_version_id: null,
    } as never);
    t.library.versions.set('n1', []);
    await unlocked(t, <DocumentDetail id="n1" />);
    await screen.findByTestId('document-notes');
    // The page's parts, in the order they are drawn.
    const order: string[] = [];
    const walk = (n: unknown): void => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) return n.forEach(walk);
      const node = n as { props?: { testID?: string }; children?: unknown };
      const id = node.props?.testID;
      if (id && ['document-notes', 'document-visibility', 'document-notes-edited'].includes(id) && !order.includes(id)) {
        order.push(id);
      }
      walk(node.children);
    };
    walk(screen.toJSON());
    expect(order).toEqual(['document-notes', 'document-visibility', 'document-notes-edited']);
    expect(within(screen.getByTestId('document-notes')).queryByTestId('document-notes-edited')).toBeNull();
    expect(screen.getByTestId('document-notes-edited')).toHaveTextContent(/by Sarah$/);
  });
});

describe('Collections: a + beside the title, and no › on a row', () => {
  it('the + makes one', async () => {
    const t = vault();
    t.caps = capabilities({ features: { ...caps0519().features, collections: true, notes: true } });
    await unlocked(t, <CollectionsScreen />);
    const add = await screen.findByTestId('collections-new');
    expect(add.props.accessibilityLabel).toBe('New collection');
    await fireEvent.press(add);
    expect(await screen.findByTestId('collection-form-name')).toBeTruthy();
  });
});
