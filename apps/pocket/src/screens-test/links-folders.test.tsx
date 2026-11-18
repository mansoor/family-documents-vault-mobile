import type { Share } from '@fdv/shared';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import DocumentsScreen from '../app/(tabs)/documents';
import { DocumentDetail } from '../documents/detail';
import { listQuery, NO_FILTERS } from '../documents/filter-model';
import { EmergencyPage } from '../emergency/page';
import { audit } from '../test-support/a11y';
import { libraryDoc, unlocked } from '../test-support/lookup';
import { installed } from '../test-support/render';
import { push, resetRoutes, routes } from '../test-support/router';
import { caps0519, capabilities, json, testVault, type TestVault } from '../test-support/vault';

jest.mock(
  'expo-router',
  () => jest.requireActual<typeof import('../test-support/router')>('../test-support/router').routerMock,
);

/**
 * Changing any link, and the papers from a folder (app 0.18.0): a
 * document's own links on its page, each with Change and End, as the web's
 * Share a link lists them; Change on a clinician's link on the emergency
 * page, which stays to view; and a paper's "Came from the folder" opening
 * Documents narrowed to that folder, said as a chip.
 */

const ORIGIN = 'https://vault.test';

beforeEach(() => {
  installed();
  resetRoutes();
});

/** A vault of 0.9.0-dev.65 (`older`: before links were changed, LK). */
function vault(over: { older?: boolean; features?: Record<string, boolean> } = {}): TestVault {
  const t = testVault([ORIGIN]);
  t.caps = capabilities({
    server_version: over.older ? '0.9.0-dev.48' : '0.9.0-dev.65',
    features: {
      ...caps0519().features,
      share_options: true,
      share_second_factor: true,
      share_reveal: true,
      sensitive_protects: true,
      emergency_info: true,
      ...(over.older ? {} : { link_changes: true }),
      ...over.features,
    },
  });
  return t;
}

/** A link to a document, as GET /shares lists it. */
function link(over: Partial<Share> & { id: string }): Share {
  return {
    document_id: 'passport',
    document_title: 'Passport',
    collection_id: null,
    recipient_label: 'Dr Patel',
    created_by_name: 'Fake Owner',
    created_at: '2026-11-10T10:00:00Z',
    expires_at: '2030-11-17T17:00:00Z',
    has_pin: true,
    protection: ['pin'],
    open_count: 0,
    last_opened_at: null,
    state: 'active',
    permission: 'view',
    max_opens: null,
    summary: 'A link',
    changeable: true,
    mine: true,
    latest_end: '2031-01-01T00:00:00Z',
    version: 3,
    ...over,
  } as Share;
}

describe('a document’s own links, on its page', () => {
  it('each that works, newest first, with Change (saved with its version, then said) and End, asked first', async () => {
    const t = vault();
    libraryDoc(t, { id: 'passport', title: 'Passport' });
    t.library.shares.push(
      link({ id: 'old', created_at: '2026-11-01T10:00:00Z', recipient_label: 'The bank' }),
      link({ id: 'new', created_at: '2026-11-12T10:00:00Z' }),
      link({ id: 'gone', state: 'revoked' }),
      link({ id: 'elsewhere', document_id: 'deeds', document_title: 'Deeds' }),
    );
    await unlocked(t, <DocumentDetail id="passport" />);
    const card = await screen.findByTestId('document-links');
    expect(card).toHaveTextContent(/^Its links outside the familyThe links to it that work now/);
    const rows = screen.getAllByTestId(/^document-link-(old|new|gone|elsewhere)$/).map((r) => r.props.testID);
    expect(rows).toEqual(['document-link-new', 'document-link-old']);
    expect(screen.getByTestId('document-link-new')).toHaveTextContent(/^For Dr PatelStops /);
    expect(screen.getByTestId('document-link-change-new').props.accessibilityLabel).toBe('Change the link: For Dr Patel');
    expect(audit()).toEqual([]);

    await fireEvent.press(screen.getByTestId('document-link-change-new'));
    expect(await screen.findByTestId('change-link-what')).toHaveTextContent('Passport');
    await fireEvent.changeText(screen.getByTestId('change-link-label'), 'Dr Rao');
    await fireEvent.press(screen.getByTestId('change-link-save'));
    expect(await screen.findByTestId('document-links-said')).toHaveTextContent('The link to “Passport” is changed.');
    expect(t.library.shareChanges).toEqual([{ id: 'new', body: { recipient_label: 'Dr Rao' }, ifMatch: '"3"' }]);
    expect(await screen.findByTestId('document-link-new')).toHaveTextContent(/^For Dr Rao/);

    await fireEvent.press(screen.getByTestId('document-link-end-old'));
    expect(await screen.findByTestId('document-link-end-question')).toHaveTextContent(/The link to “Passport” stops working at once/);
    await fireEvent.press(screen.getByTestId('document-link-end-cancel'));
    expect(t.library.shares.find((s) => s.id === 'old')?.state).toBe('active');
    await fireEvent.press(screen.getByTestId('document-link-end-old'));
    await fireEvent.press(await screen.findByTestId('document-link-end-yes'));
    expect(await screen.findByTestId('document-links-said')).toHaveTextContent('The link to “Passport” is ended.');
    expect(screen.queryByTestId('document-link-old')).toBeNull();
    expect(t.library.shares.find((s) => s.id === 'old')?.state).toBe('revoked');
  });

  it('on one’s own sensitive paper, somebody else’s links are listed once, apart, never twice', async () => {
    const t = vault({ features: { share_opens: true, sensitive_documents: true } });
    libraryDoc(t, { id: 'lab', title: 'Blood test', type_key: 'lab_result', sensitive_effective: true } as never);
    t.library.shares.push(
      link({ id: 'mine', document_id: 'lab', document_title: 'Blood test' }),
      link({ id: 'pats', document_id: 'lab', document_title: 'Blood test', mine: false, created_by_name: 'Pat' }),
    );
    await unlocked(t, <DocumentDetail id="lab" />);
    await screen.findByTestId('document-link-mine');
    expect(screen.queryByTestId('document-link-pats')).toBeNull();
  });

  it('one the person may not change has End only; none on a vault before LK, nor for a viewer', async () => {
    const t = vault();
    libraryDoc(t, { id: 'passport', title: 'Passport' });
    t.library.shares.push(link({ id: 'theirs', changeable: false, mine: false, created_by_name: 'Pat' }));
    await unlocked(t, <DocumentDetail id="passport" />);
    expect(await screen.findByTestId('document-link-theirs')).toHaveTextContent(/Shared by Pat/);
    expect(screen.queryByTestId('document-link-change-theirs')).toBeNull();
    expect(screen.getByTestId('document-link-end-theirs')).toBeTruthy();

    const older = vault({ older: true });
    libraryDoc(older, { id: 'passport', title: 'Passport' });
    older.library.shares.push(link({ id: 'l' }));
    await unlocked(older, <DocumentDetail id="passport" />);
    await screen.findByTestId('document-visibility');
    expect(screen.queryByTestId('document-links')).toBeNull();
  });
});

describe('a clinician’s link, changed on the emergency page', () => {
  /** The person's emergency information and one link to it, as the client's fake keeps them. */
  function emergency(t: TestVault) {
    (t.vault.state.emergency ??= []).push({
      member: 'fake-member',
      fields: { blood_type: 'O+', allergies: [{ id: 'a1', name: 'Penicillin', note: null }] },
      audience: 'adults',
      chosen: [],
      version: 1,
      updated_at: '2026-11-15T10:00:00Z',
    } as never);
    (t.vault.state.emergencyLinks ??= []).push({
      id: 'l1',
      member: 'fake-member',
      fields: ['allergies'],
      token: 'tok',
      pin: '1234',
      recipient_label: 'A&E',
      created_by: 'fake-member',
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      revoked: false,
      openings: [],
    } as never);
    // Test shim: the client's fake lists a clinician's links without LK's fields; the vault of
    // dev.49 on says it may be changed, and its version. PATCH /shares/{id} is the test library's.
    const plain = t.fetch;
    t.fetch = async (url, init) => {
      const res = await plain(url, init);
      if (init.method !== 'GET' || !url.endsWith('/api/v1/members/fake-member/emergency/links') || !res.ok) return res;
      const body = (await res.json()) as { items: Share[] };
      return json({
        // A clinician's link may last 24 hours at most from when it was made.
        items: body.items.map((l) => ({
          ...l,
          changeable: true,
          mine: true,
          version: 2,
          latest_end: new Date(Date.parse(l.created_at) + 24 * 3_600_000).toISOString(),
        })),
      });
    };
    t.library.shares.push(link({ id: 'l1', document_id: null, document_title: null, recipient_label: 'A&E', version: 2 }));
  }

  it('Change on a link that works: to view, always; saved with its version, then said', async () => {
    const t = vault();
    emergency(t);
    await unlocked(t, <EmergencyPage id="fake-member" name="Fake Owner" />);
    const change = await screen.findByTestId('emergency-change-l1');
    expect(change.props.accessibilityLabel).toBe('Change the link for A&E');
    expect(audit()).toEqual([]);
    await fireEvent.press(change);
    expect(await screen.findByTestId('change-link-what')).toHaveTextContent('your emergency information');
    expect(screen.getByTestId('change-link')).toHaveTextContent(/It stays the same link, to the same page\./);
    expect(screen.getByTestId('change-link-view-only')).toHaveTextContent('They see the parts of the page you ticked. It is to view, always.');
    expect(screen.queryByTestId('change-link-permission-download')).toBeNull();
    expect(screen.queryByTestId('change-link-show-title')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('change-link-label'), 'Dr Okafor');
    await fireEvent.press(screen.getByTestId('change-link-save'));
    expect(await screen.findByTestId('emergency-said')).toHaveTextContent('The link to “your emergency information” is changed.');
    expect(t.library.shareChanges).toEqual([{ id: 'l1', body: { recipient_label: 'Dr Okafor' }, ifMatch: '"2"' }]);
  });

  it('none on a vault before LK: Take back stays', async () => {
    const t = vault({ older: true });
    emergency(t);
    await unlocked(t, <EmergencyPage id="fake-member" name="Fake Owner" />);
    await screen.findByTestId('emergency-take-back-l1');
    expect(screen.queryByTestId('emergency-change-l1')).toBeNull();
  });
});

describe('the papers from a folder (C4)', () => {
  it('asked with a column sort: Recent is the newest by the date it is about', () => {
    const f = { ...NO_FILTERS, folder: 'Taxes/2025' };
    expect(listQuery(f, { sort: 'recent', table: true, several: true })).toEqual({
      sort: 'dated',
      direction: 'desc',
      source_folder: 'Taxes/2025',
    });
    expect(listQuery(f, { sort: 'title', table: true, several: true })).toEqual({
      sort: 'title',
      direction: 'asc',
      source_folder: 'Taxes/2025',
    });
    // Never to a vault without the table, which would refuse it.
    expect(listQuery(f, { sort: 'recent', table: false, several: true })).toEqual({ sort: 'recent' });
  });

  it('“Came from the folder” opens Documents with them, said as a chip whose ✕ shows everything', async () => {
    const t = vault({ features: { source_folders: true, document_table: true } });
    libraryDoc(t, { id: 'p60', title: 'P60', type_key: 'p60', source_folder: 'Taxes/2025' } as never);
    await unlocked(t, <DocumentDetail id="p60" />);
    const open = await screen.findByTestId('document-source-folder-open');
    expect(open.props.accessibilityLabel).toBe('Papers from the folder Taxes/2025');
    expect(open).toHaveTextContent('Taxes/2025 ›');
    expect(audit()).toEqual([]);
    await fireEvent.press(open);
    expect(routes().at(-1)).toEqual({ pathname: '/documents', params: { folder: 'Taxes/2025' } });
  });

  it('Documents, opened for a folder: only its papers, a chip, and the search says it looks everywhere', async () => {
    const t = vault({ features: { source_folders: true, document_table: true } });
    t.vault.state.documents.push(
      { id: 'p60', title: 'P60', type_key: 'other', source_folder: 'Taxes/2025', created_at: '2026-04-06T10:00:00Z' } as never,
      { id: 'p45', title: 'P45', type_key: 'other', source_folder: 'taxes/2025', created_at: '2026-05-06T10:00:00Z' } as never,
      { id: 'lease', title: 'Lease', type_key: 'other', source_folder: 'Home', created_at: '2026-06-06T10:00:00Z' } as never,
    );
    push({ pathname: '/documents', params: { folder: 'Taxes/2025' } });
    await unlocked(t, <DocumentsScreen />);
    const chip = await screen.findByTestId('documents-chip-folder');
    expect(chip).toHaveTextContent('From the folder ‘Taxes/2025’');
    expect(chip.props.accessibilityLabel).toMatch(/From the folder ‘Taxes\/2025’/);
    await waitFor(() =>
      expect(screen.getAllByTestId(/^doc-row-/).map((r) => r.props.testID).sort()).toEqual(['doc-row-p45', 'doc-row-p60']),
    );
    const listed = t.calls
      .filter((c) => c.startsWith(`GET ${ORIGIN}/api/v1/documents?`))
      .map((c) => Object.fromEntries(new URL(c.slice(4)).searchParams))
      .filter((q) => q.source_folder);
    expect(listed.at(-1)).toEqual(expect.objectContaining({ sort: 'dated', direction: 'desc', source_folder: 'Taxes/2025' }));
    expect(audit()).toEqual([]);

    await fireEvent.press(screen.getByTestId('documents-search'));
    await fireEvent.changeText(await screen.findByTestId('search-field'), 'P6');
    expect(await screen.findByTestId('search-not-folder')).toHaveTextContent(
      'The search looks through every document, not only those from ‘Taxes/2025’.',
    );
    await fireEvent.press(screen.getByTestId('documents-search'));

    await fireEvent.press(screen.getByTestId('documents-chip-folder'));
    await waitFor(() => expect(screen.getAllByTestId(/^doc-row-/)).toHaveLength(3));
    expect(screen.queryByTestId('documents-chip-folder')).toBeNull();
  });

  it('taken once: the chip cleared stays cleared after the Cabinet and back; the same folder asked again comes back', async () => {
    const t = vault({ features: { source_folders: true, document_table: true, cabinets: true } });
    t.vault.state.documents.push(
      { id: 'p60', title: 'P60', type_key: 'other', source_folder: 'Taxes/2025' } as never,
      { id: 'lease', title: 'Lease', type_key: 'other', source_folder: 'Home' } as never,
    );
    push({ pathname: '/documents', params: { folder: 'Taxes/2025' } });
    await unlocked(t, <DocumentsScreen />);
    await screen.findByTestId('documents-chip-folder');
    // Taken off the address once applied.
    expect(routes().at(-1)).toEqual({ pathname: '/documents', params: {} });
    expect(screen.getByTestId('documents-sort')).toHaveTextContent('Newest first by the paper’s date');
    await fireEvent.press(screen.getByTestId('documents-chip-folder'));
    await waitFor(() => expect(screen.getAllByTestId(/^doc-row-/)).toHaveLength(2));
    expect(screen.getByTestId('documents-sort')).toHaveTextContent('Recently added');
    await fireEvent.press(screen.getByTestId('documents-view-cabinet'));
    await fireEvent.press(await screen.findByTestId('documents-view-list'));
    await waitFor(() => expect(screen.getAllByTestId(/^doc-row-/)).toHaveLength(2));
    expect(screen.queryByTestId('documents-chip-folder')).toBeNull();
    // From the paper again: the same folder, asked anew.
    await act(async () => push({ pathname: '/documents', params: { folder: 'Taxes/2025' } }));
    expect(await screen.findByTestId('documents-chip-folder')).toHaveTextContent('From the folder ‘Taxes/2025’');
    await waitFor(() => expect(screen.getAllByTestId(/^doc-row-/).map((r) => r.props.testID)).toEqual(['doc-row-p60']));
  });

  it('a vault without the papers’ folders: no link, and Documents is as before', async () => {
    const t = vault({ features: { document_table: true } });
    libraryDoc(t, { id: 'p60', title: 'P60', type_key: 'p60', source_folder: 'Taxes/2025' } as never);
    t.vault.state.documents.push({ id: 'p60', title: 'P60', type_key: 'other' } as never);
    push({ pathname: '/documents', params: { folder: 'Taxes/2025' } });
    await unlocked(t, <DocumentsScreen />);
    await screen.findByTestId('doc-row-p60');
    expect(screen.queryByTestId('documents-chip-folder')).toBeNull();
  });
});
