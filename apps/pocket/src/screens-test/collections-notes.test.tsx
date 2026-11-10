import type { DocumentView, SearchHit } from '@fdv/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import MoreScreen from '../app/(tabs)/more';
import NotesScreen from '../app/notes';
import { SecureTokenStore } from '../session/store';
import { audit } from '../test-support/a11y';
import { libraryDoc, unlocked } from '../test-support/lookup';
import { installed } from '../test-support/render';
import { push, resetRoutes, routes } from '../test-support/router';
import { caps0519, capabilities, testVault, type TestVault } from '../test-support/vault';

jest.mock(
  'expo-router',
  () => jest.requireActual<typeof import('../test-support/router')>('../test-support/router').routerMock,
);

const ORIGIN = 'https://vault.test';

beforeEach(() => {
  installed();
  resetRoutes();
});

/** The phone keeps this role for whoever signed in (the fake signs everybody in as its owner). */
const withRole = (role: string) => async () => {
  const store = new SecureTokenStore();
  const kept = await store.load();
  await store.save({ ...(kept as NonNullable<typeof kept>), role: role as never });
};

/** A vault of 0.9.0: collections, and notes kept on their own. */
function vault(over: { notes?: boolean } = {}): TestVault {
  const t = testVault([ORIGIN]);
  t.caps = capabilities({ features: { ...caps0519().features, notes: over.notes ?? true } });
  return t;
}

/** In the vault's lists too (a collection's, the newest), as the client's fake keeps documents. */
function listed(t: TestVault, doc: DocumentView): DocumentView {
  t.vault.state.documents.push({
    id: doc.id,
    title: doc.title,
    type_key: doc.type_key,
    owner_member_id: doc.owner_member_id,
    visibility: doc.visibility,
    identifier: null,
    issued_by: null,
    issued: null,
    expires: null,
    physical_location: null,
    tags: [],
    notes: null,
    extra: {},
  } as never);
  return doc;
}

/** A collection as the client's fake keeps one, for everyone in the family, made by `owner`, holding `ids`. */
function made(id: string, name: string, owner: string, ids: string[] = []) {
  return {
    id,
    name,
    description: null as string | null,
    audience: 'everyone' as 'everyone' | 'adults',
    owner_member_id: owner,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    revision: 1,
    deleted: false,
    items: ids.map((document_id) => ({ document_id, added_at: '2026-09-02T00:00:00Z' })),
  };
}

/** A note as the client's fake keeps one. */
function note(t: TestVault, id: string, title: string | null, words: string, over: Record<string, unknown> = {}) {
  t.vault.state.documents.push({
    id,
    title,
    type_key: 'note',
    owner_member_id: 'fake-member',
    visibility: 'household',
    identifier: null,
    issued_by: null,
    issued: null,
    expires: null,
    physical_location: null,
    tags: [],
    notes: words,
    notes_updated_at: '2026-11-01T10:00:00Z',
    extra: {},
    ...over,
  } as never);
}

const hit = (doc: DocumentView): SearchHit =>
  ({
    document_id: doc.id,
    title: doc.title,
    type_key: doc.type_key,
    category: 'identity',
    owner_member_id: doc.owner_member_id,
    status: doc.status,
    snippet: '',
    matched_in: 'title',
  }) as SearchHit;

/** A family's documents: a water bill and a passport, in the vault's lists and the library. */
function papers(t: TestVault) {
  const bill = listed(t, libraryDoc(t, { id: 'bill', title: 'Water bill', type_key: 'utility_bill' }));
  const passport = listed(t, libraryDoc(t, { id: 'passport', title: 'Passport' }));
  return { bill, passport };
}

describe('More (P9)', () => {
  it('offers Collections and Notes where the vault has them', async () => {
    const t = vault();
    await unlocked(t, <MoreScreen />);
    expect(await screen.findByTestId('more-collections')).toBeTruthy();
    expect(screen.getByTestId('more-notes')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('more-collections'));
    expect(routes().at(-1)?.pathname).toBe('/collections');
  });

  it('a viewer is offered no collections; a vault before 0.9.0, no notes', async () => {
    const t = vault({ notes: false });
    await unlocked(t, <MoreScreen />, { before: withRole('viewer') });
    expect(await screen.findByTestId('more-people')).toBeTruthy();
    expect(screen.queryByTestId('more-collections')).toBeNull();
    expect(screen.queryByTestId('more-notes')).toBeNull();
  });
});

describe('Collections (P9)', () => {
  it('lists each with its count and who it is for, and opens one', async () => {
    const t = vault();
    papers(t);
    t.vault.state.collections.push(
      made('acc', 'For the accountant', 'fake-member', ['bill']),
      { ...made('hol', 'Holiday', 'x', ['bill', 'passport']), audience: 'adults' },
    );
    push('/collections');
    await unlocked(t, <Text>More</Text>);
    expect(await screen.findByTestId('collection-acc')).toHaveTextContent(
      'For the accountant1 document · Everyone in the family · Made by you',
    );
    expect(screen.getByTestId('collection-hol')).toHaveTextContent('Holiday2 documents · Adults');
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByTestId('collection-hol'));
    expect(routes().at(-1)).toEqual({ pathname: '/collection/[id]', params: { id: 'hol' } });
    expect(await screen.findByTestId('doc-row-passport')).toBeTruthy();
  });

  it('none yet: says where they are made', async () => {
    const t = vault();
    push('/collections');
    await unlocked(t, <Text>More</Text>);
    expect(await screen.findByTestId('collections-none')).toHaveTextContent(/^No collections yet\. Collections are made in the browser/);
  });
});

describe("a collection's page (P9)", () => {
  it("someone else's: its documents, who it is for, and nothing to change", async () => {
    const t = vault();
    papers(t);
    t.vault.state.collections.push({ ...made('hol', 'Holiday', 'x', ['bill', 'passport']), description: 'For the trip' });
    push({ pathname: '/collection/[id]', params: { id: 'hol' } });
    await unlocked(t, <Text>Collections</Text>);
    expect(await screen.findByTestId('doc-row-bill')).toBeTruthy();
    expect(screen.getByTestId('doc-row-passport')).toBeTruthy();
    expect(screen.getByTestId('collection-description')).toHaveTextContent('For the trip');
    expect(screen.getByTestId('collection-line')).toHaveTextContent('2 documents · For Everyone in the family');
    expect(screen.queryByTestId('collection-add')).toBeNull();
    await fireEvent.press(screen.getByTestId('doc-menu-bill'));
    await screen.findByTestId('row-sheet');
    expect(screen.queryByTestId('row-sheet-remove')).toBeNull();
  });

  it("its maker takes one out from the row's ⋯; it stays in the vault", async () => {
    const t = vault();
    papers(t);
    t.vault.state.collections.push(made('acc', 'For the accountant', 'fake-member', ['bill', 'passport']));
    push({ pathname: '/collection/[id]', params: { id: 'acc' } });
    await unlocked(t, <Text>Collections</Text>);
    await fireEvent.press(await screen.findByTestId('doc-menu-bill'));
    await fireEvent.press(await screen.findByTestId('row-sheet-remove'));
    // Asked first (R2), with the collection named.
    expect(await screen.findByText('Remove from “For the accountant”?')).toBeTruthy();
    // Cancel takes nothing out, and the menu is as it was.
    await fireEvent.press(screen.getByTestId('row-sheet-remove-cancel'));
    expect(t.vault.state.collections[0]?.items).toHaveLength(2);
    await fireEvent.press(await screen.findByTestId('row-sheet-remove'));
    await fireEvent.press(await screen.findByTestId('row-sheet-remove-yes'));
    expect(await screen.findByTestId('collection-said')).toHaveTextContent(
      '“Water bill” is out of “For the accountant”. It is still in the vault.',
    );
    expect(t.vault.state.collections[0]?.items.map((i) => i.document_id)).toEqual(['passport']);
    expect(screen.queryByTestId('doc-row-bill')).toBeNull();
    expect(screen.getByTestId('collection-line')).toHaveTextContent(/^1 document/);
    expect(t.library.documents.has('bill')).toBe(true);
  });

  it('its maker adds documents: the newest offered, those in it said to be, and found by words', async () => {
    const t = vault();
    const { bill, passport } = papers(t);
    const deeds = listed(t, libraryDoc(t, { id: 'deeds', title: 'House deeds' }));
    t.vault.state.collections.push(made('acc', 'For the accountant', 'fake-member', ['bill']));
    t.library.search = (q) => ({ items: q === 'deeds' ? [hit(deeds)] : [hit(bill), hit(passport)], sealed: 0 });
    push({ pathname: '/collection/[id]', params: { id: 'acc' } });
    await unlocked(t, <Text>Collections</Text>);
    await fireEvent.press(await screen.findByTestId('collection-add'));

    // Before anything is typed, the newest; the water bill is in it already.
    const inIt = await screen.findByTestId('add-documents-bill');
    expect(inIt.props.accessibilityState).toEqual(expect.objectContaining({ checked: true, disabled: true }));
    expect(screen.getByTestId('add-documents-add')).toHaveTextContent('Tick the documents to add');
    await fireEvent.press(screen.getByTestId('add-documents-passport'));
    expect(audit()).toEqual([]);

    // Words find others; what was ticked stays ticked.
    await fireEvent.changeText(screen.getByTestId('add-documents-find'), 'deeds');
    await fireEvent.press(await screen.findByTestId('add-documents-deeds'));
    expect(screen.getByTestId('add-documents-add')).toHaveTextContent('Add 2 documents');
    await fireEvent.press(screen.getByTestId('add-documents-add'));

    expect(await screen.findByTestId('collection-said')).toHaveTextContent(
      '2 documents are in “For the accountant” now.',
    );
    expect(t.vault.state.collections[0]?.items.map((i) => i.document_id)).toEqual(['bill', 'passport', 'deeds']);
    expect(await screen.findByTestId('doc-row-deeds')).toBeTruthy();
    expect(screen.queryByTestId('add-documents')).toBeNull();
  });

  it('gone, or not one the person can see: said so', async () => {
    const t = vault();
    push({ pathname: '/collection/[id]', params: { id: 'nope' } });
    await unlocked(t, <Text>Collections</Text>);
    expect(await screen.findByText("This collection isn't there any more, or isn't one you can see.")).toBeTruthy();
  });
});

describe('Notes (P9)', () => {
  it('newest first, named by their title or first words; found by words; one opens as a document', async () => {
    const t = vault();
    note(t, 'n1', 'Boiler', 'Serviced in **March**.', { notes_updated_at: '2026-10-01T10:00:00Z' });
    note(t, 'n2', null, 'Bins go out on Tuesday\nRecycling every other week', { visibility: 'private' });
    await unlocked(t, <NotesScreen />);
    const second = await screen.findByTestId('note-n2');
    expect(second).toHaveTextContent(/^Bins go out on Tuesday/);
    expect(second).toHaveTextContent(/Only me$/);
    expect(screen.getByTestId('note-n1')).toHaveTextContent(/^Boiler/);
    expect(audit()).toEqual([]);

    await fireEvent.changeText(screen.getByTestId('notes-find'), 'boiler');
    await waitFor(() => expect(screen.queryByTestId('note-n2')).toBeNull());
    await fireEvent.press(screen.getByTestId('note-n1'));
    expect(routes().at(-1)).toEqual({ pathname: '/document/[id]', params: { id: 'n1' } });
  });

  it('none: said, and what was looked for', async () => {
    const t = vault();
    await unlocked(t, <NotesScreen />);
    expect(await screen.findByTestId('notes-none')).toHaveTextContent('No notes yet.');
    await fireEvent.changeText(screen.getByTestId('notes-find'), 'wifi');
    await waitFor(() => expect(screen.getByTestId('notes-none')).toHaveTextContent('No notes have “wifi” in them.'));
  });

  it('New note: says when it looks like a password, Only me says the title is not sealed, and saved it opens', async () => {
    const t = vault();
    push('/notes');
    await unlocked(t, <Text>More</Text>);
    await fireEvent.press(await screen.findByTestId('notes-new'));
    expect(routes().at(-1)?.pathname).toBe('/new-note');
    expect(screen.getByTestId('new-note-save').props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );
    expect(audit()).toEqual([]);

    await fireEvent.changeText(screen.getByTestId('new-note-title'), 'Wifi');
    await fireEvent.changeText(screen.getByTestId('new-note-words'), 'wifi password: hunter2');
    expect(screen.getByTestId('new-note-secret')).toHaveTextContent(/make the note Only me\.$/);
    await fireEvent.press(screen.getByTestId('new-note-private'));
    expect(screen.getByTestId('new-note-only-me')).toHaveTextContent(/^Only the words of an Only me note are sealed/);
    expect(screen.getByTestId('new-note-secret')).toHaveTextContent(/keep them in one if you can\.$/);
    await fireEvent.press(screen.getByTestId('new-note-save'));

    await waitFor(() => expect(routes().at(-1)?.pathname).toBe('/document/[id]'));
    const made = t.vault.state.documents.find((d) => d.title === 'Wifi');
    expect(made).toEqual(
      expect.objectContaining({ type_key: 'note', visibility: 'private', notes: 'wifi password: hunter2' }),
    );
    expect(routes().at(-1)?.params).toEqual({ id: made?.id });
  });

  it('a teen is not offered Adults only for a new note', async () => {
    const t = vault();
    push('/new-note');
    await unlocked(t, <Text>Notes</Text>, { before: withRole('teen') });
    expect(await screen.findByTestId('new-note-household')).toBeTruthy();
    expect(screen.getByTestId('new-note-private')).toBeTruthy();
    expect(screen.queryByTestId('new-note-adults')).toBeNull();
  });

  it('a viewer writes no notes', async () => {
    const v = vault();
    await unlocked(v, <NotesScreen />, { before: withRole('viewer') });
    await screen.findByTestId('notes-none');
    expect(screen.queryByTestId('notes-new')).toBeNull();
  });
});
