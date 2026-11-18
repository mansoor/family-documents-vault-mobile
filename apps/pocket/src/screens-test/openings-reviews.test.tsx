import { RECORD_FORMATS_NOTE, sensitiveBackupsWords, sensitiveLinkStartWords, type Share } from '@fdv/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import CollectionScreen from '../app/collection/[id]';
import SharingScreen from '../app/sharing';
import { mimeOf, RECORD_TYPES } from '../capture/pickers';
import { fixtureScanner } from '../capture/scanner';
import { DocumentDetail } from '../documents/detail';
import { EmergencyPage } from '../emergency/page';
import { useCapture } from '../state/capture';
import { audit } from '../test-support/a11y';
import { libraryDoc, unlocked } from '../test-support/lookup';
import { installed, respond, testCapture } from '../test-support/render';
import { push, resetRoutes } from '../test-support/router';
import { caps0519, capabilities, testVault, type TestVault } from '../test-support/vault';
import { Pressable, Text } from 'react-native';

jest.mock(
  'expo-router',
  () => jest.requireActual<typeof import('../test-support/router')>('../test-support/router').routerMock,
);

/**
 * The vault's health releases, on the phone (app 0.17.0): who opened a link
 * (H5) under each link in Sharing, on a clinician's link and on a sensitive
 * paper of one's own; a yearly review turned on from the document's page
 * (H3); the folder a paper came from (C4); and H5's small ones — a
 * sensitive link starting careful, what backups keep, and health record
 * files offered in the picker.
 */

const ORIGIN = 'https://vault.test';

beforeEach(() => {
  installed();
  resetRoutes();
});
afterEach(() => jest.restoreAllMocks());

/** A vault of 0.9.0-dev.61 (`older`: one of dev.50, before H5's openings and C4). */
function vault(over: { older?: boolean } = {}): TestVault {
  const t = testVault([ORIGIN]);
  t.caps = capabilities({
    server_version: over.older ? '0.9.0-dev.50' : '0.9.0-dev.61',
    features: {
      ...caps0519().features,
      notes: true,
      share_options: true,
      share_second_factor: true,
      share_reveal: true,
      sensitive_documents: true,
      sensitive_protects: true,
      health_kinds: true,
      emergency_info: true,
      no_longer_needed: true,
      collections: true,
      collection_shares: true,
      ...(over.older ? {} : { share_opens: true, record_formats: true, source_folders: true }),
    },
    limits: { max_upload_bytes: 104_857_600, max_members: null, max_storage_bytes: null, backup_retain_days: 30 },
  });
  t.vault.state.members.push({ id: 'pat', display_name: 'Pat', role: 'adult', is_me: false } as never);
  return t;
}

/** A link as Sharing lists it, kept by the fake too with when it was opened. */
function link(t: TestVault, over: Partial<Share> & { id: string }, openings: { at: string; device: string }[] = []) {
  const share = {
    document_id: 'passport',
    document_title: 'Passport',
    recipient_label: 'Dr Patel',
    created_by_name: 'Fake Owner',
    created_at: '2026-11-10T10:00:00Z',
    expires_at: '2030-11-17T10:00:00Z',
    has_pin: false,
    open_count: openings.length,
    last_opened_at: openings.at(-1)?.at ?? null,
    state: 'active',
    summary: 'A link',
    mine: true,
    ...over,
  } as Share;
  t.library.shares.push(share);
  (t.vault.state.shares ??= []).push({
    share,
    made_by: share.mine === false ? 'pat' : 'fake-member',
    token: `tok-${share.id}`,
    pin: null,
    password: null,
    openings,
  });
  return share;
}

/** The passport the links give, as the fake keeps it. */
function passport(t: TestVault) {
  t.vault.state.documents.push({
    id: 'passport',
    title: 'Passport',
    type_key: 'passport',
    owner_member_id: 'fake-member',
    visibility: 'household',
    deleted_at: null,
  } as never);
}

const OPENED = [
  { at: '2026-11-14T09:00:00Z', device: 'Firefox on a Windows computer' },
  { at: '2026-11-15T10:00:00Z', device: 'Safari on an iPhone' },
];

describe('who opened a link, in Sharing (H5)', () => {
  it('under a link opened, closed at first; opened, each time and the browser, newest first; then hidden', async () => {
    const t = vault();
    passport(t);
    link(t, { id: 's1' }, OPENED);
    link(t, { id: 's2', recipient_label: null, created_at: '2026-11-09T10:00:00Z' });
    await unlocked(t, <SharingScreen />);
    const toggle = await screen.findByTestId('sharing-opens-s1');
    expect(toggle).toHaveTextContent('Who opened it (2)');
    expect(toggle.props.accessibilityLabel).toBe('Who opened the link for Dr Patel, when: 2 times');
    expect(toggle.props.accessibilityState).toMatchObject({ expanded: false });
    // Never opened: nothing to show.
    expect(screen.queryByTestId('sharing-opens-s2')).toBeNull();
    expect(audit()).toEqual([]);
    await fireEvent.press(toggle);
    expect(await screen.findByTestId('sharing-opens-s1-list-0')).toHaveTextContent(
      /^Opened 15 Nov 2026, 10:00.*, in Safari on an iPhone$/,
    );
    expect(screen.getByTestId('sharing-opens-s1-list-1')).toHaveTextContent(/in Firefox on a Windows computer$/);
    expect(screen.getByTestId('sharing-opens-s1')).toHaveTextContent('Hide who opened it');
    expect(screen.getByTestId('sharing-opens-s1').props.accessibilityState).toMatchObject({ expanded: true });
    expect(t.calls.some((c) => c.endsWith('/api/v1/shares/s1/opens'))).toBe(true);
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByTestId('sharing-opens-s1'));
    expect(screen.queryByTestId('sharing-opens-s1-list-0')).toBeNull();
  });

  it('one that no longer works keeps it; where the vault emailed a link is said on its row', async () => {
    const t = vault();
    passport(t);
    link(t, { id: 'gone', state: 'revoked', emailed_to: 'j•••@e•••.com', emailed_by_name: 'Pat', mine: true }, OPENED);
    link(t, { id: 'now', emailed_to: 'd•••@s•••.com', emailed_by_name: 'Pat', mine: false, created_by_name: 'Pat' });
    await unlocked(t, <SharingScreen />);
    expect(await screen.findByTestId('sharing-ended-gone')).toHaveTextContent(/Emailed to j•••@e•••\.com/);
    expect(screen.getByTestId('sharing-ended-gone')).not.toHaveTextContent(/by Pat/);
    expect(screen.getByTestId('sharing-opens-gone')).toHaveTextContent('Who opened it (2)');
    expect(screen.getByTestId('sharing-now')).toHaveTextContent(/Emailed to d•••@s•••\.com by Pat/);
  });

  it('an adult sees no openings of somebody else’s link; an older vault offers none', async () => {
    const t = vault();
    passport(t);
    t.vault.state.role = 'adult';
    link(t, { id: 'pats', mine: false, created_by_name: 'Pat' }, OPENED);
    await unlocked(t, <SharingScreen />);
    await screen.findByTestId('sharing-pats');
    expect(screen.queryByTestId('sharing-opens-pats')).toBeNull();

    const old = vault({ older: true });
    passport(old);
    link(old, { id: 's1' }, OPENED);
    await unlocked(old, <SharingScreen />);
    await screen.findByTestId('sharing-s1');
    expect(screen.queryByTestId('sharing-opens-s1')).toBeNull();
  });
});

describe('who opened a link, when it can’t be asked', () => {
  it('a refusal is said under the link, in the vault’s words; the list stays closed', async () => {
    const t = vault();
    passport(t);
    link(t, { id: 's1' }, OPENED);
    const inner = t.fetch;
    t.fetch = (url, init) =>
      url.endsWith('/api/v1/shares/s1/opens')
        ? Promise.resolve(respond(403, { error: { code: 'forbidden', message: 'Only whoever made this link, or an owner, can see who opened it.' } }))
        : inner(url, init);
    await unlocked(t, <SharingScreen />);
    await fireEvent.press(await screen.findByTestId('sharing-opens-s1'));
    expect(await screen.findByTestId('sharing-opens-s1-problem')).toHaveTextContent(
      'Only whoever made this link, or an owner, can see who opened it.',
    );
    expect(screen.queryByTestId('sharing-opens-s1-list-0')).toBeNull();
    expect(screen.getByTestId('sharing-opens-s1').props.accessibilityState).toMatchObject({ expanded: false });
  });

  it('without a connection: nothing is shown as if it were none, and it waits', async () => {
    const t = vault();
    passport(t);
    link(t, { id: 's1' }, OPENED);
    await unlocked(t, <SharingScreen />);
    const toggle = await screen.findByTestId('sharing-opens-s1');
    t.reachable.delete(ORIGIN);
    await fireEvent.press(toggle);
    expect(await screen.findByTestId('sharing-opens-s1-problem')).toBeTruthy();
    expect(screen.queryByTestId('sharing-opens-s1-list-none')).toBeNull();
    expect(screen.queryByTestId('sharing-opens-s1-list-0')).toBeNull();
  });
});

describe('who opened a clinician’s link (H5)', () => {
  it('on the person’s page, behind the same disclosure, closed at first', async () => {
    const t = vault();
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
      pin: null,
      recipient_label: 'A&E',
      created_by: 'fake-member',
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      revoked: false,
      openings: [{ at: '2026-11-16T09:00:00Z', network: null, user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1' }],
    } as never);
    await unlocked(t, <EmergencyPage id="fake-member" name="Fake Owner" />);
    const toggle = await screen.findByTestId('emergency-link-l1-opens');
    expect(toggle).toHaveTextContent('Who opened it (1)');
    expect(toggle.props.accessibilityLabel).toBe('Who opened the link for A&E, when: once');
    expect(screen.queryByTestId('emergency-link-l1-opened-0')).toBeNull();
    expect(audit()).toEqual([]);
    await fireEvent.press(toggle);
    expect(screen.getByTestId('emergency-link-l1-opened-0')).toHaveTextContent(/^Opened 16 Nov 2026/);
    expect(screen.getByTestId('emergency-link-l1-opens')).toHaveTextContent('Hide who opened it');
  });
});

describe('a sensitive paper of one’s own, shared by somebody else (H5)', () => {
  it('its page lists every link to it someone else made, and who opened each; one’s own are in Sharing', async () => {
    const t = vault();
    t.vault.state.documents.push({
      id: 'lab',
      title: 'Blood test',
      type_key: 'lab_result',
      owner_member_id: 'fake-member',
      visibility: 'adults',
      deleted_at: null,
      sensitive: true,
    } as never);
    libraryDoc(t, { id: 'lab', title: 'Blood test', type_key: 'lab_result', sensitive_effective: true } as never);
    link(t, { id: 'pats', document_id: 'lab', document_title: 'Blood test', mine: false, created_by_name: 'Pat', recipient_label: 'The school nurse' }, OPENED);
    link(t, { id: 'mine', document_id: 'lab', document_title: 'Blood test', created_at: '2026-11-11T10:00:00Z' });
    await unlocked(t, <DocumentDetail id="lab" />);
    const card = await screen.findByTestId('document-their-links');
    expect(card).toHaveTextContent(/^Shared outside the familyThis is sensitive and it’s yours/);
    expect(screen.getByTestId('document-their-link-pats')).toHaveTextContent(
      /^The school nurseMade by Pat · Works until .*Opened 15 Nov 2026.*in Safari on an iPhoneOpened 14 Nov 2026/,
    );
    expect(screen.queryByTestId('document-their-link-mine')).toBeNull();
    expect(audit()).toEqual([]);
  });
});

describe('a yearly review, turned on from the page (H3)', () => {
  function directive(t: TestVault, issued = '2020-03-10') {
    t.vault.state.documents.push({
      id: 'will',
      title: 'Living will',
      type_key: 'advance_directive',
      owner_member_id: 'fake-member',
      visibility: 'adults',
      deleted_at: null,
    } as never);
    libraryDoc(t, {
      id: 'will',
      title: 'Living will',
      type_key: 'advance_directive',
      issued: { date: issued, precision: 'day' },
    } as never);
  }

  it('off until turned on: on the anniversary of its signing, said; turned off only once asked', async () => {
    const t = vault();
    directive(t);
    await unlocked(t, <DocumentDetail id="will" />);
    const line = await screen.findByTestId('document-review');
    expect(line).toHaveTextContent('Remind us to review it every year');
    expect(screen.getByTestId('document-review-switch').props.value).toBe(false);
    expect(audit()).toEqual([]);
    await fireEvent(screen.getByTestId('document-review-switch'), 'valueChange', true);
    expect(await screen.findByTestId('document-review-next')).toHaveTextContent(/^Next review: 10 Mar 20\d\d$/);
    const kept = () => [...t.reminders, ...t.upcoming].find((r) => r.document_id === 'will');
    const made = kept();
    expect(made).toMatchObject({ review: true, recurrence: 'annual' });
    expect(made?.fire_at.slice(5, 10)).toBe('03-10');

    // Off: asked in its own words first; Cancel keeps it.
    await fireEvent(screen.getByTestId('document-review-switch'), 'valueChange', false);
    expect(await screen.findByTestId('review-off-question')).toHaveTextContent(/Turn off the yearly review\?/);
    await fireEvent.press(screen.getByTestId('review-off-cancel'));
    expect(kept()).toBeTruthy();
    await fireEvent(screen.getByTestId('document-review-switch'), 'valueChange', false);
    await fireEvent.press(await screen.findByTestId('review-off-yes'));
    await waitFor(() => expect(kept()).toBeUndefined());
    expect(screen.queryByTestId('document-review-next')).toBeNull();
  });

  it('not offered on a kind it isn’t for, nor before the vault has health’s kinds', async () => {
    const t = vault();
    libraryDoc(t, { id: 'passport', title: 'Passport' });
    await unlocked(t, <DocumentDetail id="passport" />);
    await screen.findByTestId('document-versions');
    expect(screen.queryByTestId('document-review')).toBeNull();
  });
});

describe('the folder a paper came from (C4)', () => {
  it('said on its page; Forget it is asked first, then gone for everyone', async () => {
    const t = vault();
    const doc = libraryDoc(t, { id: 'tax', title: 'P60', type_key: 'p60', source_folder: 'Taxes/2025' } as never);
    await unlocked(t, <DocumentDetail id="tax" />);
    const line = await screen.findByTestId('document-source-folder');
    expect(line).toHaveTextContent(/^Came from the folderTaxes\/2025Forget it…$/);
    expect(screen.getByTestId('document-source-folder-forget').props.accessibilityLabel).toBe(
      'Forget the folder “Taxes/2025”',
    );
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByTestId('document-source-folder-forget'));
    expect(await screen.findByTestId('forget-folder-question')).toHaveTextContent(
      /“Taxes\/2025” is taken off this document for everyone.*This can’t be undone\./,
    );
    await fireEvent.press(screen.getByTestId('forget-folder-cancel'));
    expect(t.library.documents.get('tax')?.source_folder).toBe('Taxes/2025');
    await fireEvent.press(screen.getByTestId('document-source-folder-forget'));
    await fireEvent.press(await screen.findByTestId('forget-folder-yes'));
    await waitFor(() => expect(screen.queryByTestId('document-source-folder')).toBeNull());
    expect(t.library.documents.get('tax')?.source_folder).toBeNull();
    expect(t.library.documents.get('tax')?.etag).not.toBe(doc.etag);
  });

  it('an older vault says nothing of it', async () => {
    const t = vault({ older: true });
    libraryDoc(t, { id: 'tax', title: 'P60', type_key: 'p60', source_folder: 'Taxes/2025' } as never);
    await unlocked(t, <DocumentDetail id="tax" />);
    await screen.findByTestId('document-versions');
    expect(screen.queryByTestId('document-source-folder')).toBeNull();
  });
});

describe('H5’s small ones', () => {
  it('a sensitive document’s link starts as View only, for a week, and says why; a choice of download stands', async () => {
    const t = vault();
    libraryDoc(t, { id: 'lab', title: 'Blood test', type_key: 'lab_result', sensitive: null, sensitive_effective: true } as never);
    await unlocked(t, <DocumentDetail id="lab" />);
    await fireEvent.press(await screen.findByTestId('document-more'));
    await fireEvent.press(await screen.findByTestId('document-share'));
    await screen.findByTestId('share-label');
    expect(screen.getByTestId('share-permission-view').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByTestId('share-end-week').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByTestId('share-careful')).toHaveTextContent(sensitiveLinkStartWords({ viewable: true }));
    await fireEvent.press(screen.getByTestId('share-permission-download'));
    expect(screen.getByTestId('share-permission-download').props.accessibilityState).toMatchObject({ selected: true });
  });

  it('a collection’s link with a sensitive PDF and a Word file ticked starts as download, as the vault can give it', async () => {
    const t = vault();
    t.vault.state.collections.push({
      id: 'gp',
      name: 'For the GP',
      description: null,
      audience: 'everyone',
      owner_member_id: 'fake-member',
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-01T00:00:00Z',
      revision: 1,
      deleted: false,
      items: [],
    } as never);
    t.library.sharePreviews.set('gp', {
      collection_id: 'gp',
      collection_name: 'For the GP',
      audience: 'everyone',
      items: [
        { document_id: 'lab', title: 'Blood test', type_label: 'Lab result', ticked: true, lock: null, reason: null, viewable: true, sensitive: true },
        { document_id: 'notes', title: 'Symptoms', type_label: 'Letter', ticked: true, lock: null, reason: null, viewable: false, sensitive: false },
      ],
    });
    push({ pathname: '/collection/[id]', params: { id: 'gp' } });
    await unlocked(t, <CollectionScreen />);
    await fireEvent.press(await screen.findByTestId('collection-more'));
    await fireEvent.press(await screen.findByTestId('collection-share'));
    await screen.findByTestId('share-item-notes');
    // Nothing it can't draw goes to view: no choice, and the words say download.
    expect(screen.queryByTestId('share-permission-view')).toBeNull();
    expect(screen.getByTestId('share-careful')).toHaveTextContent(
      sensitiveLinkStartWords({ viewable: false, collection: true }),
    );
    await fireEvent.press(screen.getByTestId('share-make'));
    await fireEvent.press(await screen.findByTestId('share-sensitive-yes'));
    const password = await screen.findByTestId('step-up-password');
    await fireEvent.changeText(password, 'correct horse battery staple');
    await fireEvent.press(screen.getByTestId('step-up-go'));
    expect(await screen.findByTestId('share-reveal')).toBeTruthy();
    expect(t.library.shareBodies[0]?.body).toMatchObject({ permission: 'download', document_ids: ['lab', 'notes'] });

  });

  it('the same collection with only the PDF ticked starts as View only', async () => {
    const t = vault();
    t.vault.state.collections.push({
      id: 'gp',
      name: 'For the GP',
      description: null,
      audience: 'everyone',
      owner_member_id: 'fake-member',
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-01T00:00:00Z',
      revision: 1,
      deleted: false,
      items: [],
    } as never);
    t.library.sharePreviews.set('gp', {
      collection_id: 'gp',
      collection_name: 'For the GP',
      audience: 'everyone',
      items: [
        { document_id: 'lab', title: 'Blood test', type_label: 'Lab result', ticked: true, lock: null, reason: null, viewable: true, sensitive: true },
        { document_id: 'notes', title: 'Symptoms', type_label: 'Letter', ticked: false, lock: null, reason: null, viewable: false, sensitive: false },
      ],
    });
    push({ pathname: '/collection/[id]', params: { id: 'gp' } });
    await unlocked(t, <CollectionScreen />);
    await fireEvent.press(await screen.findByTestId('collection-more'));
    await fireEvent.press(await screen.findByTestId('collection-share'));
    await screen.findByTestId('share-item-notes');
    expect(screen.getByTestId('share-permission-view').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByTestId('share-careful')).toHaveTextContent(
      sensitiveLinkStartWords({ viewable: true, collection: true }),
    );
    // Ticking the Word file makes it download, with no View to choose.
    await fireEvent.press(screen.getByTestId('share-item-notes'));
    expect(screen.queryByTestId('share-permission-view')).toBeNull();
  });

  it('an older vault starts it as before: to download', async () => {
    const t = vault({ older: true });
    libraryDoc(t, { id: 'lab', title: 'Blood test', type_key: 'lab_result', sensitive: null, sensitive_effective: true } as never);
    await unlocked(t, <DocumentDetail id="lab" />);
    await fireEvent.press(await screen.findByTestId('document-more'));
    await fireEvent.press(await screen.findByTestId('document-share'));
    await screen.findByTestId('share-label');
    expect(screen.getByTestId('share-permission-download').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.queryByTestId('share-careful')).toBeNull();
  });

  it('moving a sensitive one to the Trash says what older backups keep, and for how long', async () => {
    const t = vault();
    libraryDoc(t, { id: 'lab', title: 'Blood test', type_key: 'lab_result', sensitive: null, sensitive_effective: true } as never);
    libraryDoc(t, { id: 'passport', title: 'Passport', sensitive_effective: false } as never);
    await unlocked(t, <DocumentDetail id="lab" />);
    await fireEvent.press(await screen.findByTestId('document-more'));
    await fireEvent.press(await screen.findByTestId('document-trash'));
    expect(await screen.findByTestId('trash-backups')).toHaveTextContent(
      sensitiveBackupsWords(30, { forGood: false }),
    );
    expect(screen.getByTestId('trash-backups')).toHaveTextContent(/the vault keeps its nightly backups for 30 days\.$/);
    expect(audit()).toEqual([]);
  });

  it('a document that isn’t sensitive says nothing of backups', async () => {
    const t = vault();
    libraryDoc(t, { id: 'passport', title: 'Passport', sensitive_effective: false } as never);
    await unlocked(t, <DocumentDetail id="passport" />);
    await fireEvent.press(await screen.findByTestId('document-more'));
    await fireEvent.press(await screen.findByTestId('document-trash'));
    await screen.findByTestId('trash-yes');
    expect(screen.queryByTestId('trash-backups')).toBeNull();
  });

  it('health record files offered in the picker where the vault keeps them, each as the vault keeps it', async () => {
    // A hospital CD's image with no ending, too: the phone calls it octet-stream, and the vault knows it by its bytes.
    expect(RECORD_TYPES).toEqual(
      expect.arrayContaining(['application/xml', 'application/json', 'application/dicom', 'application/zip', 'application/octet-stream']),
    );
    expect(mimeOf('IM00001', 'application/octet-stream', true)).toBe('application/octet-stream');
    expect(mimeOf('visit.xml', 'text/xml', true)).toBe('application/xml');
    expect(mimeOf('export.json', 'text/plain', true)).toBe('application/json');
    expect(mimeOf('IM00001.dcm', 'application/octet-stream', true)).toBe('application/dicom');
    expect(mimeOf('portal.zip', 'application/x-zip-compressed', true)).toBe('application/zip');
    // Never a PDF or a photo, whatever its name; without records, as before.
    expect(mimeOf('scan.pdf', 'application/pdf', true)).toBe('application/pdf');
    expect(mimeOf('export.json', 'application/octet-stream')).toBe('application/octet-stream');
    expect(RECORD_FORMATS_NOTE).toMatch(/Health records from a patient portal/);

    const scanner = fixtureScanner([]);
    function Add() {
      const capture = useCapture();
      return (
        <Pressable accessibilityRole="button" testID="add" onPress={() => void capture.start('file')}>
          <Text>Add a file</Text>
        </Pressable>
      );
    }
    await unlocked(vault(), <Add />, { capture: testCapture({ scanner }) });
    await fireEvent.press(await screen.findByTestId('add'));
    await waitFor(() => expect(scanner.asked).toEqual(['file+records']));

    const older = fixtureScanner([]);
    resetRoutes();
    await unlocked(vault({ older: true }), <Add />, { capture: testCapture({ scanner: older }) });
    await fireEvent.press(await screen.findByTestId('add'));
    await waitFor(() => expect(older.asked).toEqual(['file']));
  });
});
