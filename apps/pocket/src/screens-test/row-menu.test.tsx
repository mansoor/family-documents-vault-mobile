import { sharedOutsideWords, type DocumentView, type SearchHit } from '@fdv/shared';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import Home from '../app/(tabs)/index';
import SearchScreen from '../app/(tabs)/search';
import { copySettings, saveCopyIo } from '../documents/save-copy';
import { audit } from '../test-support/a11y';
import { addGuest, GUEST, signedInAs } from '../test-support/guest';
import { libraryDoc, unlocked } from '../test-support/lookup';
import { installed, respond } from '../test-support/render';
import { resetRoutes, routes } from '../test-support/router';
import { capabilities, caps0519, testVault, type TestVault } from '../test-support/vault';

jest.mock(
  'expo-router',
  () => jest.requireActual<typeof import('../test-support/router')>('../test-support/router').routerMock,
);

const ORIGIN = 'https://vault.test';

beforeEach(() => {
  installed();
  resetRoutes();
  copySettings.graceMs = 0;
});

afterEach(() => jest.restoreAllMocks());

/** A vault with collections (0.5.12 and later), and limits and guests (0.5.33, 0.5.34). */
function vault(): TestVault {
  const t = testVault([ORIGIN]);
  t.caps = capabilities({
    server_version: '0.5.37',
    features: { ...caps0519().features, access_restrictions: true, guests: true },
  });
  return t;
}

/** In the vault's lists too (Home's, a person's, a collection's), as the client's fake keeps documents. */
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

/** A collection as the client's fake keeps one: for everyone in the family, made by `owner`. */
function made(id: string, name: string, owner: string) {
  return {
    id,
    name,
    description: null,
    audience: 'everyone' as 'everyone' | 'adults',
    owner_member_id: owner,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    revision: 1,
    deleted: false,
    items: [],
  };
}

function hit(doc: DocumentView): SearchHit {
  return {
    document_id: doc.id,
    title: doc.title,
    type_key: doc.type_key,
    category: 'identity',
    owner_member_id: doc.owner_member_id,
    status: doc.status,
    snippet: '',
    matched_in: 'title',
  } as SearchHit;
}

/** Searched for, and its ⋯ pressed. */
async function fromSearch(t: TestVault, docs: DocumentView[], id: string) {
  t.library.search = () => ({ items: docs.map(hit), sealed: 0 });
  await fireEvent.changeText(await screen.findByTestId('search-field'), 'any');
  await fireEvent.press(await screen.findByTestId(`doc-menu-${id}`));
  return screen.findByTestId('row-sheet');
}

/** A choice of the sheet's, once it may be pressed. */
async function ready(testID: string) {
  const choice = await screen.findByTestId(testID);
  await waitFor(() => expect(screen.getByTestId(testID).props.accessibilityState.disabled).toBe(false));
  return choice;
}

/** What the sheet offers, as a screen reader lists it. */
const offered = () =>
  within(screen.getByTestId('row-sheet'))
    .getAllByRole('menuitem')
    .map((i) => String(i.props.accessibilityLabel));

describe('a menu on every row (5.36)', () => {
  it("a viewer's sheet has Open and Save a copy only", async () => {
    const t = vault();
    t.vault.state.role = 'viewer';
    const bill = libraryDoc(t, { id: 'bill', title: 'Water bill' });
    const passport = libraryDoc(t, { id: 'passport', title: 'Passport', is_essential: true });
    await unlocked(t, <SearchScreen />);
    // From the ⋯: what a search hit is, asked of the vault as the sheet opens.
    await fromSearch(t, [bill, passport], 'bill');
    await waitFor(() => expect(offered()).toContain('Save a copy'));
    expect(offered()).toEqual(['Open', 'Save a copy']);
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByTestId('row-sheet-cancel'));
    // An Essential too: the menu offers a viewer what they came for.
    await fireEvent.press(screen.getByTestId('doc-menu-passport'));
    await screen.findByTestId('row-sheet');
    await waitFor(() => expect(offered()).toContain('Save a copy'));
    expect(offered()).toEqual(['Open', 'Save a copy']);
  });

  it("an owner's sheet has the rest, in order", async () => {
    const t = vault();
    const passport = libraryDoc(t, { id: 'passport', title: 'Passport', is_essential: true });
    await unlocked(t, <SearchScreen />);
    await fromSearch(t, [passport], 'passport');
    await waitFor(() => expect(offered()).toContain('Show'));
    expect(offered()).toEqual([
      'Open',
      'Show',
      'Save a copy',
      'Add a new version',
      'Stop it being Essential',
      'Add to a collection',
    ]);
    // Keeping it offline is what an Essential is: said with it.
    expect(screen.getByTestId('row-sheet-essential')).toHaveTextContent(
      "Stop it being EssentialEssentials are the ones you might need anywhere — kept on this phone if you keep them.",
    );
    expect(audit()).toEqual([]);
  });

  it("a teen's sheet for somebody else's document: nothing that changes it", async () => {
    const t = vault();
    t.vault.state.role = 'teen';
    const deed = libraryDoc(t, { id: 'deed', title: 'House deed', owner_member_id: 'someone-else' });
    const mine = libraryDoc(t, { id: 'mine', title: 'My passport', owner_member_id: 'fake-member' });
    await unlocked(t, <SearchScreen />);
    await fromSearch(t, [deed, mine], 'deed');
    await waitFor(() => expect(offered()).toContain('Save a copy'));
    expect(offered()).toEqual(['Open', 'Save a copy', 'Add to a collection']);
    await fireEvent.press(screen.getByTestId('row-sheet-cancel'));
    // Their own, from a long press on its row.
    await fireEvent(screen.getByTestId('doc-row-mine'), 'longPress');
    await screen.findByTestId('row-sheet');
    await waitFor(() => expect(offered()).toContain('Make it Essential'));
    expect(offered()).toEqual(['Open', 'Save a copy', 'Add a new version', 'Make it Essential', 'Add to a collection']);
  });

  it("a guest's sheet has no Keep offline / Essential", async () => {
    const t = vault();
    addGuest(t, '2026-12-04T23:59:00Z');
    const passport = listed(t, libraryDoc(t, { id: 'passport', title: 'Passport', is_essential: true }));
    await unlocked(t, <Home />, { before: () => signedInAs(t, GUEST.email, GUEST.password) });
    // Home's row, by a long press.
    await fireEvent(await screen.findByTestId(`doc-row-${passport.id}`), 'longPress');
    await screen.findByTestId('row-sheet');
    await waitFor(() => expect(offered()).toContain('Save a copy'));
    expect(offered()).toEqual(['Open', 'Save a copy']);
    expect(screen.queryByTestId('row-sheet-essential')).toBeNull();
    expect(screen.queryByText(/Essential/)).toBeNull();
  });

  it('opens from the ⋯ and from a long press on Home, and Open goes to the document', async () => {
    const t = vault();
    const bill = listed(t, libraryDoc(t, { id: 'bill', title: 'Water bill' }));
    await unlocked(t, <Home />);
    const more = await screen.findByTestId(`doc-menu-${bill.id}`);
    expect(more.props.accessibilityLabel).toBe('Actions for “Water bill”');
    await fireEvent.press(more);
    expect(within(await screen.findByTestId('row-sheet')).getByText('Water bill')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('row-sheet-cancel'));
    await waitFor(() => expect(screen.queryByTestId('row-sheet')).toBeNull());
    // A tap on the row still opens it; a long press opens the sheet.
    await fireEvent(screen.getByTestId(`doc-row-${bill.id}`), 'longPress');
    await screen.findByTestId('row-sheet');
    expect(routes()).toEqual([]);
    await fireEvent.press(screen.getByTestId('row-sheet-open'));
    expect(routes().at(-1)).toEqual({ pathname: '/document/[id]', params: { id: 'bill' } });
  });

  it('Make it Essential, from the sheet: the vault keeps it so, and the sheet says it', async () => {
    const t = vault();
    const bill = libraryDoc(t, { id: 'bill', title: 'Water bill' });
    await unlocked(t, <SearchScreen />);
    await fromSearch(t, [bill], 'bill');
    await fireEvent.press(await ready('row-sheet-essential'));
    expect(await screen.findByTestId('row-sheet-said')).toHaveTextContent(
      "It's an Essential now. A phone that keeps Essentials keeps it for when there's no signal.",
    );
    expect(t.library.documents.get('bill')?.is_essential).toBe(true);
    expect(offered()).toContain('Stop it being Essential');
  });

  it("opened again, the sheet starts from what it last had, not the list's stale copy", async () => {
    const t = vault();
    const bill = listed(t, libraryDoc(t, { id: 'bill', title: 'Water bill' }));
    let hold: Promise<void> | null = null;
    let answer: () => void = () => undefined;
    const base = t.fetch;
    t.fetch = async (url, init) => {
      if (hold && url.endsWith('/api/v1/documents/bill') && init.method === 'GET') await hold;
      return base(url, init);
    };
    await unlocked(t, <Home />);
    // Made an Essential from Home's ⋯ — and Home's list is not loaded again.
    await fireEvent.press(await screen.findByTestId(`doc-menu-${bill.id}`));
    await fireEvent.press(await ready('row-sheet-essential'));
    await screen.findByTestId('row-sheet-said');
    await fireEvent.press(screen.getByTestId('row-sheet-cancel'));
    await waitFor(() => expect(screen.queryByTestId('row-sheet')).toBeNull());
    // Opened again while the vault is slow to answer: what the sheet last had, at once.
    hold = new Promise<void>((resolve) => {
      answer = resolve;
    });
    await fireEvent.press(screen.getByTestId(`doc-menu-${bill.id}`));
    await screen.findByTestId('row-sheet');
    expect(offered()).toEqual([
      'Open',
      'Show',
      'Save a copy',
      'Add a new version',
      'Stop it being Essential',
      'Add to a collection',
    ]);
    // Nothing is changed from it until the vault has answered: no stale ETag, no "someone changed this".
    expect(screen.getByTestId('row-sheet-essential').props.accessibilityState.disabled).toBe(true);
    const patches = () => t.calls.filter((c) => c.startsWith('PATCH ')).length;
    const before = patches();
    await fireEvent.press(screen.getByTestId('row-sheet-essential'));
    expect(patches()).toBe(before);
    expect(screen.queryByText("Someone changed this while you were looking. Here's the latest.")).toBeNull();
    await act(async () => answer());
    await ready('row-sheet-essential');
  });

  it('Add to a collection: only those one made; the sheet waits for it, and says who else sees it', async () => {
    const t = vault();
    const bill = listed(t, libraryDoc(t, { id: 'bill', title: 'Water bill' }));
    t.vault.state.collections.push(made('acc', 'For the accountant', 'fake-member'), made('theirs', 'Holiday', 'x'));
    // Shared outside the family (5.19), as the vault says it to the collection's maker…
    const outside = { with: ['Jane Smith'], following: true };
    // …and, once something is put in, who else will now see it (5.33) — after a slow connection.
    let answer: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      answer = resolve;
    });
    const base = t.fetch;
    t.fetch = async (url, init) => {
      const res = await base(url, init);
      if (url.endsWith('/api/v1/collections') && init.method === 'GET' && res.ok) {
        const body = (await res.json()) as { items: { id: string }[] };
        return respond(200, { items: body.items.map((c) => (c.id === 'acc' ? { ...c, shared_outside: outside } : c)) });
      }
      if (!/\/collections\/[^/]+\/items$/.test(url) || init.method !== 'POST' || !res.ok) return res;
      await held;
      const body = (await res.json()) as Record<string, unknown>;
      return respond(200, { ...body, warnings: ['Jane Smith (guest) will be able to see this.'] });
    };
    await unlocked(t, <SearchScreen />);
    await fromSearch(t, [bill], 'bill');
    await fireEvent.press(await screen.findByTestId('row-sheet-collect'));
    await screen.findByTestId('row-collection-acc');
    expect(screen.queryByTestId('row-collection-theirs')).toBeNull();
    expect(screen.getByTestId('row-collection-acc')).toHaveTextContent(/0 documents/);
    // The warning is heard with the Add button itself, not only read beside it (S536-02).
    const add = screen.getByTestId('row-collection-add-acc');
    expect(add.props.accessibilityLabel).toBe('Add to “For the accountant”');
    expect(add.props.accessibilityHint).toBe(sharedOutsideWords(outside, 'owner'));
    expect(audit()).toEqual([]);
    await fireEvent.press(add);
    // On its way: Done, Back and a tap outside all wait for it (U536-01).
    await waitFor(() => expect(screen.getByTestId('row-sheet-cancel').props.accessibilityState.disabled).toBe(true));
    await fireEvent.press(screen.getByTestId('row-sheet-cancel'));
    await fireEvent.press(screen.getByTestId('row-sheet-outside', { includeHiddenElements: true }));
    await fireEvent(screen.getByTestId('row-sheet'), 'requestClose');
    expect(screen.getByTestId('row-sheet')).toBeTruthy();
    await act(async () => answer());
    expect(await screen.findByTestId('row-sheet-said')).toHaveTextContent(
      '“Water bill” is in “For the accountant” now. Jane Smith (guest) will be able to see this.',
    );
    expect(await screen.findByTestId('row-collection-in-acc')).toHaveTextContent('In this collection');
    expect(screen.getByTestId('row-collection-acc')).toHaveTextContent(/1 document[^s]/);
    expect(t.vault.state.collections[0]?.items.map((i) => i.document_id)).toEqual(['bill']);
    // Done now.
    expect(screen.getByTestId('row-sheet-cancel').props.accessibilityState.disabled).toBe(false);
    await fireEvent.press(screen.getByTestId('row-sheet-cancel'));
    await waitFor(() => expect(screen.queryByTestId('row-sheet')).toBeNull());
  });

  it("collections one made for people one is no longer one of are said to be so, not that there are none", async () => {
    const t = vault();
    // An adult who made an Adults collection, since made a teen (A18).
    t.vault.state.role = 'teen';
    const mine = listed(t, libraryDoc(t, { id: 'mine', title: 'My passport', owner_member_id: 'fake-member' }));
    t.vault.state.collections.push({ ...made('grown', 'Grown-up papers', 'fake-member'), audience: 'adults' });
    await unlocked(t, <SearchScreen />);
    await fromSearch(t, [mine], 'mine');
    await fireEvent.press(await screen.findByTestId('row-sheet-collect'));
    expect(await screen.findByTestId('row-collections-none')).toHaveTextContent(
      'The collection you made is for people you are no longer one of: you can still delete it, but not put documents in it.',
    );
    expect(screen.queryByText(/haven't made a collection/)).toBeNull();
  });

  it('Save a copy, from the sheet: warned the first time, then handed over, and the sheet is done with', async () => {
    const t = vault();
    const bill = libraryDoc(t, { id: 'bill', title: 'Water bill' });
    const files = new Set<string>();
    const shared: string[] = [];
    jest.spyOn(saveCopyIo, 'write').mockImplementation(async (name) => {
      const uri = `cache:/copies/${name}`;
      files.add(uri);
      return uri;
    });
    jest.spyOn(saveCopyIo, 'share').mockImplementation(async (uri) => void shared.push(uri));
    jest.spyOn(saveCopyIo, 'remove').mockImplementation(async (uri) => void files.delete(uri));
    await unlocked(t, <SearchScreen />);
    await fromSearch(t, [bill], 'bill');
    await fireEvent.press(await screen.findByTestId('row-sheet-save'));
    expect(await screen.findByTestId('row-sheet-save-warning')).toHaveTextContent(
      "The copy you save is outside the vault, where the vault can't protect it.",
    );
    expect(shared).toEqual([]);
    await fireEvent.press(screen.getByTestId('row-sheet-save-anyway'));
    await waitFor(() => expect(shared).toEqual(['cache:/copies/bill.pdf']));
    await waitFor(() => expect(screen.queryByTestId('row-sheet')).toBeNull());
    expect(files.size).toBe(0);
    // Warned once: the next copy goes straight to the share sheet.
    await fireEvent.press(screen.getByTestId('doc-menu-bill'));
    await fireEvent.press(await screen.findByTestId('row-sheet-save'));
    await waitFor(() => expect(shared).toHaveLength(2));
    expect(screen.queryByTestId('row-sheet-save-warning')).toBeNull();
  });

  it('Show, from the sheet: an Essential not kept here is fetched first, then shown', async () => {
    const t = vault();
    const passport = libraryDoc(t, { id: 'passport', title: 'Passport', is_essential: true });
    await unlocked(t, <SearchScreen />);
    await fromSearch(t, [passport], 'passport');
    await fireEvent.press(await screen.findByTestId('row-sheet-show'));
    await waitFor(() =>
      expect(routes().at(-1)).toEqual({ pathname: '/show/[id]', params: { id: 'passport', online: '1' } }),
    );
    expect(await screen.findByTestId('show-image')).toBeTruthy();
  });

  it('nothing new appears on an older vault: without collections, no Add to a collection', async () => {
    const t = testVault([ORIGIN]);
    // A vault before 0.5.12 says nothing of collections.
    expect(t.caps.features.collections).toBeUndefined();
    const bill = libraryDoc(t, { id: 'bill', title: 'Water bill' });
    await unlocked(t, <SearchScreen />);
    await fromSearch(t, [bill], 'bill');
    await waitFor(() => expect(offered()).toContain('Make it Essential'));
    expect(offered()).toEqual(['Open', 'Save a copy', 'Add a new version', 'Make it Essential']);
    await act(async () => undefined);
  });
});
