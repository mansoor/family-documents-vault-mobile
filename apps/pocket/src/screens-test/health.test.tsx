import type { DocumentView, ReminderView } from '@fdv/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Share } from 'react-native';
import MoreScreen from '../app/(tabs)/more';
import AttentionScreen from '../app/attention';
import PersonScreen from '../app/person/[id]';
import { DocumentDetail } from '../documents/detail';
import { offersNewScan, reminderHeadline } from '../documents/reminders';
import { EmergencyPage } from '../emergency/page';
import { EmergencyPeople } from '../emergency/people';
import { audienceWords, browserWords, itemLine, sections, tick } from '../emergency/rules';
import i18n from '../i18n';
import { audit } from '../test-support/a11y';
import { libraryDoc, unlocked } from '../test-support/lookup';
import { installed, respond } from '../test-support/render';
import { push, resetRoutes, routes } from '../test-support/router';
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
 * A vault of 0.9.0-dev.53: health kinds (H3), emergency information (H4),
 * health records kept as they are (H5) and No longer needed. The family:
 * the fake's owner (signed in, unless `role`), Pat (an adult), Kim (a teen),
 * Sara (no sign-in).
 */
function vault(over: { emergency?: boolean; role?: 'owner' | 'adult' | 'teen' | 'viewer' } = {}): TestVault {
  const v = testVault([ORIGIN]);
  v.caps = capabilities({
    server_version: '0.9.0-dev.53',
    features: {
      ...caps0519().features,
      notes: true,
      no_longer_needed: true,
      health_kinds: true,
      record_formats: true,
      ...(over.emergency === false ? {} : { emergency_info: true }),
    },
  });
  v.vault.state.members.push(
    { id: 'pat', display_name: 'Pat', role: 'adult', is_me: false } as never,
    { id: 'kim', display_name: 'Kim', role: 'teen', is_me: false } as never,
    { id: 'sara', display_name: 'Sara', is_me: false, date_of_birth: '2019-04-02' } as never,
  );
  if (over.role) v.vault.state.role = over.role;
  return v;
}

/** Sara's page, as an owner wrote it. */
function saraPage(v: TestVault, over: { audience?: 'owners_and_self' | 'adults' | 'family' } = {}) {
  (v.vault.state.emergency ??= []).push({
    member: 'sara',
    fields: {
      blood_type: 'O+',
      allergies: [{ id: 'a1', name: 'Penicillin', note: 'Rash' }],
      medications: [{ id: 'm1', name: 'Salbutamol', dose: '2 puffs as needed' }],
      emergency_contacts: [{ id: 'c1', name: 'Pat', role: 'Parent', phone: '07700 900123' }],
      insurance: { insurer: 'Aviva', member_id: 'AV-123' },
    },
    audience: over.audience ?? 'adults',
    chosen: [],
    version: 2,
    updated_at: '2026-11-15T10:00:00Z',
  });
}

/** Sara's advance directive, as the fake keeps documents (the page links to it). */
function saraDirective(v: TestVault) {
  v.vault.state.documents.push({
    id: 'directive',
    title: 'Sara’s care plan',
    type_key: 'advance_directive',
    owner_member_id: 'sara',
    visibility: 'household',
    deleted_at: null,
  } as never);
}

describe('emergency information (H4)', () => {
  it('the rules: one line an entry, the parts in order, who sees it', () => {
    expect(itemLine({ id: 'm', name: 'Metformin', dose: '500 mg', note: 'With food' })).toBe('Metformin · 500 mg · With food');
    const parts = sections(
      {
        date_of_birth: '2019-04-02',
        fields: { notes: 'Carries an inhaler', blood_type: 'A-', insurance: { insurer: 'Aviva', group_number: 'G1' } },
      },
      t,
    );
    expect(parts.map((p) => p.label)).toEqual(['Date of birth', 'Blood type', 'Insurance', 'Other information']);
    expect(parts[2]?.lines).toEqual(['Aviva', 'Group G1']);
    expect(audienceWords({ audience: 'adults', chosen: [{ member_id: 'k', name: 'Kim' }] }, false, 'Sara', t)).toBe(
      'Sara, the owners and every adult, and Kim.',
    );
    expect(audienceWords({ audience: 'owners_and_self', chosen: [] }, true, 'Me', t)).toBe('You and the owners.');
    expect(browserWords('Mozilla/5.0 (iPhone) Version/17 Safari/605.1', t)).toBe('Safari');
    expect(browserWords(null, t)).toBe('a browser');
    expect(tick(['allergies', 'blood_type'], 'date_of_birth', true)).toEqual(['date_of_birth', 'blood_type', 'allergies']);
  });

  it('More has it on a vault that keeps it, for whoever may read a page; not for a viewer, nor on an older vault', async () => {
    const v = vault();
    await unlocked(v, <MoreScreen />);
    await fireEvent.press(await screen.findByTestId('more-emergency'));
    expect(routes().at(-1)).toEqual({ pathname: '/emergency', params: {} });
    screen.unmount();

    const viewer = vault({ role: 'viewer' });
    await unlocked(viewer, <MoreScreen />);
    await screen.findByTestId('more-settings');
    expect(screen.queryByTestId('more-emergency')).toBeNull();
    screen.unmount();

    const older = vault({ emergency: false });
    await unlocked(older, <MoreScreen />);
    await screen.findByTestId('more-settings');
    expect(screen.queryByTestId('more-emergency')).toBeNull();
  });

  it('the family whose page the reader may see, themselves first; one not shown to them is left out', async () => {
    const v = vault({ role: 'adult' });
    saraPage(v);
    // Kim's page is for the owners and Kim alone: not there for an adult.
    (v.vault.state.emergency ??= []).push({
      member: 'kim',
      fields: { allergies: [{ id: 'x', name: 'Nuts' }] },
      audience: 'owners_and_self',
      chosen: [],
      version: 1,
      updated_at: '2026-11-15T10:00:00Z',
    });
    await unlocked(v, <EmergencyPeople />);
    const sara = await screen.findByTestId('emergency-person-sara');
    expect(sara).toHaveTextContent(/Blood type, Allergies, Medications, Insurance, Emergency contacts/);
    expect(screen.getByTestId('emergency-person-fake-member')).toHaveTextContent(/Nothing entered yet/);
    expect(screen.queryByTestId('emergency-person-kim')).toBeNull();
    expect(screen.queryByTestId('emergency-person-pat')).toBeNull();
    expect(audit()).toEqual([]);
    await fireEvent.press(sara);
    expect(routes().at(-1)).toEqual({ pathname: '/emergency/[id]', params: { id: 'sara', name: 'Sara' } });
  });

  it('a page: its parts as typed, its papers opening, who sees it and that it is not advice; changed here, not on the web', async () => {
    const v = vault();
    saraPage(v);
    saraDirective(v);
    await unlocked(v, <EmergencyPage id="sara" name="Sara" />);
    expect(await screen.findByTestId('emergency-date_of_birth')).toHaveTextContent(/Date of birth/);
    expect(screen.getByTestId('emergency-blood_type')).toHaveTextContent('Blood typeO+');
    expect(screen.getByTestId('emergency-allergies')).toHaveTextContent('AllergiesPenicillin · Rash');
    expect(screen.getByTestId('emergency-medications')).toHaveTextContent('MedicationsSalbutamol · 2 puffs as needed');
    expect(screen.getByTestId('emergency-insurance')).toHaveTextContent('InsuranceAvivaMember ID AV-123');
    expect(screen.getByTestId('emergency-emergency_contacts')).toHaveTextContent('Emergency contactsPat · Parent · 07700 900123');
    expect(screen.getByTestId('emergency-who')).toHaveTextContent('Who can see it: Sara, the owners and every adult.');
    expect(screen.getByTestId('emergency-not-advice')).toHaveTextContent(/Not checked by a doctor, and not medical advice/);
    expect(audit()).toEqual([]);

    // Edit, Who can see it and the wallet card are on the phone since 0.19.0 (emergency-editing.test).
    expect(screen.queryByTestId('emergency-web')).toBeNull();
    expect(screen.getByTestId('emergency-edit-open')).toBeTruthy();
    expect(screen.getByTestId('emergency-who-open')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('emergency-paper-directive'));
    expect(routes().at(-1)).toEqual({ pathname: '/document/[id]', params: { id: 'directive' } });
  });

  it('a person’s page leads to theirs, where the vault shows it to the reader', async () => {
    const v = vault({ role: 'adult' });
    saraPage(v);
    push({ pathname: '/person/[id]', params: { id: 'sara', name: 'Sara' } });
    await unlocked(v, <PersonScreen />);
    await fireEvent.press(await screen.findByTestId('emergency-row-sara'));
    expect(routes().at(-1)).toEqual({ pathname: '/emergency/[id]', params: { id: 'sara', name: 'Sara' } });
    screen.unmount();

    // Kim's is nobody's to read but the owners' and Kim's: no row.
    resetRoutes();
    const other = vault({ role: 'adult' });
    push({ pathname: '/person/[id]', params: { id: 'kim', name: 'Kim' } });
    await unlocked(other, <PersonScreen />);
    await screen.findByTestId('person');
    await waitFor(() => expect(other.calls.some((c) => c.includes('/members/kim/emergency'))).toBe(true));
    expect(screen.queryByTestId('emergency-row-kim')).toBeNull();
  });

  it('a page the vault does not show the reader: none for them, never whether there is one', async () => {
    const v = vault({ role: 'teen' });
    saraPage(v);
    await unlocked(v, <EmergencyPage id="sara" name="Sara" />);
    expect(await screen.findByTestId('emergency-none')).toHaveTextContent('Sara’s emergency information isn’t shared with you.');
    expect(screen.queryByTestId('emergency-share')).toBeNull();
  });

  it('Share with a clinician: the parts ticked, for the hours chosen, with a PIN; then each link, and Take back asked first', async () => {
    const v = vault();
    saraPage(v);
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    await unlocked(v, <EmergencyPage id="sara" name="Sara" />);
    await fireEvent.press(await screen.findByTestId('emergency-share'));
    // Every part with something on it, ticked to begin with; a PIN to tell them; four hours.
    expect(screen.getByTestId('clinician-part-allergies').props.accessibilityState).toEqual({ checked: true });
    expect(screen.getByTestId('clinician-show-name-words')).toHaveTextContent(/doesn’t say whose it is, only that you sent it/);
    await fireEvent.press(screen.getByTestId('clinician-part-insurance'));
    await fireEvent.press(screen.getByTestId('clinician-hours-2'));
    await fireEvent.changeText(screen.getByTestId('clinician-label'), 'Dr Patel');
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByTestId('clinician-make'));
    expect(await screen.findByTestId('clinician-secret')).toHaveTextContent('4321');
    // Not selectable (0.19.0): only Copy puts it on the clipboard, and clears it in a minute.
    expect(screen.getByTestId('clinician-secret').props.selectable).toBeFalsy();
    const made = v.vault.state.emergencyLinks?.[0];
    expect(made?.fields).toEqual(['date_of_birth', 'blood_type', 'allergies', 'medications', 'emergency_contacts']);
    expect(made?.recipient_label).toBe('Dr Patel');
    expect(Date.parse(made?.expires_at ?? '') - Date.parse(made?.created_at ?? '')).toBe(2 * 3_600_000);
    await fireEvent.press(screen.getByTestId('clinician-send'));
    expect(share).toHaveBeenCalledWith({ message: `${ORIGIN}/s#${made?.token}` });
    await fireEvent.press(screen.getByTestId('clinician-done'));

    // The link, for the owner: what it shows and that nobody opened it yet.
    const id = made?.id ?? '';
    expect(await screen.findByTestId(`emergency-link-${id}`)).toHaveTextContent(/Dr Patel/);
    expect(screen.getByTestId(`emergency-link-${id}`)).toHaveTextContent(/Shows date of birth, blood type, allergies, medications, emergency contacts/);
    expect(screen.getByTestId(`emergency-link-${id}-unopened`)).toBeTruthy();
    // Taken back only once confirmed.
    await fireEvent.press(screen.getByTestId(`emergency-take-back-${id}`));
    await fireEvent.press(await screen.findByTestId('emergency-take-back-cancel'));
    expect(made?.revoked).toBe(false);
    await fireEvent.press(screen.getByTestId(`emergency-take-back-${id}`));
    await fireEvent.press(await screen.findByTestId('emergency-take-back-yes'));
    await waitFor(() => expect(made?.revoked).toBe(true));
    expect(await screen.findByTestId('emergency-said')).toHaveTextContent('The link is taken back.');
    expect(screen.getByTestId(`emergency-link-${id}`)).toHaveTextContent(/Taken back/);
    expect(screen.queryByTestId(`emergency-take-back-${id}`)).toBeNull();
  });

  it('the links that could not be read are said, with Try again; never taken for none', async () => {
    const v = vault();
    saraPage(v);
    let down = true;
    const inner = v.fetch;
    v.fetch = (url, init) =>
      down && url.endsWith('/members/sara/emergency/links') && init.method === 'GET'
        ? Promise.resolve(respond(500, { error: { code: 'internal_error', message: 'No.' } }))
        : inner(url, init);
    (v.vault.state.emergencyLinks ??= []).push({
      id: 'l1',
      member: 'sara',
      fields: ['allergies'],
      token: 'tok',
      pin: null,
      recipient_label: 'Dr Patel',
      created_by: 'fake-member',
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      revoked: false,
      openings: [],
    });
    await unlocked(v, <EmergencyPage id="sara" name="Sara" />);
    expect(await screen.findByTestId('emergency-links-failed')).toBeTruthy();
    expect(screen.queryByTestId('emergency-link-l1')).toBeNull();
    // What the page says is not selectable: nothing of it goes to a clipboard nobody clears.
    expect(screen.getByText('Penicillin · Rash').props.selectable).toBeFalsy();
    down = false;
    await fireEvent.press(screen.getByTestId('load-failed-retry'));
    expect(await screen.findByTestId('emergency-link-l1')).toBeTruthy();
    expect(screen.queryByTestId('emergency-links-failed')).toBeNull();
  });

  it('a paused or used-up link says so and can be taken back; an expired one cannot', async () => {
    const v = vault();
    saraPage(v);
    const link = (id: string, state: string) => ({
      id,
      document_id: null,
      document_title: null,
      recipient_label: id,
      created_by_name: 'Fake Owner',
      created_at: '2026-11-16T08:00:00Z',
      expires_at: '2026-11-16T12:00:00Z',
      has_pin: false,
      open_count: 0,
      last_opened_at: null,
      state,
      flow: 'v2',
      permission: 'view',
      protection: [],
      summary: 'Shared by link',
      emergency_fields: ['allergies'],
      openings: [],
    });
    const inner = v.fetch;
    v.fetch = (url, init) =>
      url.endsWith('/members/sara/emergency/links') && init.method === 'GET'
        ? Promise.resolve(respond(200, { items: [link('p', 'paused'), link('u', 'used_up'), link('x', 'expired'), link('r', 'revoked')] }))
        : inner(url, init);
    await unlocked(v, <EmergencyPage id="sara" name="Sara" />);
    expect(await screen.findByTestId('emergency-link-p')).toHaveTextContent(/Paused/);
    expect(screen.getByTestId('emergency-link-u')).toHaveTextContent(/Used up/);
    expect(screen.getByTestId('emergency-link-x')).toHaveTextContent(/Ended/);
    expect(screen.getByTestId('emergency-link-r')).toHaveTextContent(/Taken back/);
    expect(screen.getByTestId('emergency-take-back-p')).toBeTruthy();
    expect(screen.getByTestId('emergency-take-back-u')).toBeTruthy();
    expect(screen.queryByTestId('emergency-take-back-x')).toBeNull();
    expect(screen.queryByTestId('emergency-take-back-r')).toBeNull();
  });

  it('one page that fails leaves the rest listed, and says so with Try again', async () => {
    const v = vault();
    saraPage(v);
    let down = true;
    const inner = v.fetch;
    v.fetch = (url, init) =>
      down && url.endsWith('/members/pat/emergency')
        ? Promise.resolve(respond(500, { error: { code: 'internal_error', message: 'No.' } }))
        : inner(url, init);
    await unlocked(v, <EmergencyPeople />);
    expect(await screen.findByTestId('emergency-person-sara')).toBeTruthy();
    expect(screen.getByTestId('emergency-people-some-failed')).toHaveTextContent(/Some people’s pages couldn’t be loaded/);
    down = false;
    await fireEvent.press(screen.getByTestId('emergency-people-retry'));
    await waitFor(() => expect(screen.queryByTestId('emergency-people-some-failed')).toBeNull());
    expect(screen.getByTestId('emergency-person-sara')).toBeTruthy();
  });

  it('an adult reading somebody else’s page shares nothing and sees no links', async () => {
    const v = vault({ role: 'adult' });
    saraPage(v);
    await unlocked(v, <EmergencyPage id="sara" name="Sara" />);
    await screen.findByTestId('emergency-allergies');
    expect(screen.queryByTestId('emergency-share')).toBeNull();
    expect(screen.queryByTestId('emergency-edit-open')).toBeNull();
    expect(screen.queryByTestId('emergency-who-open')).toBeNull();
    expect(screen.queryByTestId('emergency-links')).toBeNull();
  });
});

describe('health kinds and their reminders (H3)', () => {
  it('a kind’s own names for its dates: an advance directive was Signed', async () => {
    const v = vault();
    libraryDoc(v, {
      id: 'directive',
      title: 'Living will',
      type_key: 'advance_directive',
      category: 'medical',
      issued: { date: '2024-05-01', precision: 'day' },
      issued_by: 'Should not show',
    } as Partial<DocumentView> & { id: string });
    await unlocked(v, <DocumentDetail id="directive" />);
    const facts = await screen.findByTestId('document-facts');
    expect(facts).toHaveTextContent(/Signed/);
    expect(facts).not.toHaveTextContent(/Issued/);
    expect(facts).not.toHaveTextContent(/Should not show/);
  });

  it('a yearly review says so, offers no new scan, and is turned off only once confirmed', async () => {
    const review: ReminderView = {
      id: 'rv',
      document_id: 'directive',
      document_title: 'Living will',
      kind: 'manual',
      fire_at: '2026-11-16T00:00:00Z',
      lead_days: null,
      note: 'Yearly review',
      recurrence: 'annual',
      status: 'due',
      snoozed_until: null,
      label: 'Due today',
      review: true,
    };
    expect(reminderHeadline(review)).toBe('Yearly review · Due today');
    expect(offersNewScan(review)).toBe(false);
    expect(offersNewScan({ ...review, review: false, source: 'refill_date' })).toBe(false);

    const v = vault();
    libraryDoc(v, { id: 'directive', title: 'Living will', type_key: 'advance_directive' });
    v.reminders = [review];
    await unlocked(v, <AttentionScreen />);
    expect(await screen.findByText('Yearly review · Due today')).toBeTruthy();
    expect(screen.queryByTestId('note-rv')).toBeNull();
    expect(screen.queryByTestId('scan-new-directive')).toBeNull();
    await fireEvent.press(screen.getByTestId('remove-rv'));
    expect(await screen.findByTestId('remove-question')).toHaveTextContent(/Turn off the yearly review\?/);
    await fireEvent.press(screen.getByTestId('remove-cancel'));
  });
});

describe('health records kept as they are (H5)', () => {
  it('never drawn: no picture, pages or Show; it says there is no preview, and Save a copy is there', async () => {
    const v = vault();
    libraryDoc(
      v,
      { id: 'ccda', title: 'Visit record', type_key: 'visit_summary', is_essential: true },
      { mime: 'application/xml', filename: 'visit.xml', stored_as_is: true, preview_pages: 0, page_count: null } as never,
    );
    await unlocked(v, <DocumentDetail id="ccda" />);
    expect(await screen.findByTestId('document-no-preview')).toHaveTextContent(
      /^No preview\. This is an XML file \(such as C-CDA\), kept as it is: .* Save a copy to open it/,
    );
    expect(screen.queryByTestId('document-pages')).toBeNull();
    expect(screen.queryByTestId('document-show')).toBeNull();
    expect(screen.getByTestId('document-save')).toBeTruthy();
    expect(audit()).toEqual([]);
  });

  it('an older version kept as it is has no pages to open', async () => {
    const v = vault();
    libraryDoc(v, { id: 'scan', title: 'MRI', type_key: 'imaging_report', versions: 2, latest_version_id: 'scan-v2' });
    v.library.versions.set('scan', [
      {
        id: 'scan-v1',
        document_id: 'scan',
        version_no: 1,
        filename: 'mri.zip',
        mime: 'application/zip',
        byte_size: 10,
        sha256: 'x',
        page_count: null,
        ocr_status: 'skipped',
        uploaded_at: '2026-10-01T00:00:00Z',
        preview_pages: 0,
        stored_as_is: true,
      } as never,
      {
        id: 'scan-v2',
        document_id: 'scan',
        version_no: 2,
        filename: 'mri.pdf',
        mime: 'application/pdf',
        byte_size: 10,
        sha256: 'y',
        page_count: 1,
        ocr_status: 'done',
        uploaded_at: '2026-11-01T00:00:00Z',
        preview_pages: 1,
      } as never,
    ]);
    await unlocked(v, <DocumentDetail id="scan" />);
    await fireEvent.press(await screen.findByTestId('document-versions'));
    expect(await screen.findByTestId('version-1-no-preview')).toHaveTextContent('No preview: kept as it is.');
    expect(screen.queryByTestId('version-1-pages')).toBeNull();
    expect(screen.getByTestId('document-pages')).toBeTruthy();
  });
});
