import type { CollectionDetail, DocumentView, SearchHit } from '@fdv/shared';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import * as Linking from 'expo-linking';
import { Text } from 'react-native';
import DocumentsScreen from '../app/(tabs)/documents';
import Home from '../app/(tabs)/index';
import MoreScreen from '../app/(tabs)/more';
import { caregiversOffered, endWords, grantWords, isCaregiverPaper } from '../caregivers/rules';
import { rowActions } from '../documents/menu';
import { AddDocuments } from '../collections/add';
import { DocumentDetail } from '../documents/detail';
import { DocumentRow } from '../documents/row';
import { EssentialPages } from '../essentials/pages';
import i18n from '../i18n';
import { audit } from '../test-support/a11y';
import { libraryDoc, openSearch, unlocked } from '../test-support/lookup';
import { installed } from '../test-support/render';
import { back, push, resetRoutes, routes } from '../test-support/router';
import { caps0519, capabilities, testVault, type TestVault } from '../test-support/vault';

jest.mock(
  'expo-router',
  () => jest.requireActual<typeof import('../test-support/router')>('../test-support/router').routerMock,
);

const ORIGIN = 'https://vault.test';
const t = i18n.t.bind(i18n);

beforeEach(() => {
  installed();
  resetRoutes();
});
afterEach(() => jest.restoreAllMocks());

/**
 * A vault of 0.9.0-dev.43 — caregivers and turning 18, unless `caregivers`
 * is false — and the family: Pat and Sam (adults), Kim (a teen), Sara (no
 * sign-in). The person signed in is the fake's owner, unless `role`.
 */
function vault(over: { caregivers?: boolean; role?: 'owner' | 'adult' | 'teen' | 'viewer' } = {}): TestVault {
  const t = testVault([ORIGIN]);
  t.caps = capabilities({
    server_version: '0.9.0-dev.43',
    features: {
      ...caps0519().features,
      notes: true,
      ...(over.caregivers === false ? {} : { caregivers: true }),
    },
  });
  t.vault.state.members.push(
    { id: 'pat', display_name: 'Pat', role: 'adult', is_me: false } as never,
    { id: 'sam', display_name: 'Sam', role: 'adult', is_me: false } as never,
    { id: 'kim', display_name: 'Kim', role: 'teen', is_me: false } as never,
    { id: 'sara', display_name: 'Sara', is_me: false } as never,
  );
  if (over.role) t.vault.state.role = over.role;
  return t;
}

/** A grant, as the fake keeps it. */
function grant(t: TestVault, person: string, caregiver: string, over: { confirmed?: boolean; by?: string } = {}) {
  (t.vault.state.caregivers ??= []).push({
    id: `g-${person}-${caregiver}`,
    person,
    caregiver,
    granted_by: over.by ?? person,
    granted_at: '2026-11-14T09:00:00Z',
    confirmed: over.confirmed ?? true,
    revoked: false,
  });
}

/** Pat's blood test results, Only me, which the person sees only as Pat's caregiver. */
function bloodTest(t: TestVault, over: Partial<DocumentView> = {}): DocumentView {
  return libraryDoc(t, {
    id: 'blood',
    title: 'Blood test results',
    type_key: 'medical_record',
    category: 'medical',
    owner_member_id: 'pat',
    visibility: 'private',
    caregiver: true,
    notes: null,
    notes_updated_at: null,
    is_essential: true,
    ...over,
  } as Partial<DocumentView> & { id: string });
}

/** Pat's paper in the vault's lists too, as the client's fake keeps documents: answered as a caregiver's. */
function listedBloodTest(t: TestVault) {
  t.vault.state.documents.push({
    id: 'blood',
    title: 'Blood test results',
    type_key: 'passport',
    owner_member_id: 'pat',
    visibility: 'household',
    identifier: null,
    issued_by: null,
    issued: null,
    expires: null,
    physical_location: null,
    tags: [],
    notes: null,
    extra: {},
  } as never);
  t.library.caregiver.add('blood');
}

describe('caregivers: the rules (H1b)', () => {
  it('offered to owners, adults and teens on a vault with caregivers; never a viewer, never an older vault', () => {
    const on = capabilities({ features: { ...capabilities().features, caregivers: true } });
    expect(caregiversOffered(on, 'owner')).toBe(true);
    expect(caregiversOffered(on, 'adult')).toBe(true);
    expect(caregiversOffered(on, 'teen')).toBe(true);
    expect(caregiversOffered(on, 'viewer')).toBe(false);
    expect(caregiversOffered(capabilities(), 'owner')).toBe(false);
  });

  it("a caregiver's paper offers Save a copy, and nothing else", () => {
    const doc = {
      owner_member_id: 'pat',
      is_essential: true,
      latest_version_id: 'v1',
      file_removed: false,
      caregiver: true as const,
    };
    expect(isCaregiverPaper(doc)).toBe(true);
    const who = { role: 'owner' as const, member_id: 'fake-member' };
    expect(rowActions(who, doc, { collections: true, renewing: false, edit: true })).toEqual(['save']);
    expect(rowActions(who, { ...doc, latest_version_id: null }, { collections: true, renewing: false })).toEqual([]);
    // The same paper, not through a grant: everything an owner may do.
    const { caregiver: _c, ...plain } = doc;
    expect(rowActions(who, plain, { collections: true, renewing: false })).toContain('collect');
  });

  it("words: kept, named by an owner, and the question before it ends — never an id", () => {
    const g = {
      id: 'g1',
      person_member_id: 'sara',
      person_name: 'Sara',
      caregiver_member_id: 'pat',
      caregiver_name: 'Pat',
      granted_at: '2026-11-14T09:00:00Z',
      granted_by_name: 'Fake Owner',
      confirmed: false,
      may_revoke: true,
      may_keep: false,
      may_give_up: false,
    };
    expect(grantWords(g, false, 'Sara', t)).toBe('Named by Fake Owner. Sara can keep this once they have their own sign-in.');
    expect(grantWords({ ...g, confirmed: true }, true, 'Sara', t)).toBe(
      'Can see your medical papers, Only me ones included.',
    );
    expect(endWords(g, false, 'Sara', t).title).toBe('Stop Pat seeing Sara’s medical papers?');
    const mine = { ...g, may_revoke: false, may_give_up: true };
    expect(endWords(mine, false, 'Sara', t)).toEqual({
      title: 'Stop seeing Sara’s medical papers?',
      words: 'You won’t see Sara’s Only me medical papers any more. Sara can name you again.',
      confirm: 'Stop seeing them',
      done: 'You no longer see Sara’s medical papers.',
    });
  });
});

/** Every GET of one paper by its id: the vault writes each one read through a grant down as a look. */
const papersAsked = (t: TestVault) => t.calls.filter((c) => /^GET \S+\/api\/v1\/documents\/[^/?]+$/.test(c));

/** What a row's ⋯ offers, as a screen reader lists it. */
const offered = () =>
  within(screen.getByTestId('row-sheet'))
    .getAllByRole('menuitem')
    .map((i) => String(i.props.accessibilityLabel));

describe('a paper seen as its person’s caregiver (H1b)', () => {
  it('its page says so, never "Only me", and offers reading, Pages and Save a copy only', async () => {
    const t = vault();
    // With its person's notes and in a collection of theirs, which a caregiver is never shown.
    bloodTest(t, { notes: 'Take with food', notes_updated_at: '2026-11-01T00:00:00Z' });
    t.library.collections.set('blood', [{ id: 'health', name: 'Health' }]);
    await unlocked(t, <DocumentDetail id="blood" />);
    expect(await screen.findByTestId('document-caregiver')).toHaveTextContent('Shared with you as caregiver', {
      exact: false,
    });
    await waitFor(() => expect(screen.getByTestId('document-subline')).toHaveTextContent('Pat', { exact: false }));
    expect(screen.getByTestId('document-subline')).not.toHaveTextContent(/Only me/);
    expect(screen.getByTestId('document-visibility')).toHaveTextContent('Pat’s, shared with you as caregiver', {
      exact: false,
    });
    expect(screen.getByTestId('document-caregiver-words')).toHaveTextContent(
      'Pat lets you see their medical papers. You can read this and save a copy, but not change or share it.',
      { exact: false },
    );
    // Read: Pages and Save a copy. Nothing else — not even Show, from a copy kept on the phone.
    expect(screen.getByTestId('document-pages')).toBeTruthy();
    expect(screen.getByTestId('document-save')).toBeTruthy();
    await waitFor(() => expect(t.calls.some((c) => c.endsWith('/api/v1/documents/blood/collections'))).toBe(true));
    for (const id of [
      'document-edit',
      'document-more',
      'document-show',
      'document-add-version',
      'document-essential',
      'document-notes',
      'document-notes-edited',
      'document-collections',
    ]) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
    expect(audit()).toEqual([]);
  });

  it('the same paper as one of the family’s shows its notes and collections: the guards are what hide them', async () => {
    const t = vault();
    const own: { caregiver?: true } = bloodTest(t, { notes: 'Take with food', notes_updated_at: '2026-11-01T00:00:00Z' });
    delete own.caregiver;
    t.library.collections.set('blood', [{ id: 'health', name: 'Health' }]);
    await unlocked(t, <DocumentDetail id="blood" />);
    expect(await screen.findByTestId('document-notes')).toBeTruthy();
    expect(await screen.findByTestId('document-collections')).toHaveTextContent('Health', { exact: false });
    expect(screen.queryByTestId('document-caregiver')).toBeNull();
  });

  it('over its pages too', async () => {
    const t = vault();
    bloodTest(t);
    await unlocked(t, <EssentialPages id="blood" online />);
    expect(await screen.findByTestId('essential-caregiver')).toHaveTextContent('Shared with you as caregiver', {
      exact: false,
    });
  });

  it('opened in Edit details by a link: read-only, and back to it', async () => {
    const t = vault();
    bloodTest(t);
    push({ pathname: '/edit/[id]', params: { id: 'blood' } });
    await unlocked(t, <Text>Documents</Text>);
    expect(await screen.findByTestId('edit-caregiver')).toHaveTextContent(/can’t change it, share it/);
    await fireEvent.press(screen.getByTestId('edit-caregiver-back'));
    expect(routes()).toEqual([]);
  });

  it('in Documents: marked, no picture, and its ⋯ offers Save a copy without asking the vault for the paper', async () => {
    const t = vault();
    listedBloodTest(t);
    await unlocked(t, <DocumentsScreen />);
    expect(await screen.findByTestId('caregiver-mark-blood')).toHaveTextContent('Shared with you as caregiver', {
      exact: false,
    });
    expect(screen.getByTestId('doc-row-blood').props.accessibilityLabel).toMatch(/Shared with you as caregiver/);
    // Its picture would be a look the vault writes down: none in a list.
    expect(screen.queryByTestId('doc-thumb-blood')).toBeNull();
    await fireEvent.press(screen.getByTestId('doc-menu-blood'));
    await screen.findByTestId('row-sheet');
    expect(offered()).toEqual(['Save a copy']);
    expect(papersAsked(t)).toEqual([]);
  });

  it('with no file, its ⋯ says there is nothing to do here — not that the connection is gone', async () => {
    const t = vault();
    const doc = { ...bloodTest(t), latest_version_id: null };
    await unlocked(t, <DocumentRow id="blood" title={doc.title} status={doc.status} doc={doc} />);
    await fireEvent.press(await screen.findByTestId('doc-menu-blood'));
    expect(await screen.findByTestId('row-sheet-nothing')).toHaveTextContent('Nothing to do with this paper here', {
      exact: false,
    });
    expect(papersAsked(t)).toEqual([]);
  });

  it("on a collection's page, its ⋯ never offers Remove from this collection", async () => {
    const t = vault();
    const doc = bloodTest(t);
    const remove = { onRemove: jest.fn(async () => null), collection: 'Health' };
    await unlocked(t, <DocumentRow id="blood" title={doc.title} status={doc.status} doc={doc} remove={remove} />);
    await fireEvent.press(await screen.findByTestId('doc-menu-blood'));
    await screen.findByTestId('row-sheet');
    expect(offered()).toEqual(['Save a copy']);
  });

  it('on Home: marked among what was added last, and left out of the numbers', async () => {
    const t = vault();
    t.caps = capabilities({ ...t.caps, features: { ...t.caps.features, document_table: true } });
    grant(t, 'pat', 'fake-member');
    listedBloodTest(t);
    t.vault.state.documents.push({ id: 'mine', title: 'My passport', type_key: 'passport', tags: [], extra: {} } as never);
    await unlocked(t, <Home />);
    await screen.findByTestId('home-ready');
    expect(await screen.findByTestId('caregiver-mark-blood')).toBeTruthy();
    expect(screen.queryByTestId('doc-thumb-blood')).toBeNull();
    // Two in the vault's count; one of them the person's own.
    await waitFor(() => expect(screen.getByTestId('home-count-documents')).toHaveTextContent(/^1\s*document/));
    expect(papersAsked(t)).toEqual([]);
  });

  it("on Pat's page: marked, with no picture", async () => {
    const t = vault();
    listedBloodTest(t);
    push({ pathname: '/person/[id]', params: { id: 'pat', name: 'Pat' } });
    await unlocked(t, <Text>People</Text>);
    expect(await screen.findByTestId('caregiver-mark-blood')).toBeTruthy();
    expect(screen.queryByTestId('doc-thumb-blood')).toBeNull();
    expect(papersAsked(t)).toEqual([]);
  });

  /** Pat's blood test and passport, found by a search: the hits say nothing of grants. */
  function searchable(t: TestVault) {
    grant(t, 'pat', 'fake-member');
    listedBloodTest(t);
    const passport = libraryDoc(t, { id: 'passport', title: 'Passport', owner_member_id: 'pat' });
    const hit = (id: string, title: string, category: string): SearchHit =>
      ({
        document_id: id,
        title,
        type_key: 'passport',
        category,
        owner_member_id: 'pat',
        status: passport.status,
        snippet: '',
        matched_in: 'title',
      }) as SearchHit;
    t.library.search = () => ({
      items: [hit('blood', 'Blood test results', 'medical'), hit('passport', 'Passport', 'identity')],
      sealed: 0,
    });
  }

  it("found by a search: marked from Pat's list, never by asking for each paper (each would be a look)", async () => {
    const t = vault();
    searchable(t);
    await unlocked(t, <DocumentsScreen />);
    await openSearch();
    await fireEvent.changeText(await screen.findByTestId('search-field'), 'test');
    expect(await screen.findByTestId('caregiver-mark-blood')).toBeTruthy();
    expect(screen.queryByTestId('caregiver-mark-passport')).toBeNull();
    expect(t.calls.some((c) => c.includes('/api/v1/documents?') && c.includes('member_id=pat'))).toBe(true);
    // Its ⋯ starts from what the list said: nothing asked of the vault for it.
    await fireEvent.press(screen.getByTestId('doc-menu-blood'));
    await screen.findByTestId('row-sheet');
    expect(offered()).toEqual(['Save a copy']);
    expect(papersAsked(t)).toEqual([]);
  });

  it('Add documents leaves them out, from Recent and from a search, asking for no paper', async () => {
    const t = vault();
    searchable(t);
    t.vault.state.documents.push({ id: 'mine', title: 'My passport', type_key: 'passport', tags: [], extra: {} } as never);
    const collection = { id: 'trip', name: 'Trip', audience: 'everyone', items: [] } as unknown as CollectionDetail;
    await unlocked(
      t,
      <AddDocuments collection={collection} inIt={new Set()} onClose={() => undefined} onAdded={() => undefined} />,
    );
    expect(await screen.findByTestId('add-documents-mine')).toBeTruthy();
    await waitFor(() => expect(t.calls.some((c) => c.includes('member_id=pat'))).toBe(true));
    await waitFor(() => expect(screen.queryByTestId('add-documents-blood')).toBeNull());
    await fireEvent.changeText(screen.getByTestId('add-documents-find'), 'test');
    expect(await screen.findByTestId('add-documents-passport')).toBeTruthy();
    expect(screen.queryByTestId('add-documents-blood')).toBeNull();
    expect(papersAsked(t)).toEqual([]);
  });

  it('the Only me filter means the person’s own: somebody else’s Only me is left out', async () => {
    const t = vault();
    listedBloodTest(t);
    t.vault.state.documents.push({
      id: 'mine',
      title: 'My letter',
      type_key: 'passport',
      visibility: 'private',
      tags: [],
      extra: {},
    } as never);
    await unlocked(t, <DocumentsScreen />);
    expect(await screen.findByTestId('caregiver-mark-blood')).toBeTruthy();
    await openSearch();
    await fireEvent.press(await screen.findByTestId('documents-filters'));
    await fireEvent.press(await screen.findByTestId('filter-visibility-private'));
    await fireEvent.press(await screen.findByTestId('filters-apply'));
    expect(await screen.findByTestId('doc-row-mine')).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId('doc-row-blood')).toBeNull());
  });
});

describe('More -> Caregivers (H1b)', () => {
  it('in More on a vault with caregivers; not on an older one, nor for a viewer', async () => {
    const t = vault();
    await unlocked(t, <MoreScreen />);
    await fireEvent.press(await screen.findByTestId('more-caregivers'));
    expect(routes().at(-1)).toEqual({ pathname: '/caregivers', params: {} });
  });

  it.each([
    ['an older vault', { caregivers: false }],
    ['a viewer', { role: 'viewer' as const }],
  ])('none for %s', async (_what, over) => {
    const t = vault(over);
    await unlocked(t, <MoreScreen />);
    await screen.findByTestId('more-account');
    expect(screen.queryByTestId('more-caregivers')).toBeNull();
  });

  it('let someone see my medical papers: chosen, said plainly, then listed; revoked only once asked', async () => {
    const t = vault();
    push('/caregivers');
    await unlocked(t, <Text>More</Text>);
    expect(await screen.findByTestId('caregivers-none')).toHaveTextContent('Nobody yet.', { exact: false });
    expect(await screen.findByTestId('caregivers-looks-none')).toHaveTextContent('Nobody has looked at your papers as a caregiver.', { exact: false });
    await fireEvent.press(screen.getByTestId('caregivers-choose'));
    await screen.findByTestId('caregivers-picker');
    // Only owners and adults are offered: never Kim (a teen), nor Sara (no sign-in).
    expect(screen.queryByTestId('caregivers-person-kim')).toBeNull();
    expect(screen.queryByTestId('caregivers-person-sara')).toBeNull();
    await fireEvent.press(screen.getByTestId('caregivers-person-pat'));
    expect(await screen.findByTestId('caregivers-new')).toHaveTextContent('Pat will see your medical papers', { exact: false });
    expect(t.vault.state.caregivers ?? []).toEqual([]);
    await fireEvent.press(screen.getByTestId('caregivers-name'));
    expect(await screen.findByTestId('caregivers-said')).toHaveTextContent('Pat can now see your medical papers.', { exact: false });
    expect(screen.getByTestId('caregiver-pat-words')).toHaveTextContent('Can see your medical papers, Only me ones included.', { exact: false });
    expect(t.vault.state.caregivers?.[0]).toMatchObject({ person: 'fake-member', caregiver: 'pat', confirmed: true });

    // Revoke asks first; Cancel changes nothing.
    await fireEvent.press(screen.getByTestId('caregiver-end-pat'));
    expect(await screen.findByTestId('caregivers-end-question')).toHaveTextContent('Stop Pat seeing your medical papers?', { exact: false });
    await fireEvent.press(screen.getByTestId('caregivers-end-cancel'));
    expect(t.vault.state.caregivers?.[0]?.revoked).toBe(false);
    await fireEvent.press(screen.getByTestId('caregiver-end-pat'));
    await fireEvent.press(await screen.findByTestId('caregivers-end-yes'));
    await waitFor(() => expect(screen.getByTestId('caregivers-said')).toHaveTextContent('Pat no longer sees your medical papers.', { exact: false }));
    expect(t.vault.state.caregivers?.[0]?.revoked).toBe(true);
    expect(screen.getByTestId('caregivers-none')).toBeTruthy();
    expect(audit()).toEqual([]);
  });

  it('one an owner named: Keep includes my Only me papers; and who looked, by name and paper', async () => {
    const t = vault({ role: 'adult' });
    grant(t, 'fake-member', 'sam', { confirmed: false, by: 'pat' });
    libraryDoc(t, { id: 'letter', title: 'Clinic letter' });
    // Not sensitive by its kind, so the person is told its title.
    t.vault.state.documents.push({ id: 'letter', title: 'Clinic letter', type_key: 'utility_bill', tags: [], extra: {} } as never);
    t.vault.state.caregiverLooks = [
      { person: 'fake-member', caregiver: 'sam', document_id: 'letter', action: 'opened', at: '2026-11-14T10:00:00Z' },
    ];
    push('/caregivers');
    await unlocked(t, <Text>More</Text>);
    expect(await screen.findByTestId('caregiver-sam-words')).toHaveTextContent('Named by Pat. They see what the family sees until you keep them', { exact: false });
    expect(await screen.findByTestId('caregivers-look-0')).toHaveTextContent('Sam opened Clinic letter', { exact: false });
    // Keeping it reaches the Only me papers: asked first, and Cancel keeps nothing.
    await fireEvent.press(screen.getByTestId('caregiver-keep-sam'));
    expect(await screen.findByTestId('caregivers-keep-question')).toHaveTextContent(
      'Let Sam see your Only me medical papers too?',
      { exact: false },
    );
    await fireEvent.press(screen.getByTestId('caregivers-keep-cancel'));
    expect(t.vault.state.caregivers?.[0]?.confirmed).toBe(false);
    // Revoking it before it is kept never speaks of the Only me papers, which it never reached.
    await fireEvent.press(screen.getByTestId('caregiver-end-sam'));
    expect(await screen.findByTestId('caregivers-end-question')).toHaveTextContent(
      'Sam won’t see your medical papers as a caregiver any more, from now.',
      { exact: false },
    );
    await fireEvent.press(screen.getByTestId('caregivers-end-cancel'));
    await fireEvent.press(screen.getByTestId('caregiver-keep-sam'));
    await fireEvent.press(await screen.findByTestId('caregivers-keep-yes'));
    await waitFor(() => expect(t.vault.state.caregivers?.[0]?.confirmed).toBe(true));
    expect(await screen.findByTestId('caregivers-said')).toHaveTextContent('Sam can now see your medical papers, Only me ones included.', { exact: false });
    expect(t.vault.state.caregivers?.[0]?.confirmed).toBe(true);
    // The paper looked at opens from its line.
    await fireEvent.press(screen.getByTestId('caregivers-look-0'));
    expect(routes().at(-1)).toEqual({ pathname: '/document/[id]', params: { id: 'letter' } });
  });

  it("whose papers I see as a caregiver: opened from here, and given up only once asked", async () => {
    const t = vault();
    grant(t, 'pat', 'fake-member');
    push('/caregivers');
    await unlocked(t, <Text>More</Text>);
    expect(await screen.findByTestId('caring-for-pat')).toHaveTextContent('Their medical papers, Only me ones included. You can read them, not change or share them.', { exact: false });
    await fireEvent.press(screen.getByTestId('caring-for-end-pat'));
    expect(await screen.findByTestId('caring-for-end-question')).toHaveTextContent('Stop seeing Pat’s medical papers?', { exact: false });
    await fireEvent.press(screen.getByTestId('caring-for-end-yes'));
    expect(await screen.findByTestId('caregivers-for-others-said')).toHaveTextContent('You no longer see Pat’s medical papers.', { exact: false });
    expect(t.vault.state.caregivers?.[0]?.revoked).toBe(true);
    expect(screen.queryByTestId('caring-for-pat')).toBeNull();
  });

  it("an owner names one for Sara, who has no sign-in, on her page — and sees who looked, never which paper", async () => {
    const t = vault();
    t.vault.state.caregiverLooks = [
      { person: 'sara', caregiver: 'pat', document_id: 'x', action: 'downloaded', at: '2026-11-14T10:00:00Z' },
    ];
    push('/caregivers');
    await unlocked(t, <Text>More</Text>);
    await fireEvent.press(await screen.findByTestId('caregivers-family-sara'));
    expect(routes().at(-1)).toEqual({ pathname: '/person/[id]', params: { id: 'sara', name: 'Sara' } });
    expect(await screen.findByTestId('caregivers-look-0')).toHaveTextContent('Pat saved a copy of one of their Only me papers', { exact: false });
    await fireEvent.press(await screen.findByTestId('caregivers-choose'));
    await fireEvent.press(await screen.findByTestId('caregivers-person-sam'));
    await fireEvent.press(await screen.findByTestId('caregivers-name'));
    expect(await screen.findByTestId('caregivers-said')).toHaveTextContent('Sam can now see Sara’s medical papers that the family sees.', { exact: false });
    expect(screen.getByTestId('caregiver-sam-words')).toHaveTextContent('Named by Fake Owner. Sara can keep this once they have their own sign-in.', { exact: false });
    expect(t.vault.state.caregivers?.[0]).toMatchObject({ person: 'sara', caregiver: 'sam', confirmed: false });
  });

  it("nothing on somebody's page the vault does not let the person see", async () => {
    const t = vault({ role: 'adult' });
    push({ pathname: '/person/[id]', params: { id: 'pat', name: 'Pat' } });
    await unlocked(t, <Text>People</Text>);
    await screen.findByTestId('person');
    await waitFor(() => expect(t.calls.some((c) => c.endsWith('/api/v1/members/pat/caregivers'))).toBe(true));
    expect(screen.queryByTestId('caregivers-pat')).toBeNull();
  });

  it('none on a viewer’s own page: a viewer names no caregiver', async () => {
    const t = vault({ role: 'viewer' });
    push({ pathname: '/person/[id]', params: { id: 'fake-member', name: 'Fake Owner' } });
    await unlocked(t, <Text>People</Text>);
    await screen.findByTestId('person');
    expect(screen.queryByTestId('caregivers-fake-member')).toBeNull();
    expect(t.calls.some((c) => c.includes('/caregivers'))).toBe(false);
  });

  it('an owner who is Sara’s caregiver themselves: Stop seeing them, on the button and in the question', async () => {
    const t = vault();
    grant(t, 'sara', 'fake-member', { confirmed: false, by: 'fake-member' });
    push({ pathname: '/person/[id]', params: { id: 'sara', name: 'Sara' } });
    await unlocked(t, <Text>People</Text>);
    expect(await screen.findByTestId('caregiver-end-fake-member')).toHaveTextContent('Stop seeing them');
    await fireEvent.press(screen.getByTestId('caregiver-end-fake-member'));
    expect(await screen.findByTestId('caregivers-end-question')).toHaveTextContent(
      'Stop seeing Sara’s medical papers?',
      { exact: false },
    );
    expect(screen.getByTestId('caregivers-end-yes')).toHaveTextContent('Stop seeing them');
  });

  it('opened by a link on a vault without caregivers: said plainly, nothing asked', async () => {
    const t = vault({ caregivers: false });
    push('/caregivers');
    await unlocked(t, <Text>More</Text>);
    expect(await screen.findByTestId('caregivers-not-here')).toHaveTextContent('Your vault doesn’t have this yet', {
      exact: false,
    });
    expect(t.calls.some((c) => c.includes('/api/v1/caregivers'))).toBe(false);
  });
});

describe('turning 18 on Home (H1b)', () => {
  /** A Medical kind, so making them Only me has papers to make. */
  function medical(t: TestVault) {
    t.vault.state.types.push({ ...t.vault.state.types[0], key: 'medical_record', label: 'Medical record', category: 'medical' } as never);
    t.vault.state.documents.push(
      { id: 'm1', title: 'Scan', type_key: 'medical_record', owner_member_id: 'fake-member', tags: [], extra: {} } as never,
      { id: 'm2', title: 'Letter', type_key: 'medical_record', owner_member_id: 'fake-member', tags: [], extra: {} } as never,
    );
  }

  it('asked once: Keep them visible changes nothing, and the card goes', async () => {
    const t = vault({ role: 'adult' });
    t.vault.state.grownUp = [{ member_id: 'fake-member', turned_on: '2026-11-10', papers: 2, answer: null }];
    await unlocked(t, <Home />);
    expect(await screen.findByTestId('grown-up-fake-member')).toHaveTextContent('Keep your medical papers visible to the family, or make them Only me?', { exact: false });
    await fireEvent.press(screen.getByTestId('grown-up-keep-fake-member'));
    expect(await screen.findByTestId('grown-up-said')).toHaveTextContent('Your medical papers stay visible to the family.', { exact: false });
    expect(t.vault.state.grownUp?.[0]?.answer).toBe('keep');
    expect(screen.queryByTestId('grown-up-fake-member')).toBeNull();
  });

  it('Make them Only me asks first, saying plainly what changes; Cancel changes nothing', async () => {
    const t = vault({ role: 'adult' });
    medical(t);
    t.vault.state.grownUp = [{ member_id: 'fake-member', turned_on: '2026-11-10', papers: 2, answer: null }];
    await unlocked(t, <Home />);
    await fireEvent.press(await screen.findByTestId('grown-up-only-me-fake-member'));
    const asked = await screen.findByTestId('grown-up-only-me-question');
    expect(asked).toHaveTextContent('Make your medical papers Only me?', { exact: false });
    expect(asked).toHaveTextContent(/Your 2 medical papers become Only me\. Nobody else in the family can open them/);
    await fireEvent.press(screen.getByTestId('grown-up-only-me-cancel'));
    expect(t.vault.state.grownUp?.[0]?.answer).toBeNull();
    await fireEvent.press(screen.getByTestId('grown-up-only-me-fake-member'));
    await fireEvent.press(await screen.findByTestId('grown-up-only-me-yes'));
    expect(await screen.findByTestId('grown-up-said')).toHaveTextContent('Done. Your 2 medical papers are Only me now.', { exact: false });
    expect(t.vault.state.grownUp?.[0]?.answer).toBe('only_me');
    expect(audit()).toEqual([]);
  });

  it("an owner's cards: ask Sara in person and keep them, or change Kim's role first in the browser", async () => {
    const t = vault();
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    t.vault.state.grownUp = [
      { member_id: 'sara', turned_on: '2026-11-14', papers: 1, answer: null },
      { member_id: 'kim', turned_on: '2026-11-01', papers: 3, answer: null },
    ];
    await unlocked(t, <Home />);
    expect(await screen.findByTestId('grown-up-sara')).toHaveTextContent(/^Sara (is 18 today|turned 18 on)/);
    expect(screen.getByTestId('grown-up-sara')).toHaveTextContent(/Ask them in person/);
    // Only Keep, for somebody else: never Only me.
    expect(screen.queryByTestId('grown-up-only-me-sara')).toBeNull();
    expect(screen.getByTestId('grown-up-kim')).toHaveTextContent('Kim is 18 or over and still signs in as a teen', { exact: false });
    expect(screen.queryByTestId('grown-up-keep-kim')).toBeNull();
    await fireEvent.press(screen.getByTestId('grown-up-role-kim'));
    expect(open).toHaveBeenCalledWith(`${ORIGIN}/people/kim`);
    await fireEvent.press(screen.getByTestId('grown-up-caregiver-sara'));
    expect(routes().at(-1)).toEqual({ pathname: '/person/[id]', params: { id: 'sara', name: 'Sara' } });
    // Back on Home, which asks again.
    await act(async () => back());
    // Final, and said so where it is seen.
    expect(await screen.findByTestId('grown-up-final-sara')).toHaveTextContent('This answer can’t be changed later', {
      exact: false,
    });
    await fireEvent.press(await screen.findByTestId('grown-up-keep-sara'));
    expect(await screen.findByTestId('grown-up-said')).toHaveTextContent('Sara’s medical papers stay visible to the family.', { exact: false });
    expect(t.vault.state.grownUp?.[0]?.answer).toBe('keep');
  });

  it('nothing on an older vault', async () => {
    const t = vault({ caregivers: false });
    t.vault.state.grownUp = [{ member_id: 'sara', turned_on: '2026-11-14', papers: 1, answer: null }];
    await unlocked(t, <Home />);
    await screen.findByTestId('home-ready');
    expect(screen.queryByTestId('home-grown-up')).toBeNull();
    expect(t.calls.some((c) => c.includes('/grown-up/'))).toBe(false);
  });
});
