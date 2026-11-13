import type { DocumentView } from '@fdv/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { Text } from 'react-native';
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

/** A vault of 0.9.0 with collections, and checklists unless `checklist` is false. */
function vault(over: { checklist?: boolean } = {}): TestVault {
  const t = testVault([ORIGIN]);
  t.caps = capabilities({
    features: {
      ...caps0519().features,
      notes: true,
      collections: true,
      ...(over.checklist === false ? {} : { collection_checklist: true }),
    },
  });
  return t;
}

/** A paper in the vault's lists, as the client's fake keeps documents, and in the library. */
function paper(t: TestVault, over: Partial<DocumentView> & { id: string }): DocumentView {
  const doc = libraryDoc(t, over);
  t.vault.state.documents.push({
    id: doc.id,
    title: doc.title,
    type_key: doc.type_key,
    owner_member_id: doc.owner_member_id,
    visibility: doc.visibility,
    identifier: null,
    issued_by: null,
    issued: doc.issued,
    expires: null,
    physical_location: null,
    tags: [],
    notes: null,
    extra: {},
    created_at: '2026-10-02T00:00:00Z',
  } as never);
  return doc;
}

/** A passport and a bank statement, both the person's own. */
function papers(t: TestVault) {
  paper(t, { id: 'passport', title: 'Passport', type_key: 'passport', issued: { date: '2021-03-14', precision: 'day' } });
  paper(t, {
    id: 'bank1',
    title: 'Bank statement October',
    type_key: 'bank_statement',
    category: 'financial',
    issued: { date: '2026-10-01', precision: 'day' },
  });
}

/** A collection as the client's fake keeps one, for everyone in the family. */
function collection(t: TestVault, id: string, owner: string, ids: string[] = []) {
  t.vault.state.collections.push({
    id,
    name: 'Mortgage',
    description: null,
    audience: 'everyone',
    owner_member_id: owner,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    revision: 1,
    deleted: false,
    items: ids.map((document_id) => ({ document_id, added_at: '2026-09-02T00:00:00Z' })),
  } as never);
  return t.vault.state.collections.at(-1) as unknown as {
    items: { document_id: string }[];
    checklist?: { items: unknown[]; saved_at: string } | null;
  };
}

async function openCollection(t: TestVault, id: string) {
  push({ pathname: '/collection/[id]', params: { id } });
  await unlocked(t, <Text>Collections</Text>);
  await screen.findByTestId('collection-line');
}

/** Fill from a checklist, the list typed and read. */
async function readList(list: string) {
  await fireEvent.press(await screen.findByTestId('collection-checklist-fill'));
  await waitFor(() => expect(routes().at(-1)).toEqual({ pathname: '/checklist/[id]', params: { id: 'mort' } }));
  await fireEvent.changeText(await screen.findByTestId('checklist-text'), list);
  await fireEvent.press(screen.getByTestId('checklist-read'));
  await screen.findByTestId('checklist-review');
}

describe('Fill from a checklist (app 0.8.0)', () => {
  it('an older vault: nothing of it, and nothing asked', async () => {
    const t = vault({ checklist: false });
    papers(t);
    collection(t, 'mort', 'fake-member');
    await openCollection(t, 'mort');
    expect(screen.getByTestId('collection-add')).toBeTruthy();
    expect(screen.queryByTestId('collection-checklist-fill')).toBeNull();
    expect(screen.queryByTestId('collection-checklist')).toBeNull();
    expect(t.calls.some((c) => c.includes('/checklist'))).toBe(false);
  });

  it('its maker reads a list, sees what was found and missing, and adds the found ones, asked first', async () => {
    const t = vault();
    papers(t);
    const c = collection(t, 'mort', 'fake-member');
    await openCollection(t, 'mort');
    await readList('Passport\nLast 2 bank statements\nBirth certificate');
    expect(audit()).toEqual([]);

    // Each line as understood, how it stands, and what was found.
    expect(screen.getByTestId('checklist-item-0-status')).toHaveTextContent('Found 1 of 1');
    expect(screen.getByTestId('checklist-item-1-status')).toHaveTextContent('Found 1 of 2');
    expect(screen.getByTestId('checklist-item-1-missing')).toHaveTextContent(/^Missing: /);
    expect(screen.getByTestId('checklist-item-2-status')).toHaveTextContent('Missing');
    const pass = screen.getByTestId('checklist-item-0-match-passport');
    expect(pass.props.accessibilityState).toEqual(expect.objectContaining({ checked: true }));
    expect(screen.getByTestId('checklist-save')).toHaveTextContent('Add 2 found');

    // Untick one: one to add.
    await fireEvent.press(screen.getByTestId('checklist-item-1-match-bank1'));
    expect(screen.getByTestId('checklist-save')).toHaveTextContent('Add 1 found');
    await fireEvent.press(screen.getByTestId('checklist-item-1-match-bank1'));

    // Asked first; Cancel adds nothing and keeps nothing.
    await fireEvent.press(screen.getByTestId('checklist-save'));
    expect(await screen.findByText('Add 2 documents to “Mortgage”?')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('checklist-add-cancel'));
    expect(c.items).toHaveLength(0);
    expect(c.checklist ?? null).toBeNull();

    await fireEvent.press(screen.getByTestId('checklist-save'));
    await fireEvent.press(await screen.findByTestId('checklist-add-yes'));
    await waitFor(() => expect(routes().at(-1)?.pathname).toBe('/collection/[id]'));
    expect(c.items.map((i) => i.document_id).sort()).toEqual(['bank1', 'passport']);
    expect(c.checklist?.items).toHaveLength(3);

    // Back on the page: what was done, and the checklist kept, in a line.
    expect(await screen.findByTestId('collection-said')).toHaveTextContent(
      '2 documents added to “Mortgage”. The checklist is kept on the collection.',
    );
    expect(await screen.findByTestId('collection-checklist-line')).toHaveTextContent('2 of 4 found');
    expect(screen.queryByTestId('collection-checklist-fill')).toBeNull();
    await fireEvent.press(screen.getByTestId('collection-checklist'));
    const sheet = await screen.findByTestId('collection-checklist-sheet');
    expect(within(sheet).getByTestId('checklist-line-2')).toHaveTextContent(/Missing/);
    expect(within(sheet).getByTestId('collection-checklist-review')).toHaveTextContent('Change the checklist');
    expect(audit()).toEqual([]);
  });

  it('a line not understood is opened: its kind chosen, it is looked for again', async () => {
    const t = vault();
    papers(t);
    collection(t, 'mort', 'fake-member');
    await openCollection(t, 'mort');
    await readList('The blue folder thing');
    expect(screen.getByTestId('checklist-item-0-status')).toHaveTextContent('Not understood');
    // Opened by itself, to choose.
    await fireEvent.press(screen.getByTestId('checklist-item-0-kind'));
    await fireEvent.press(await screen.findByTestId('checklist-pick-passport'));
    await waitFor(() => expect(screen.getByTestId('checklist-item-0-status')).toHaveTextContent('Found 1 of 1'));
    expect(screen.getByTestId('checklist-item-0-kind')).toHaveTextContent(/Passport$/);

    // How many, and skipping it.
    await fireEvent.press(screen.getByTestId('checklist-item-0-count'));
    await fireEvent.press(await screen.findByTestId('checklist-pick-n:2'));
    await waitFor(() => expect(screen.getByTestId('checklist-item-0-status')).toHaveTextContent('Found 1 of 2'));
    await fireEvent(screen.getByTestId('checklist-item-0-skip'), 'valueChange', true);
    await waitFor(() => expect(screen.getByTestId('checklist-item-0-status')).toHaveTextContent('Skipped'));
    // Nothing ticked: the list is kept alone.
    expect(screen.getByTestId('checklist-save')).toHaveTextContent('Keep the list');
  });

  it('nothing typed is said; the vault busy (503) is said in its words', async () => {
    const t = vault();
    collection(t, 'mort', 'fake-member');
    const inner = t.fetch;
    t.fetch = async (url, init) =>
      init.method === 'POST' && url.endsWith('/checklist')
        ? ({
            ok: false,
            status: 503,
            headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
            json: async () => ({
              error: { code: 'checklist_unavailable', message: 'The list could not be read just now. Try again in a moment.' },
            }),
            text: async () => '',
          } as never)
        : inner(url, init);
    await openCollection(t, 'mort');
    await fireEvent.press(await screen.findByTestId('collection-checklist-fill'));
    await fireEvent.press(await screen.findByTestId('checklist-read'));
    expect(await screen.findByTestId('checklist-problem')).toHaveTextContent(/^Paste or type the list first/);
    await fireEvent.changeText(screen.getByTestId('checklist-text'), 'Passport');
    await fireEvent.press(screen.getByTestId('checklist-read'));
    await waitFor(() =>
      expect(screen.getByTestId('checklist-problem')).toHaveTextContent(
        'The list could not be read just now. Try again in a moment.',
      ),
    );
    expect(screen.queryByTestId('checklist-review')).toBeNull();
  });

  it('Cancel with a list typed asks first', async () => {
    const t = vault();
    collection(t, 'mort', 'fake-member');
    await openCollection(t, 'mort');
    await fireEvent.press(await screen.findByTestId('collection-checklist-fill'));
    await fireEvent.changeText(await screen.findByTestId('checklist-text'), 'Passport');
    await fireEvent.press(screen.getByTestId('checklist-cancel'));
    expect(await screen.findByText('Leave without saving?')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('checklist-cancel-no'));
    expect(routes().at(-1)?.pathname).toBe('/checklist/[id]');
  });

  it("somebody else's collection: its checklist to read, nothing to change", async () => {
    const t = vault();
    papers(t);
    const c = collection(t, 'mort', 'someone-else', ['passport']);
    c.checklist = {
      saved_at: '2026-11-01T00:00:00Z',
      items: [
        {
          line: 'Passport',
          heading: null,
          type_key: 'passport',
          member_id: null,
          count: null,
          months: null,
          years: [],
          current: false,
          form: null,
          skipped: false,
        },
      ],
    };
    await openCollection(t, 'mort');
    expect(screen.queryByTestId('collection-checklist-fill')).toBeNull();
    expect(await screen.findByTestId('collection-checklist-line')).toHaveTextContent('1 of 1 found');
    await fireEvent.press(screen.getByTestId('collection-checklist'));
    await screen.findByTestId('collection-checklist-sheet');
    expect(screen.queryByTestId('collection-checklist-review')).toBeNull();
    expect(screen.queryByTestId('collection-checklist-clear')).toBeNull();
  });

  it("somebody else's collection, opened at its checklist: said plainly, and nothing to save", async () => {
    const t = vault();
    collection(t, 'mort', 'someone-else');
    push({ pathname: '/checklist/[id]', params: { id: 'mort' } });
    await unlocked(t, <Text>Collections</Text>);
    expect(await screen.findByTestId('checklist-not-mine')).toHaveTextContent(
      'Only the person who made this collection can fill it from a checklist.',
    );
    expect(screen.queryByTestId('checklist-text')).toBeNull();
    expect(screen.getByTestId('checklist-save').props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );
  });

  it('its maker clears a kept checklist, asked first; Fill from a checklist is back', async () => {
    const t = vault();
    papers(t);
    const c = collection(t, 'mort', 'fake-member');
    c.checklist = {
      saved_at: '2026-11-01T00:00:00Z',
      items: [
        {
          line: 'Passport',
          heading: null,
          type_key: 'passport',
          member_id: null,
          count: null,
          months: null,
          years: [],
          current: false,
          form: null,
          skipped: false,
        },
      ],
    };
    await openCollection(t, 'mort');
    // A new match, said to its maker; nothing added until they choose.
    expect(await screen.findByTestId('collection-checklist-line')).toHaveTextContent('1 of 1 found · 1 new match');
    await fireEvent.press(screen.getByTestId('collection-checklist'));
    expect(await screen.findByTestId('checklist-new')).toHaveTextContent(/Nothing is added until you choose/);
    expect(screen.getByTestId('collection-checklist-review')).toHaveTextContent('Review and add');
    await fireEvent.press(screen.getByTestId('collection-checklist-clear'));
    expect(await screen.findByText('Clear the checklist?')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('collection-checklist-clear-cancel'));
    expect(c.checklist?.items).toHaveLength(1);

    await fireEvent.press(screen.getByTestId('collection-checklist'));
    await fireEvent.press(await screen.findByTestId('collection-checklist-clear'));
    await fireEvent.press(await screen.findByTestId('collection-checklist-clear-yes'));
    await waitFor(() => expect(c.checklist?.items).toEqual([]));
    expect(await screen.findByTestId('collection-checklist-fill')).toBeTruthy();
    expect(screen.queryByTestId('collection-checklist')).toBeNull();
    expect(screen.getByTestId('collection-said')).toHaveTextContent(/^The checklist is off “Mortgage”\./);
  });

  it('a missing paper: Add it offers a file or a picture, to be found once it is in', async () => {
    const t = vault();
    collection(t, 'mort', 'fake-member');
    await openCollection(t, 'mort');
    await readList('Passport');
    expect(screen.getByTestId('checklist-item-0-status')).toHaveTextContent('Missing');
    await fireEvent.press(screen.getByTestId('checklist-item-0-add'));
    const sheet = await screen.findByTestId('checklist-capture');
    expect(within(sheet).getByTestId('checklist-capture-file')).toBeTruthy();
    expect(within(sheet).getByTestId('checklist-capture-picture')).toBeTruthy();
    expect(audit()).toEqual([]);
    await fireEvent.press(within(sheet).getByTestId('checklist-capture-cancel'));
  });
});
