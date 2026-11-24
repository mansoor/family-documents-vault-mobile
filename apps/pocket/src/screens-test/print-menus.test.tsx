import type { DocumentView } from '@fdv/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import * as Print from 'expo-print';
import Home from '../app/(tabs)/index';
import NotesScreen from '../app/(tabs)/notes';
import DocumentsScreen from '../app/(tabs)/documents';
import { DocumentDetail } from '../documents/detail';
import { rowActions } from '../documents/menu';
import { SecureTokenStore } from '../session/store';
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
 * Print from the ⋯ menus (app 0.25.0, the owner's request of 24 Nov 2026):
 * Home's Essentials and Recently added, Documents, Notes, and the ⋮ over a
 * document's pages offer Print, after the rest, by its page's own rule; and
 * it does what its page's Print does — the same choices, the same notice
 * before anything Sensitive, and "Confirm it's you" where its page asks.
 */

const ORIGIN = 'https://vault.test';
const PASSWORD = 'correct horse battery staple';
const SAFE = 'This is marked Sensitive. Keep the printout somewhere safe and shred it when you no longer need it.';
const printed = Print.printAsync as jest.Mock;

beforeEach(() => {
  installed();
  resetRoutes();
  printed.mockClear();
});

/** What was given to print, the last time. */
const html = (): string => (printed.mock.calls.at(-1)?.[0] as { html: string }).html;

/** A vault with collections, notes kept apart, notes that ask, and Sensitive. */
function vault(): TestVault {
  const t = testVault([ORIGIN]);
  t.caps = capabilities({
    server_version: '0.9.0-dev.98',
    features: {
      ...caps0519().features,
      notes: true,
      notes_apart: true,
      sensitive_documents: true,
      auto_lock: true,
    },
  });
  return t;
}

/** In the vault's lists too (Home's), as the client's fake keeps documents. */
function listed(t: TestVault, doc: DocumentView): DocumentView {
  t.vault.state.documents.push({
    id: doc.id,
    title: doc.title,
    type_key: doc.type_key,
    owner_member_id: doc.owner_member_id,
    visibility: doc.visibility,
    is_essential: doc.is_essential,
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

/** A note as the client's fake keeps one: listed in Notes, and read from the fake. */
function fakeNote(t: TestVault, id: string, words: string, over: Record<string, unknown> = {}) {
  t.vault.state.documents.push({
    id,
    title: `Note ${id}`,
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

/** The sheet's choices, by their test IDs, once the vault's copy has come. */
async function choices(): Promise<string[]> {
  const sheet = await screen.findByTestId('row-sheet');
  await waitFor(() => expect(within(sheet).queryByTestId('row-sheet-loading')).toBeNull());
  await waitFor(() => expect(within(sheet).getAllByRole('menuitem').length).toBeGreaterThan(0));
  return within(sheet)
    .getAllByRole('menuitem')
    .map((i) => String(i.props.testID));
}

/** The phone keeps this role for whoever signed in (the fake signs everybody in as its owner). */
const withRole = (role: string) => async () => {
  const store = new SecureTokenStore();
  const kept = await store.load();
  await store.save({ ...(kept as NonNullable<typeof kept>), role: role as never });
};

describe('Print in every ⋯, after the rest', () => {
  it('Home: an Essential’s ⋯ and a Recently added row’s ⋯ end with Print', async () => {
    const t = vault();
    listed(t, libraryDoc(t, { id: 'passport', title: 'Passport', is_essential: true }));
    listed(t, libraryDoc(t, { id: 'bill', title: 'Water bill' }));
    await unlocked(t, <Home />);
    const essentials = await screen.findByTestId('home-essentials');
    await fireEvent.press(within(essentials).getByTestId('doc-menu-passport'));
    expect(await choices()).toEqual([
      'row-sheet-show',
      'row-sheet-share',
      'row-sheet-save',
      'row-sheet-version',
      'row-sheet-essential',
      'row-sheet-collect',
      'row-sheet-print',
    ]);
    expect(screen.getByTestId('row-sheet-print')).toHaveTextContent('Print');
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByTestId('row-sheet-cancel'));
    await waitFor(() => expect(screen.queryByTestId('row-sheet')).toBeNull());
    // Recently added: the bill's row, below the Essentials.
    const rows = screen.getAllByTestId('doc-menu-bill');
    await fireEvent.press(rows[rows.length - 1]!);
    expect(await choices()).toEqual([
      'row-sheet-share',
      'row-sheet-save',
      'row-sheet-version',
      'row-sheet-essential',
      'row-sheet-collect',
      'row-sheet-print',
    ]);
  });

  it('Documents: a row’s ⋯ ends with Print; a viewer has Save a copy and Print', async () => {
    const t = vault();
    listed(t, libraryDoc(t, { id: 'bill', title: 'Water bill' }));
    await unlocked(t, <DocumentsScreen />, { before: withRole('viewer') });
    await fireEvent.press(await screen.findByTestId('doc-menu-bill'));
    expect(await choices()).toEqual(['row-sheet-save', 'row-sheet-print']);
  });

  it('Notes: a note’s ⋯ has Edit first and Print last; a note with no words has none', async () => {
    const t = vault();
    fakeNote(t, 'n1', 'Serviced in March.');
    fakeNote(t, 'n2', '', { title: 'Empty', notes: null });
    await unlocked(t, <NotesScreen />);
    await fireEvent.press(await screen.findByTestId('doc-menu-n1'));
    expect(await choices()).toEqual(['row-sheet-edit', 'row-sheet-share', 'row-sheet-collect', 'row-sheet-print']);
    await fireEvent.press(screen.getByTestId('row-sheet-cancel'));
    await waitFor(() => expect(screen.queryByTestId('row-sheet')).toBeNull());
    await fireEvent.press(await screen.findByTestId('doc-menu-n2'));
    expect(await choices()).toEqual(['row-sheet-edit', 'row-sheet-share', 'row-sheet-collect']);
  });

  it('a document’s pages: the ⋮ ends with Print too', async () => {
    const t = vault();
    libraryDoc(t, { id: 'passport', title: 'Passport' });
    await unlocked(t, <DocumentDetail id="passport" />);
    await fireEvent.press(await screen.findByTestId('document-pages'));
    await waitFor(() =>
      expect(routes().at(-1)).toEqual({ pathname: '/essential/[id]', params: { id: 'passport', online: '1' } }),
    );
    await screen.findByTestId('essential-image');
    await fireEvent.press(screen.getByTestId('essential-more'));
    expect((await choices()).at(-1)).toBe('row-sheet-print');
  });

  it('by its page’s rule: never for a caregiver’s paper; a note once its words are here or asked for', () => {
    const owner = { role: 'owner' as const, member_id: 'me' };
    const doc = {
      owner_member_id: 'me',
      is_essential: false,
      latest_version_id: 'v1',
      file_removed: false,
      type_key: 'passport',
    };
    const opts = { collections: false, renewing: false };
    expect(rowActions(owner, doc, opts).at(-1)).toBe('print');
    expect(rowActions(owner, { ...doc, caregiver: true }, opts)).toEqual(['save']);
    const note = { ...doc, type_key: 'note', latest_version_id: null };
    expect(rowActions(owner, { ...note, notes: 'Words' }, opts)).toContain('print');
    expect(rowActions(owner, { ...note, notes: null }, opts)).not.toContain('print');
    expect(rowActions(owner, { ...note, notes: null, confirm_to_read: 'open_private_document' }, opts)).toContain(
      'print',
    );
    expect(rowActions({ role: 'viewer', member_id: 'v' }, doc, opts)).toEqual(['save', 'print']);
  });
});

describe('Print from a ⋯ does what its page’s Print does', () => {
  it('a document asks what to print, as its page does, and prints its pages and details', async () => {
    const t = vault();
    listed(
      t,
      libraryDoc(t, {
        id: 'bill',
        title: 'Water bill',
        expires: { date: '2031-03-14', precision: 'day' },
        sensitive_effective: false,
      } as Partial<DocumentView> & { id: string }),
    );
    await unlocked(t, <Home />);
    await fireEvent.press(await screen.findByTestId('doc-menu-bill'));
    await choices();
    await fireEvent.press(screen.getByTestId('row-sheet-print'));
    expect(await screen.findByTestId('print-question')).toBeTruthy();
    expect(screen.queryByTestId('print-sensitive')).toBeNull();
    expect(screen.getByTestId('print-pages').props.value).toBe(true);
    expect(screen.getByTestId('print-details').props.value).toBe(true);
    await fireEvent.press(screen.getByTestId('print-go'));
    await waitFor(() => expect(printed).toHaveBeenCalledTimes(1));
    const page = html();
    expect(page).toContain('<h1>Water bill</h1>');
    expect(page.match(/<img src="data:image\/jpeg;base64,/g)).toHaveLength(2);
    expect(page).toContain('<dt>Expires</dt><dd>14 Mar 2031</dd>');
    // Printed: the sheet is done with.
    await waitFor(() => expect(screen.queryByTestId('row-sheet')).toBeNull());
  });

  it('a Sensitive document says first to keep the printout safe; Cancel prints nothing and goes back to the choices', async () => {
    const t = vault();
    listed(
      t,
      libraryDoc(t, { id: 'will', title: 'Will', sensitive: true, sensitive_effective: true } as Partial<DocumentView> & {
        id: string;
      }),
    );
    await unlocked(t, <Home />);
    await fireEvent.press(await screen.findByTestId('doc-menu-will'));
    await choices();
    await fireEvent.press(screen.getByTestId('row-sheet-print'));
    const question = await screen.findByTestId('print-question');
    // The notice first, above what to print.
    expect(within(question).getByTestId('print-sensitive')).toHaveTextContent(SAFE);
    await fireEvent.press(screen.getByTestId('print-cancel'));
    expect(await screen.findByTestId('row-sheet-print')).toBeTruthy();
    expect(screen.queryByTestId('print-question')).toBeNull();
    expect(printed).not.toHaveBeenCalled();
    // Printed after all: its heading says Sensitive.
    await fireEvent.press(screen.getByTestId('row-sheet-print'));
    await fireEvent(await screen.findByTestId('print-pages'), 'valueChange', false);
    await fireEvent.press(screen.getByTestId('print-go'));
    await waitFor(() => expect(printed).toHaveBeenCalledTimes(1));
    expect(html()).toMatch(/<p class="sub">[^<]*· Sensitive<\/p>/);
  });

  it('a Sensitive note from Notes: the notice first; Cancel prints nothing; Print prints, its heading saying Sensitive', async () => {
    const t = vault();
    fakeNote(t, 'meds', 'In the blue tin.', { sensitive: true, visibility: 'adults' });
    await unlocked(t, <NotesScreen />);
    await fireEvent.press(await screen.findByTestId('doc-menu-meds'));
    await choices();
    await fireEvent.press(screen.getByTestId('row-sheet-print'));
    expect(await screen.findByTestId('print-sensitive')).toHaveTextContent(SAFE);
    expect(screen.getByTestId('print-sensitive-question')).toHaveTextContent(/^Before you print/);
    await fireEvent.press(screen.getByTestId('print-sensitive-cancel'));
    expect(await screen.findByTestId('row-sheet-print')).toBeTruthy();
    expect(printed).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('row-sheet-print'));
    await fireEvent.press(await screen.findByTestId('print-sensitive-go'));
    await waitFor(() => expect(printed).toHaveBeenCalledTimes(1));
    expect(html()).toContain('<p class="sub">Adults only · Sensitive</p>');
    expect(html()).toContain('In the blue tin.');
    expect(screen.queryByTestId('step-up-sheet')).toBeNull();
  });

  it('a note that isn’t Sensitive prints at once, saying nothing of it', async () => {
    const t = vault();
    fakeNote(t, 'keys', 'Under the mat.');
    await unlocked(t, <NotesScreen />);
    await fireEvent.press(await screen.findByTestId('doc-menu-keys'));
    await choices();
    await fireEvent.press(screen.getByTestId('row-sheet-print'));
    await waitFor(() => expect(printed).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('print-sensitive')).toBeNull();
    expect(html()).toContain('<h1>Note keys</h1>');
    expect(html()).toContain('Under the mat.');
  });
});

describe("“Confirm it's you” where its page asks", () => {
  it('an Essential’s pages ask before they are read, as from its page; not confirmed, nothing is printed', async () => {
    const t = vault();
    listed(t, libraryDoc(t, { id: 'will', title: 'Will', is_essential: true }, { sensitive: true }));
    await unlocked(t, <Home />);
    const essentials = await screen.findByTestId('home-essentials');
    await fireEvent.press(within(essentials).getByTestId('doc-menu-will'));
    await choices();
    await fireEvent.press(screen.getByTestId('row-sheet-print'));
    await fireEvent.press(await screen.findByTestId('print-go'));
    await fireEvent.press(await screen.findByTestId('step-up-cancel'));
    expect(await screen.findByTestId('row-sheet-said')).toHaveTextContent(
      "Nothing was printed: it wasn't confirmed to be you.",
    );
    expect(printed).not.toHaveBeenCalled();

    // Asked again, and confirmed: its pages are printed.
    await fireEvent.press(screen.getByTestId('row-sheet-print'));
    await fireEvent.press(await screen.findByTestId('print-go'));
    await fireEvent.changeText(await screen.findByTestId('step-up-password'), PASSWORD);
    await fireEvent.press(screen.getByTestId('step-up-go'));
    await waitFor(() => expect(printed).toHaveBeenCalledTimes(1));
    expect(html().match(/<img src="data:image\/jpeg;base64,/g)).toHaveLength(2);
    expect(t.library.stepUps).toEqual([PASSWORD]);
  });

  it('its details alone ask nothing, as from its page', async () => {
    const t = vault();
    listed(t, libraryDoc(t, { id: 'will', title: 'Will', is_essential: true }, { sensitive: true }));
    await unlocked(t, <Home />);
    const essentials = await screen.findByTestId('home-essentials');
    await fireEvent.press(within(essentials).getByTestId('doc-menu-will'));
    await choices();
    await fireEvent.press(screen.getByTestId('row-sheet-print'));
    await fireEvent(await screen.findByTestId('print-pages'), 'valueChange', false);
    await fireEvent.press(screen.getByTestId('print-go'));
    await waitFor(() => expect(printed).toHaveBeenCalledTimes(1));
    expect(html()).not.toContain('<img');
    expect(t.library.stepUps).toEqual([]);
  });

  it('an Only me note in Notes asks before its words are read, then prints them asking nothing more', async () => {
    const t = vault();
    fakeNote(t, 'safe', 'The safe is behind the boiler.', { visibility: 'private' });
    await unlocked(t, <NotesScreen />, { before: () => t.vault.forgetConfirmation() });
    await fireEvent.press(await screen.findByTestId('doc-menu-safe'));
    // Nothing is offered until it's confirmed: said, with the button that asks, as its page says it.
    expect(await screen.findByTestId('row-sheet-asks')).toHaveTextContent(
      /^This note asks you to confirm it's you before its words are shown\./,
    );
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByTestId('row-sheet-confirm'));
    await fireEvent.changeText(await screen.findByTestId('step-up-password'), PASSWORD);
    await fireEvent.press(screen.getByTestId('step-up-go'));
    expect((await choices()).at(-1)).toBe('row-sheet-print');
    await fireEvent.press(screen.getByTestId('row-sheet-print'));
    await waitFor(() => expect(printed).toHaveBeenCalledTimes(1));
    expect(html()).toContain('The safe is behind the boiler.');
    expect(html()).toContain('<p class="sub">Only me</p>');
    expect(t.library.stepUps).toEqual([PASSWORD]);
  });
});

describe('Print without a connection', () => {
  it('an Essential, kept or not, says printing needs a connection, as its page offers no Print offline', async () => {
    const t = vault();
    listed(t, libraryDoc(t, { id: 'passport', title: 'Passport', is_essential: true }));
    await unlocked(t, <Home />);
    const essentials = await screen.findByTestId('home-essentials');
    await fireEvent.press(within(essentials).getByTestId('doc-menu-passport'));
    await choices();
    t.reachable.delete(ORIGIN);
    await fireEvent.press(screen.getByTestId('row-sheet-print'));
    expect(await screen.findByTestId('row-sheet-said')).toHaveTextContent('Printing needs a connection to your vault.');
    expect(printed).not.toHaveBeenCalled();
    expect(screen.queryByTestId('print-question')).toBeNull();
  });
});
