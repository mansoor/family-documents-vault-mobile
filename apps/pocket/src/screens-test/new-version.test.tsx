import type { DetailSuggestions, DocumentView, VersionView } from '@fdv/shared';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { DocumentDetail } from '../documents/detail';
import { SecureTokenStore } from '../session/store';
import { libraryDoc, unlocked } from '../test-support/lookup';
import { installed } from '../test-support/render';
import { resetRoutes, routes } from '../test-support/router';
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

/** A vault of 0.9.0, which keeps each version's details. */
function versionVault(details = true): TestVault {
  const t = testVault([ORIGIN]);
  t.caps = capabilities({ features: { ...capabilities().features, version_details: details } });
  return t;
}

/**
 * A licence renewed from the phone: version 2 added, its details still the
 * first version's (unconfirmed), and the first version's own kept.
 */
function renewedLicence(t: TestVault, over: Partial<DocumentView> = {}): DocumentView {
  const doc = libraryDoc(
    t,
    {
      id: 'licence',
      title: 'Driving licence',
      type_key: 'driving_licence',
      issued_by: 'DVLA',
      identifier: 'MORGA657054SM9IJ',
      issued: { date: '2015-03-01', precision: 'day' },
      expires: { date: '2025-03-01', precision: 'day' },
      latest_version_id: 'licence-v2',
      versions: 2,
      details_unconfirmed: true,
      ...over,
    },
    { id: 'licence-v2', version_no: 2, uploaded_at: '2026-11-07T10:00:00Z' },
  );
  const older: VersionView = {
    ...((t.library.versions.get('licence') ?? [])[0] as VersionView),
    id: 'licence-v1',
    version_no: 1,
    filename: 'old-licence.pdf',
    uploaded_at: '2015-03-02T10:00:00Z',
    details: {
      issued: { date: '2015-03-01', precision: 'day' },
      expires: { date: '2025-03-01', precision: 'day' },
      identifier: 'MORGA657054SM9IJ',
      issued_by: 'DVLA',
      extra: {},
      kept_at: '2026-11-07T10:00:00Z',
    },
    details_kept: true,
  };
  t.library.versions.set('licence', [...(t.library.versions.get('licence') ?? []), older]);
  return doc;
}

/** What the new version's pages read: a new expiry, sure; a new issuer, weak. */
const READ: DetailSuggestions = {
  state: 'ready',
  version_id: 'licence-v2',
  proposal: {},
  renewal: {
    expires: { value: { date: '2035-03-01', precision: 'day' }, confidence: 0.96, cue: 'label' },
    issued_by: { value: 'DVLA Swansea', confidence: 0.55, cue: 'nearby' },
  } as never,
};

describe('a new version, confirmed (P2)', () => {
  it('says what the new version reads otherwise, ticks the sure ones, and Use these makes them its own', async () => {
    const t = versionVault();
    renewedLicence(t);
    t.library.suggestions.set('licence', READ);
    await unlocked(t, <DocumentDetail id="licence" />);

    expect(await screen.findByTestId('renewal-card')).toHaveTextContent(/^The new version says:/);
    const expires = screen.getByTestId('renewal-expires');
    const issuer = screen.getByTestId('renewal-issued_by');
    expect(expires).toHaveTextContent('Expires 1 Mar 2035(was 1 Mar 2025)');
    expect(expires.props.accessibilityState).toEqual(expect.objectContaining({ checked: true }));
    // Weak: offered, marked, and left for the person to tick.
    expect(issuer).toHaveTextContent(/check this/);
    expect(issuer.props.accessibilityState).toEqual(expect.objectContaining({ checked: false }));

    await fireEvent.press(screen.getByTestId('renewal-use'));
    expect(await screen.findByTestId('renewal-done')).toHaveTextContent(
      /^The new version's details are saved\. You can undo this for 5 minutes\.Undo$/,
    );
    // Only the ticked one, for the version that was read, on the document as it was seen.
    expect(t.library.renewals).toEqual([{ version_id: 'licence-v2', expires: { date: '2035-03-01', precision: 'day' } }]);
    expect(t.library.documents.get('licence')?.expires).toEqual({ date: '2035-03-01', precision: 'day' });
    await waitFor(() => expect(screen.queryByTestId('renewal-card')).toBeNull());

    // Undo puts it back, and the card offers it again.
    await fireEvent.press(screen.getByTestId('renewal-undo'));
    expect(await screen.findByTestId('renewal-done')).toHaveTextContent('Undone: the details are as they were.');
    expect(t.library.documents.get('licence')?.expires).toEqual({ date: '2025-03-01', precision: 'day' });
    expect(await screen.findByTestId('renewal-card')).toBeTruthy();
  });

  it('a weak reading ticked by the person is sent too; nothing ticked, nothing to use', async () => {
    const t = versionVault();
    renewedLicence(t);
    t.library.suggestions.set('licence', READ);
    await unlocked(t, <DocumentDetail id="licence" />);
    await screen.findByTestId('renewal-card');
    await fireEvent.press(screen.getByTestId('renewal-expires'));
    expect(screen.getByTestId('renewal-use').props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );
    await fireEvent.press(screen.getByTestId('renewal-issued_by'));
    await fireEvent.press(screen.getByTestId('renewal-use'));
    await screen.findByTestId('renewal-done');
    expect(t.library.renewals).toEqual([{ version_id: 'licence-v2', issued_by: 'DVLA Swansea' }]);
  });

  it('while the vault is still reading the pages, says so', async () => {
    const t = versionVault();
    renewedLicence(t);
    t.library.suggestions.set('licence', { state: 'pending', version_id: null, proposal: {} });
    await unlocked(t, <DocumentDetail id="licence" />);
    expect(await screen.findByTestId('renewal-reading')).toHaveTextContent("Reading the new version's pages…");
    expect(screen.queryByTestId('renewal-card')).toBeNull();
  });

  it('changed somewhere else since: nothing is saved, it says why, and the page is loaded again', async () => {
    const t = versionVault();
    renewedLicence(t);
    t.library.suggestions.set('licence', READ);
    await unlocked(t, <DocumentDetail id="licence" />);
    await screen.findByTestId('renewal-card');
    // Somebody edits it in the browser meanwhile.
    const doc = t.library.documents.get('licence') as DocumentView;
    t.library.documents.set('licence', { ...doc, title: 'Driving licence (Sam)', etag: nextEtag() });
    await fireEvent.press(screen.getByTestId('renewal-use'));
    expect(await screen.findByTestId('renewal-error')).toHaveTextContent(
      /^This document was changed somewhere else, so nothing was saved/,
    );
    expect(t.library.renewals).toEqual([]);
    expect(await screen.findByText('Driving licence (Sam)')).toBeTruthy();
  });

  it('Not now puts it away for this version, and it stays away', async () => {
    const t = versionVault();
    renewedLicence(t);
    t.library.suggestions.set('licence', READ);
    const first = await unlocked(t, <DocumentDetail id="licence" />);
    await screen.findByTestId('renewal-card');
    await fireEvent.press(screen.getByTestId('renewal-not-now'));
    expect(screen.queryByTestId('renewal-card')).toBeNull();
    first.app.unmount();
    const asked = t.library.asked.length;
    await unlocked(t, <DocumentDetail id="licence" />);
    await screen.findByTestId('document');
    await act(async () => undefined);
    expect(screen.queryByTestId('renewal-card')).toBeNull();
    expect(t.library.asked.length).toBe(asked);
  });

  it('asks nothing of a vault that keeps no version details, of details already confirmed, or for a viewer', async () => {
    // An older vault.
    const old = versionVault(false);
    renewedLicence(old);
    old.library.suggestions.set('licence', READ);
    const a = await unlocked(old, <DocumentDetail id="licence" />);
    await screen.findByTestId('document');
    await act(async () => undefined);
    expect(old.library.asked).toEqual([]);
    a.app.unmount();
    // Confirmed already.
    const done = versionVault();
    renewedLicence(done, { details_unconfirmed: false });
    done.library.suggestions.set('licence', READ);
    const b = await unlocked(done, <DocumentDetail id="licence" />);
    await screen.findByTestId('document');
    await act(async () => undefined);
    expect(done.library.asked).toEqual([]);
    b.app.unmount();
    // A viewer may not change it.
    const viewer = versionVault();
    renewedLicence(viewer);
    viewer.library.suggestions.set('licence', READ);
    await unlocked(viewer, <DocumentDetail id="licence" />, {
      before: async () => {
        const store = new SecureTokenStore();
        const kept = await store.load();
        await store.save({ ...(kept as NonNullable<typeof kept>), role: 'viewer' as never });
      },
    });
    await screen.findByTestId('document');
    await act(async () => undefined);
    expect(screen.queryByTestId('renewal-card')).toBeNull();
  });

  it('an older version shows its own details, or that they were not kept, and opens its own pages', async () => {
    const t = versionVault();
    renewedLicence(t, { details_unconfirmed: false });
    await unlocked(t, <DocumentDetail id="licence" />);
    // The versions open in place, from their line (R6).
    await fireEvent.press(await screen.findByTestId('document-versions'));
    const v1 = await screen.findByTestId('version-1-details');
    expect(v1).toHaveTextContent(/Issued by: DVLA/);
    expect(v1).toHaveTextContent(/Expires: 1 Mar 2025/);
    // Its number is not shown, as the newest version's is not.
    expect(v1).not.toHaveTextContent(/MORGA/);
    expect(screen.queryByTestId('version-2-details')).toBeNull();
    await fireEvent.press(screen.getByTestId('version-1-pages'));
    expect(routes()).toEqual([
      { pathname: '/essential/[id]', params: { id: 'licence', online: '1', version: 'licence-v1' } },
    ]);
  });

  it('a version replaced before 0.9.0 says its details were not kept', async () => {
    const t = versionVault();
    renewedLicence(t, { details_unconfirmed: false });
    const versions = t.library.versions.get('licence') as VersionView[];
    t.library.versions.set(
      'licence',
      versions.map((v) => (v.id === 'licence-v1' ? { ...v, details: null, details_kept: false } : v)),
    );
    await unlocked(t, <DocumentDetail id="licence" />);
    // The versions open in place, from their line (R6).
    await fireEvent.press(await screen.findByTestId('document-versions'));
    expect(await screen.findByTestId('version-1-details')).toHaveTextContent(
      /^Details weren't kept for versions replaced before 0\.9\.0\.Its pages$/,
    );
  });
});
