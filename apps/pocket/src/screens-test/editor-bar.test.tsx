import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import DocumentsScreen from '../app/(tabs)/documents';
import NotesScreen from '../app/(tabs)/notes';
import EditScreen from '../app/edit/[id]';
import NewNoteScreen from '../app/new-note';
import { audit } from '../test-support/a11y';
import { libraryDoc, unlocked } from '../test-support/lookup';
import { installed } from '../test-support/render';
import { push, resetRoutes, routes } from '../test-support/router';
import { caps0519, capabilities, testVault, type TestVault } from '../test-support/vault';

jest.mock(
  'expo-router',
  () => jest.requireActual<typeof import('../test-support/router')>('../test-support/router').routerMock,
);

/**
 * The owner's two fixes of 12 Nov 2026: Cancel beside Save in one row at
 * the foot of New note, Edit note and Edit details, above Android's own
 * buttons, asking first when something typed would be lost; and a clear
 * (×) button in every search box while it holds words.
 */

const ORIGIN = 'https://vault.test';

beforeEach(() => {
  installed();
  resetRoutes();
});

function vault(): TestVault {
  const t = testVault([ORIGIN]);
  t.caps = capabilities({
    server_version: '0.9.0',
    features: { ...caps0519().features, document_table: true, document_filters: true, notes: true, notes_apart: true },
  });
  return t;
}

function aNote(t: TestVault) {
  libraryDoc(t, {
    id: 'n1',
    title: 'Boiler',
    type_key: 'note',
    notes: 'Serviced in March.',
    notes_updated_at: '2026-11-11T07:34:00Z',
    tags: [],
  });
  t.library.versions.set('n1', []);
}

const top = () => routes().at(-1)?.pathname;

describe('Cancel and Save, one row at the foot', () => {
  it('New note: both in the row; nothing typed, Cancel leaves at once', async () => {
    const t = vault();
    push('/notes');
    push('/new-note');
    await unlocked(t, <NewNoteScreen />);
    const bar = await screen.findByTestId('new-note-bar');
    expect(within(bar).getByTestId('new-note-cancel')).toBeTruthy();
    expect(within(bar).getByTestId('new-note-save')).toBeTruthy();
    // The row is apart from what scrolls: it never goes down with the words.
    expect(within(screen.getByTestId('new-note')).queryByTestId('new-note-cancel')).toBeNull();
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByTestId('new-note-cancel'));
    expect(top()).toBe('/notes');
  });

  it('New note: something typed, Cancel asks; Keep editing stays, Leave without saving goes', async () => {
    const t = vault();
    push('/notes');
    push('/new-note');
    await unlocked(t, <NewNoteScreen />);
    await fireEvent.changeText(await screen.findByTestId('new-note-words'), 'Bins on Tuesday');
    await fireEvent.press(screen.getByTestId('new-note-cancel'));
    expect(await screen.findByText('Leave without saving?')).toBeTruthy();
    expect(screen.getByTestId('new-note-cancel-no')).toHaveTextContent('Keep editing');
    await fireEvent.press(screen.getByTestId('new-note-cancel-no'));
    expect(top()).toBe('/new-note');
    expect(screen.getByTestId('new-note-words').props.value).toBe('Bins on Tuesday');
    await fireEvent.press(screen.getByTestId('new-note-cancel'));
    await fireEvent.press(await screen.findByTestId('new-note-cancel-yes'));
    expect(top()).toBe('/notes');
    expect(t.vault.state.documents.some((d) => d.notes === 'Bins on Tuesday')).toBe(false);
  });

  it('Edit note: changed words, Cancel asks; saved, it leaves without asking', async () => {
    const t = vault();
    aNote(t);
    push('/document/n1');
    push({ pathname: '/edit/[id]', params: { id: 'n1' } });
    await unlocked(t, <EditScreen />);
    const words = await screen.findByTestId('edit-note-words');
    expect(within(screen.getByTestId('edit-bar')).getByTestId('edit-save')).toBeTruthy();
    await fireEvent.changeText(words, 'Serviced in March and October.');
    await fireEvent.press(screen.getByTestId('edit-cancel'));
    expect(await screen.findByTestId('edit-cancel-yes')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('edit-cancel-no'));
    await fireEvent.press(screen.getByTestId('edit-save'));
    await waitFor(() => expect(top()).toBe('/document/n1'));
    expect(t.library.documents.get('n1')?.notes).toBe('Serviced in March and October.');
    expect(screen.queryByText('Leave without saving?')).toBeNull();
  });

  it('Edit details: nothing changed, Cancel leaves at once', async () => {
    const t = vault();
    libraryDoc(t, {
      id: 'passport',
      title: 'Passport',
      type_key: 'passport',
      issued_by: 'United Kingdom',
      identifier: '123456789',
      issued: { date: '2021-03-14', precision: 'day' },
      expires: { date: '2031-03-14', precision: 'day' },
      notes: 'In the blue folder',
      notes_updated_at: '2026-11-01T10:00:00Z',
      tags: ['travel'],
    });
    push('/document/passport');
    push({ pathname: '/edit/[id]', params: { id: 'passport' } });
    await unlocked(t, <EditScreen />);
    await screen.findByTestId('edit-name');
    await fireEvent.press(screen.getByTestId('edit-cancel'));
    expect(top()).toBe('/document/passport');
    expect(screen.queryByText('Leave without saving?')).toBeNull();
  });
});

describe('A clear (×) button in the search box', () => {
  it('Documents: shown with words, named, and it empties the box', async () => {
    const t = vault();
    await unlocked(t, <DocumentsScreen />);
    await fireEvent.press(await screen.findByTestId('documents-search'));
    const field = await screen.findByTestId('search-field');
    expect(screen.queryByTestId('search-field-clear')).toBeNull();
    await fireEvent.changeText(field, 'passport');
    const clear = screen.getByTestId('search-field-clear');
    expect(clear.props.accessibilityLabel).toBe('Clear search');
    expect(audit()).toEqual([]);
    await fireEvent.press(clear);
    expect(screen.getByTestId('search-field').props.value).toBe('');
    expect(screen.queryByTestId('search-field-clear')).toBeNull();
  });

  it('Notes: the same', async () => {
    const t = vault();
    await unlocked(t, <NotesScreen />);
    await fireEvent.changeText(await screen.findByTestId('notes-find'), 'wifi');
    await fireEvent.press(screen.getByTestId('notes-find-clear'));
    expect(screen.getByTestId('notes-find').props.value).toBe('');
    expect(screen.queryByTestId('notes-find-clear')).toBeNull();
  });
});
