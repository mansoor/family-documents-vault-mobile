import type { DocumentView } from '@fdv/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { DocumentDetail } from '../documents/detail';
import { SecureTokenStore } from '../session/store';
import { audit } from '../test-support/a11y';
import { libraryDoc, unlocked } from '../test-support/lookup';
import { installed } from '../test-support/render';
import { push, resetRoutes, routes } from '../test-support/router';
import { capabilities, nextEtag, testVault, type TestVault } from '../test-support/vault';

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

/** A vault with kinds' own details and collections; `versions`, one of 0.9.0 that keeps each version's. */
function vault(versions = false): { t: TestVault; edits: Record<string, unknown>[] } {
  const t = testVault([ORIGIN]);
  t.caps = capabilities({
    features: { ...capabilities().features, custom_types: true, collections: true, version_details: versions },
  });
  // Each PATCH to a document, as the phone sent it.
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
    ...over,
  });
}

async function openEdit() {
  await fireEvent.press(await screen.findByTestId('document-edit'));
  await waitFor(() => expect(routes().at(-1)).toEqual({ pathname: '/edit/[id]', params: { id: 'passport' } }));
  return screen.findByTestId('edit-name');
}

describe('Edit details (P8)', () => {
  it("the card filled from the document; a field emptied is sent as null, and the page shows what's saved", async () => {
    const { t, edits } = vault();
    passport(t);
    await unlocked(t, <DocumentDetail id="passport" />);
    const name = await openEdit();
    expect(name.props.value).toBe('Passport');
    expect(screen.getByTestId('edit-number').props.value).toBe('123456789');
    expect(screen.getByTestId('edit-expires').props.value).toBe('14 Mar 2031');

    await fireEvent.changeText(name, "Sam's passport");
    await fireEvent.changeText(screen.getByTestId('edit-location'), '');
    await fireEvent.changeText(screen.getByTestId('edit-expires'), '14 Mar 2032');
    // Every control says what it is and is big enough to press.
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByTestId('edit-save'));

    await waitFor(() => expect(routes()).toEqual([]));
    // The whole card, never who can see it or Essential, and no confirmation an older vault would refuse.
    expect(edits).toEqual([
      {
        type_key: 'passport',
        owner_member_id: 'fake-member',
        title: "Sam's passport",
        issued_by: 'United Kingdom',
        identifier: '123456789',
        issued: { date: '2021-03-14', precision: 'day' },
        expires: { date: '2032-03-14', precision: 'day' },
        physical_location: null,
      },
    ]);
    expect(await screen.findByText("Sam's passport")).toBeTruthy();
    expect(t.library.documents.get('passport')?.physical_location).toBeNull();
  });

  it("a vault that keeps each version's details is told they're now confirmed", async () => {
    const { t, edits } = vault(true);
    passport(t, { details_unconfirmed: true });
    await unlocked(t, <DocumentDetail id="passport" />);
    await openEdit();
    await fireEvent.press(screen.getByTestId('edit-save'));
    await waitFor(() => expect(edits).toHaveLength(1));
    expect(edits[0]).toEqual(expect.objectContaining({ confirm_details: true }));
  });

  it('what the kind needs is asked for first, in its own words, and nothing is sent', async () => {
    const { t, edits } = vault();
    passport(t);
    await unlocked(t, <DocumentDetail id="passport" />);
    await openEdit();
    await fireEvent.changeText(screen.getByTestId('edit-number'), '');
    await fireEvent.press(screen.getByTestId('edit-save'));
    expect(await screen.findByTestId('edit-problem')).toHaveTextContent('Still needed: Passport number.');
    expect(edits).toEqual([]);
    expect(routes().at(-1)?.pathname).toBe('/edit/[id]');
  });

  it("a kind's own details: each sent, an emptied one as null", async () => {
    const { t, edits } = vault();
    libraryDoc(t, {
      id: 'passport',
      title: 'March statement',
      type_key: 'bank_statement',
      issued_by: 'Bank',
      extra: { account_last4: '1234', period: 'March' },
    });
    await unlocked(t, <DocumentDetail id="passport" />);
    await openEdit();
    expect(screen.getByTestId('edit-detail-account_last4').props.value).toBe('1234');
    // A bank statement has no expiry: not asked, not sent.
    expect(screen.queryByTestId('edit-expires')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('edit-detail-period'), '');
    await fireEvent.press(screen.getByTestId('edit-save'));
    await waitFor(() => expect(edits).toHaveLength(1));
    expect(edits[0]?.extra).toEqual({ account_last4: '1234', period: null });
    expect(edits[0]).not.toHaveProperty('expires');
  });

  it("changed somewhere else meanwhile: nothing is overwritten, it says so, and shows what's there now", async () => {
    const { t } = vault();
    passport(t);
    await unlocked(t, <DocumentDetail id="passport" />);
    const name = await openEdit();
    // Somebody else, in the browser.
    const now = t.library.documents.get('passport') as DocumentView;
    t.library.documents.set('passport', { ...now, title: 'Passport (renewed)', etag: nextEtag() });
    await fireEvent.changeText(name, 'Mine');
    await fireEvent.press(screen.getByTestId('edit-save'));
    expect(await screen.findByTestId('edit-problem')).toHaveTextContent(/^Someone changed this document/);
    await waitFor(() => expect(screen.getByTestId('edit-name').props.value).toBe('Passport (renewed)'));
    expect(t.library.documents.get('passport')?.title).toBe('Passport (renewed)');
  });

  it('a viewer has nothing to change: no Edit details, no choice of who can see it, no Trash', async () => {
    const { t } = vault();
    passport(t);
    await unlocked(t, <DocumentDetail id="passport" />, { before: withRole('viewer') });
    expect(await screen.findByTestId('document-visibility')).toHaveTextContent('Everyone in the family');
    expect(screen.queryByText('Change')).toBeNull();
    expect(screen.queryByTestId('document-edit')).toBeNull();
    expect(screen.queryByTestId('document-trash')).toBeNull();
  });
});

describe('Who can see it (P8)', () => {
  it('chosen from the sheet, sent, and said', async () => {
    const { t } = vault();
    passport(t);
    await unlocked(t, <DocumentDetail id="passport" />);
    await fireEvent.press(await screen.findByTestId('document-visibility'));
    expect(await screen.findByTestId('visibility-household')).toBeTruthy();
    expect(screen.getByTestId('visibility-household').props.accessibilityState).toEqual(
      expect.objectContaining({ checked: true }),
    );
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByTestId('visibility-adults'));
    expect(await screen.findByTestId('visibility-said')).toHaveTextContent('Now: Adults only.');
    expect(t.library.visibilityChanges).toEqual([{ id: 'passport', visibility: 'adults' }]);
    await waitFor(() => expect(screen.getByTestId('document-visibility')).toHaveTextContent(/Adults only/));
  });

  it("into Only me with share links of one's own: asked what becomes of them, and Keep sent", async () => {
    const { t } = vault();
    passport(t);
    t.library.ownLinks.set('passport', { links: 2, keep: true });
    await unlocked(t, <DocumentDetail id="passport" />);
    await fireEvent.press(await screen.findByTestId('document-visibility'));
    await fireEvent.press(await screen.findByTestId('visibility-private'));
    expect(await screen.findByTestId('visibility-links')).toHaveTextContent(/^You have 2 share links/);
    expect(t.library.visibilityChanges).toEqual([]);
    await fireEvent.press(screen.getByTestId('visibility-links-keep'));
    await screen.findByTestId('visibility-said');
    expect(t.library.visibilityChanges).toEqual([{ id: 'passport', visibility: 'private', own_links: 'keep' }]);
  });

  it("a household that doesn't let Only me out: only End, and the vault's words after", async () => {
    const { t } = vault();
    passport(t);
    t.library.ownLinks.set('passport', { links: 1, keep: false });
    await unlocked(t, <DocumentDetail id="passport" />);
    await fireEvent.press(await screen.findByTestId('document-visibility'));
    await fireEvent.press(await screen.findByTestId('visibility-private'));
    expect(await screen.findByTestId('visibility-links')).toHaveTextContent(/^You have a share link/);
    expect(screen.queryByTestId('visibility-links-keep')).toBeNull();
    await fireEvent.press(screen.getByTestId('visibility-links-end'));
    expect(await screen.findByTestId('visibility-said')).toHaveTextContent('Your share links to it have ended.');
    expect(t.library.visibilityChanges).toEqual([{ id: 'passport', visibility: 'private', own_links: 'end' }]);
  });
});

describe('Move to the Trash (P8)', () => {
  it('asks first; Cancel keeps it; yes moves it and leaves the page', async () => {
    const { t } = vault();
    passport(t);
    push({ pathname: '/document/[id]', params: { id: 'passport' } });
    await unlocked(t, <Text>Documents</Text>);
    await fireEvent.press(await screen.findByTestId('document-trash'));
    expect(await screen.findByText('Move to the Trash?')).toBeTruthy();
    expect(screen.getByText(/^“Passport” leaves every list/)).toBeTruthy();
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByTestId('trash-cancel'));
    expect(t.library.trashed).toEqual([]);

    await fireEvent.press(screen.getByTestId('document-trash'));
    await fireEvent.press(await screen.findByTestId('trash-yes'));
    await waitFor(() => expect(routes()).toEqual([]));
    expect(t.library.trashed).toEqual(['passport']);
    expect(await screen.findByText('Documents')).toBeTruthy();
  });

  it("a teen moves only their own", async () => {
    const { t } = vault();
    passport(t, { owner_member_id: 'mum' });
    await unlocked(t, <DocumentDetail id="passport" />, { before: withRole('teen') });
    expect(await screen.findByText('Passport')).toBeTruthy();
    expect(screen.queryByTestId('document-trash')).toBeNull();
  });
});

describe('tags and collections (P8)', () => {
  it('are shown on the page', async () => {
    const { t } = vault();
    passport(t, { tags: ['travel', 'renew soon'] });
    t.library.collections.set('passport', [
      { id: 'c1', name: 'Holiday' },
      { id: 'c2', name: 'For the solicitor' },
    ]);
    await unlocked(t, <DocumentDetail id="passport" />);
    expect(await screen.findByTestId('document-tags')).toHaveTextContent('Tagstravelrenew soon');
    expect(await screen.findByTestId('document-collections')).toHaveTextContent(
      'In collectionsHoliday, For the solicitor',
    );
  });

  it('none, nothing said', async () => {
    const { t } = vault();
    passport(t);
    await unlocked(t, <DocumentDetail id="passport" />);
    await screen.findByTestId('document-edit');
    expect(screen.queryByTestId('document-tags')).toBeNull();
    expect(screen.queryByTestId('document-collections')).toBeNull();
  });
});
