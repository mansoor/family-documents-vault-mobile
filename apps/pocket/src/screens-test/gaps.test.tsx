import type { DocumentView } from '@fdv/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import CollectionsScreen from '../app/collections';
import CollectionScreen from '../app/collection/[id]';
import MoreScreen from '../app/(tabs)/more';
import TrashScreen from '../app/trash';
import { DocumentDetail } from '../documents/detail';
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

/** A vault of 0.9.0: notes, collections, no longer needed; each PATCH to a document as the phone sent it. */
function vault(): { t: TestVault; edits: Record<string, unknown>[] } {
  const t = testVault([ORIGIN]);
  t.caps = capabilities({
    features: { ...caps0519().features, notes: true, collections: true, custom_types: true, no_longer_needed: true },
  });
  const edits: Record<string, unknown>[] = [];
  const inner = t.fetch;
  t.fetch = async (url, init) => {
    if (init.method === 'PATCH' && /\/api\/v1\/documents\/[^/]+$/.test(url) && typeof init.body === 'string') {
      edits.push(JSON.parse(init.body) as Record<string, unknown>);
    }
    return inner(url, init);
  };
  return { t, edits };
}

function passport(t: TestVault, over: Partial<DocumentView> = {}): DocumentView {
  return libraryDoc(t, {
    id: 'passport',
    title: 'Passport',
    type_key: 'passport',
    issued_by: 'United Kingdom',
    identifier: '123456789',
    issued: { date: '2021-03-14', precision: 'day' },
    expires: { date: '2031-03-14', precision: 'day' },
    physical_location: 'Desk drawer',
    notes: 'In the blue folder',
    notes_updated_at: '2026-11-01T10:00:00Z',
    tags: ['travel'],
    ...over,
  });
}

function aNote(t: TestVault, over: Partial<DocumentView> = {}): DocumentView {
  return libraryDoc(t, {
    id: 'n1',
    title: 'Spare key',
    type_key: 'note',
    category: 'note',
    notes: 'Under the blue pot.',
    notes_updated_at: '2026-11-01T10:00:00Z',
    ...over,
  } as Partial<DocumentView> & { id: string });
}

async function openEdit(id: string) {
  await fireEvent.press(await screen.findByTestId('document-edit'));
  await waitFor(() => expect(routes().at(-1)).toEqual({ pathname: '/edit/[id]', params: { id } }));
}

describe('a note, edited (the gaps review, 11 Nov 2026)', () => {
  it('its title and its words, from the pencil on its page', async () => {
    const { t, edits } = vault();
    aNote(t);
    await unlocked(t, <DocumentDetail id="n1" />);
    await openEdit('n1');
    const words = await screen.findByTestId('edit-note-words');
    expect(words.props.value).toBe('Under the blue pot.');
    expect(audit()).toEqual([]);
    await fireEvent.changeText(screen.getByTestId('edit-note-title'), 'Spare keys');
    await fireEvent.changeText(words, 'Under the blue pot, and one with Sam.');
    await fireEvent.press(screen.getByTestId('edit-save'));
    await waitFor(() => expect(routes()).toEqual([]));
    expect(edits).toEqual([{ notes: 'Under the blue pot, and one with Sam.', title: 'Spare keys' }]);
  });

  it('the words alone, when the title is unchanged', async () => {
    const { t, edits } = vault();
    aNote(t);
    await unlocked(t, <DocumentDetail id="n1" />);
    await openEdit('n1');
    await fireEvent.changeText(await screen.findByTestId('edit-note-words'), 'Moved to the shed.');
    await fireEvent.press(screen.getByTestId('edit-save'));
    await waitFor(() => expect(edits).toEqual([{ notes: 'Moved to the shed.' }]));
  });

  it("somebody else's note: its words, never its title", async () => {
    const { t, edits } = vault();
    aNote(t, { owner_member_id: 'someone-else' });
    await unlocked(t, <DocumentDetail id="n1" />);
    await openEdit('n1');
    expect(await screen.findByTestId('edit-note-title-fixed')).toHaveTextContent('Spare key');
    expect(screen.queryByTestId('edit-note-title')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('edit-note-words'), 'New words');
    await fireEvent.press(screen.getByTestId('edit-save'));
    await waitFor(() => expect(edits).toEqual([{ notes: 'New words' }]));
  });
});

describe("a document's note and tags, in Edit details (the gaps review)", () => {
  it('written and changed, each sent only when changed', async () => {
    const { t, edits } = vault();
    passport(t);
    await unlocked(t, <DocumentDetail id="passport" />);
    await openEdit('passport');
    const notes = await screen.findByTestId('edit-notes');
    expect(notes.props.value).toBe('In the blue folder');
    // A tag taken off with its ✕, and one added.
    await fireEvent.press(screen.getByTestId('edit-tag-travel'));
    await fireEvent.changeText(screen.getByTestId('edit-tag-new'), 'renew');
    await fireEvent.press(screen.getByTestId('edit-tag-add'));
    expect(screen.getByTestId('edit-tag-renew')).toBeTruthy();
    expect(audit()).toEqual([]);
    await fireEvent.changeText(notes, 'In the safe now');
    await fireEvent.press(screen.getByTestId('edit-save'));
    await waitFor(() => expect(routes()).toEqual([]));
    expect(edits[0]).toEqual(expect.objectContaining({ notes: 'In the safe now', tags: ['renew'] }));
  });

  it('untouched, neither is sent; a tag too long is said, and not added', async () => {
    const { t, edits } = vault();
    passport(t);
    await unlocked(t, <DocumentDetail id="passport" />);
    await openEdit('passport');
    await fireEvent.changeText(await screen.findByTestId('edit-tag-new'), 'x'.repeat(41));
    await fireEvent.press(screen.getByTestId('edit-tag-add'));
    expect(await screen.findByText(/A tag can be 40 characters at most/)).toBeTruthy();
    expect(screen.queryByTestId(`edit-tag-${'x'.repeat(41)}`)).toBeNull();
    await fireEvent.changeText(screen.getByTestId('edit-tag-new'), '');
    await fireEvent.press(screen.getByTestId('edit-save'));
    await waitFor(() => expect(edits).toHaveLength(1));
    expect(edits[0]).not.toHaveProperty('notes');
    expect(edits[0]).not.toHaveProperty('tags');
  });
});

describe('no longer needed, and needed again (the gaps review)', () => {
  it("from the page's ⋯: why, if the person says; then needed again", async () => {
    const { t } = vault();
    passport(t);
    await unlocked(t, <DocumentDetail id="passport" />);
    await fireEvent.press(await screen.findByTestId('document-more'));
    await fireEvent.press(await screen.findByTestId('document-unneeded-mark'));
    await fireEvent.changeText(await screen.findByTestId('unneeded-reason'), 'Replaced by the new one');
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByTestId('unneeded-yes'));
    expect(await screen.findByTestId('document-notice')).toHaveTextContent(/no longer needed/);
    expect(t.library.documents.get('passport')?.no_longer_needed?.reason).toBe('Replaced by the new one');
    expect(await screen.findByTestId('document-unneeded')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('document-more'));
    await fireEvent.press(await screen.findByTestId('document-needed-again'));
    await waitFor(() => expect(t.library.documents.get('passport')?.no_longer_needed).toBeNull());
    expect(await screen.findByTestId('document-notice')).toHaveTextContent(/^Needed again/);
  });

  it('a vault without it offers neither', async () => {
    const t = testVault([ORIGIN]);
    t.caps = capabilities({ features: { ...caps0519().features, no_longer_needed: false } });
    passport(t);
    await unlocked(t, <DocumentDetail id="passport" />);
    await fireEvent.press(await screen.findByTestId('document-more'));
    await screen.findByTestId('document-trash');
    expect(screen.queryByTestId('document-unneeded-mark')).toBeNull();
  });
});

describe('the Trash (the gaps review)', () => {
  it('from More: what was moved there, and Restore puts it back', async () => {
    const { t } = vault();
    t.vault.state.documents.push({
      id: 'old',
      title: 'Old lease',
      type_key: 'passport',
      owner_member_id: 'fake-member',
      tags: [],
      extra: {},
      deleted_at: '2026-11-09T10:00:00Z',
    } as never);
    await unlocked(t, <MoreScreen />);
    await fireEvent.press(await screen.findByTestId('more-trash'));
    expect(routes()).toEqual([{ pathname: '/trash', params: {} }]);
    resetRoutes();

    await unlocked(t, <TrashScreen />);
    expect(await screen.findByTestId('trash-old')).toHaveTextContent(/^Old lease/);
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByTestId('trash-restore-old'));
    expect(await screen.findByTestId('trash-said')).toHaveTextContent('“Old lease” is back.');
    expect(screen.queryByTestId('trash-old')).toBeNull();
    expect(t.vault.state.documents.find((d) => d.id === 'old')?.deleted_at ?? null).toBeNull();
  });

  it('empty, it says so', async () => {
    const { t } = vault();
    await unlocked(t, <TrashScreen />);
    expect(await screen.findByTestId('trash-empty')).toHaveTextContent('Nothing in the Trash.');
  });
});

describe('collections made, changed and deleted (the gaps review)', () => {
  it('New collection: a name, what it is for, and who it is for; then its page', async () => {
    const { t } = vault();
    await unlocked(t, <CollectionsScreen />);
    await fireEvent.press(await screen.findByTestId('collections-new'));
    expect(await screen.findByTestId('collection-form')).toBeTruthy();
    expect(screen.getByTestId('collection-form-save').props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );
    await fireEvent.changeText(screen.getByTestId('collection-form-name'), 'Lisbon trip');
    await fireEvent.changeText(screen.getByTestId('collection-form-description'), 'Passports and tickets');
    await fireEvent.press(screen.getByTestId('collection-form-adults'));
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByTestId('collection-form-save'));
    await waitFor(() => expect(routes().at(-1)?.pathname).toBe('/collection/[id]'));
    const made = t.vault.state.collections.find((c) => c.name === 'Lisbon trip');
    expect(made).toEqual(expect.objectContaining({ description: 'Passports and tickets', audience: 'adults' }));
  });

  it('its maker renames it from the pencil, and deletes it from the bin, asked first', async () => {
    const { t } = vault();
    t.vault.state.collections.push({
      id: 'hol',
      name: 'Holiday',
      description: null,
      audience: 'everyone',
      owner_member_id: 'fake-member',
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-01T00:00:00Z',
      revision: 1,
      deleted: false,
      items: [],
    } as never);
    push({ pathname: '/collection/[id]', params: { id: 'hol' } });
    await unlocked(t, <CollectionScreen />);
    await fireEvent.press(await screen.findByTestId('collection-edit'));
    const name = await screen.findByTestId('collection-form-name');
    expect(name.props.value).toBe('Holiday');
    await fireEvent.changeText(name, 'Summer holiday');
    await fireEvent.press(screen.getByTestId('collection-form-save'));
    expect(await screen.findByTestId('collection-said')).toHaveTextContent('Saved.');
    expect(screen.getByText('Summer holiday')).toBeTruthy();

    // Who sees what, behind the ⓘ beside who it is for (the owner's tidy-up of 11 Nov 2026).
    expect(screen.queryByText(/could see already/)).toBeNull();
    await fireEvent.press(screen.getByTestId('collection-about'));
    expect(within(await screen.findByTestId('collection-about-sheet')).getByText(/could see already/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('collection-about-done'));

    // Delete is in its ⋯, beside the pencil.
    await fireEvent.press(screen.getByTestId('collection-more'));
    await fireEvent.press(await screen.findByTestId('collection-delete'));
    expect(await screen.findByText('Delete this collection?')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('collection-delete-cancel'));
    expect(t.vault.state.collections.find((c) => c.id === 'hol')?.deleted).toBe(false);
    await fireEvent.press(screen.getByTestId('collection-more'));
    await fireEvent.press(await screen.findByTestId('collection-delete'));
    await fireEvent.press(await screen.findByTestId('collection-delete-yes'));
    await waitFor(() => expect(t.vault.state.collections.find((c) => c.id === 'hol')?.deleted).toBe(true));
    await waitFor(() => expect(routes()).toEqual([]));
  });

  it("somebody else's collection: neither pencil nor bin", async () => {
    const { t } = vault();
    t.vault.state.collections.push({
      id: 'acc',
      name: 'For the accountant',
      description: null,
      audience: 'everyone',
      owner_member_id: 'someone-else',
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-01T00:00:00Z',
      revision: 1,
      deleted: false,
      items: [],
    } as never);
    push({ pathname: '/collection/[id]', params: { id: 'acc' } });
    await unlocked(t, <CollectionScreen />);
    await screen.findByText('For the accountant');
    expect(screen.queryByTestId('collection-edit')).toBeNull();
    expect(screen.queryByTestId('collection-delete')).toBeNull();
  });
});
