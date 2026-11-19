import type { EmergencyFields } from '@fdv/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { PDFDocument } from 'pdf-lib';
import { copySettings, saveCopyIo } from '../documents/save-copy';
import { chosenToStart, draftChanged, draftOf, losing, newEntryId, readDraft, withNew, withPart } from '../emergency/edit-model';
import { EmergencyEditor } from '../emergency/editor';
import { EmergencyPage } from '../emergency/page';
import { buildWalletCard, layRows, lettersNotOnTheCard, wrap } from '../emergency/wallet-pdf';
import { audit } from '../test-support/a11y';
import { unlocked } from '../test-support/lookup';
import { installed, respond } from '../test-support/render';
import { push, resetRoutes, routes } from '../test-support/router';
import { caps0519, capabilities, testVault, type TestVault } from '../test-support/vault';

jest.mock(
  'expo-router',
  () => jest.requireActual<typeof import('../test-support/router')>('../test-support/router').routerMock,
);

const ORIGIN = 'https://vault.test';

/** What went to the share sheet: its name, kind and bytes. */
let shared: { name: string; mime: string; bytes: Uint8Array }[] = [];
/** Each copy taken off the phone again. */
let removed: string[] = [];

beforeEach(() => {
  installed();
  resetRoutes();
  copySettings.graceMs = 0;
  shared = [];
  const written = new Map<string, { name: string; bytes: Uint8Array }>();
  jest.spyOn(saveCopyIo, 'write').mockImplementation(async (name, bytes) => {
    const uri = `cache:/copies/${name}`;
    written.set(uri, { name, bytes });
    return uri;
  });
  jest.spyOn(saveCopyIo, 'share').mockImplementation(async (uri, mime) => {
    const f = written.get(uri);
    shared.push({ name: f?.name ?? uri, mime, bytes: f?.bytes ?? new Uint8Array() });
  });
  removed = [];
  jest.spyOn(saveCopyIo, 'remove').mockImplementation(async (uri) => void removed.push(uri));
});
afterEach(() => jest.restoreAllMocks());

/**
 * A vault of 0.9.0-dev.66 with emergency information (H4). The family: the
 * fake's owner (signed in, unless `role`), Pat (an adult), Kim (a teen),
 * Sara (no sign-in, a child).
 */
function vault(role?: 'owner' | 'adult' | 'teen'): TestVault {
  const v = testVault([ORIGIN]);
  v.caps = capabilities({
    server_version: '0.9.0-dev.66',
    features: { ...caps0519().features, notes: true, health_kinds: true, emergency_info: true },
  });
  v.vault.state.members.push(
    { id: 'pat', display_name: 'Pat', role: 'adult', is_me: false } as never,
    { id: 'kim', display_name: 'Kim', role: 'teen', is_me: false } as never,
    { id: 'sara', display_name: 'Sara', is_me: false, date_of_birth: '2019-04-02' } as never,
  );
  if (role) v.vault.state.role = role;
  return v;
}

/** Sara's page, as an owner wrote it, at version 2. */
function saraPage(v: TestVault, fields: EmergencyFields = SARA) {
  (v.vault.state.emergency ??= []).push({
    member: 'sara',
    fields,
    audience: 'adults',
    chosen: [],
    version: 2,
    updated_at: '2026-11-15T10:00:00Z',
  });
}

const SARA: EmergencyFields = {
  blood_type: 'O+',
  allergies: [{ id: 'a1', name: 'Penicillin', note: 'Rash' }],
  medications: [
    { id: 'm1', name: 'Salbutamol', dose: '2 puffs as needed' },
    { id: 'm2', name: 'Cetirizine', dose: '5 mg' },
  ],
  emergency_contacts: [{ id: 'c1', name: 'Pat', role: 'Parent', phone: '07700 900123' }],
  insurance: { insurer: 'Aviva', member_id: 'AV-123' },
};

const page = (v: TestVault, member = 'sara') => v.vault.state.emergency?.find((p) => p.member === member);

/** Each If-Match the phone sent with a page, in order. */
function ifMatches(v: TestVault): (string | undefined)[] {
  const seen: (string | undefined)[] = [];
  const inner = v.fetch;
  v.fetch = (url, init) => {
    if (init.method === 'PUT' && /\/members\/[^/]+\/emergency$/.test(url)) seen.push(init.headers?.['if-match']);
    return inner(url, init);
  };
  return seen;
}

const value = (id: string) => screen.getByTestId(id).props.value as string;

describe('the editor’s rules', () => {
  it('a page read into the form and back is the page; blanks left out; nothing changed is no change', () => {
    const d = draftOf(SARA);
    expect(draftChanged(d, SARA)).toBe(false);
    const out = readDraft(d);
    expect(out.fields).toEqual({
      blood_type: 'O+',
      notes: null,
      insurance: { insurer: 'Aviva', member_id: 'AV-123', group_number: null, phone: null },
      allergies: [{ id: 'a1', name: 'Penicillin', note: 'Rash' }],
      medications: [
        { id: 'm1', name: 'Salbutamol', dose: '2 puffs as needed' },
        { id: 'm2', name: 'Cetirizine', dose: '5 mg' },
      ],
      conditions: [],
      doctors: [],
      emergency_contacts: [{ id: 'c1', name: 'Pat', role: 'Parent', phone: '07700 900123' }],
    });
    // A new entry left empty is no change, and is left out.
    const added = withNew(d, 'conditions');
    expect(draftChanged(added, SARA)).toBe(false);
    expect(readDraft(added).fields?.conditions).toEqual([]);
    // Typed but not named: said, nothing sent.
    const id = added.lists.conditions[0]?.id ?? '';
    const unnamed = withPart(added, 'conditions', id, 'note', 'Since 2022');
    expect(readDraft(unnamed)).toEqual({ fields: null, unnamed: [{ key: 'conditions', id }] });
    // Spaces are not words.
    expect(draftChanged(withPart(d, 'allergies', 'a1', 'name', ' Penicillin '), SARA)).toBe(false);
    expect(newEntryId()).toMatch(/^[A-Za-z0-9_-]{1,40}$/);
  });

  it('who a choice takes the page from, and who can no longer be named', () => {
    const people = [
      { member_id: 'pat', role: 'adult' as const },
      { member_id: 'kim', role: 'teen' as const },
    ];
    expect(losing({ audience: 'family', chosen: [] }, { audience: 'adults', chosen: [] }, people)).toEqual(['kim']);
    expect(losing({ audience: 'adults', chosen: [] }, { audience: 'owners_and_self', chosen: ['pat'] }, people)).toEqual([]);
    expect(losing({ audience: 'owners_and_self', chosen: ['kim'] }, { audience: 'adults', chosen: [] }, people)).toEqual(['kim']);
    expect(losing({ audience: 'adults', chosen: [] }, { audience: 'family', chosen: [] }, people)).toEqual([]);
    expect(
      chosenToStart(
        [
          { member_id: 'kim', name: 'Kim' },
          { member_id: 'ann', name: 'Ann' },
        ],
        people,
      ),
    ).toEqual({ ids: ['kim'], dropped: ['Ann'] });
  });

  it('the wallet card as a PDF: one page for a card, more when it runs on; letters it can’t draw are said', async () => {
    const one = await buildWalletCard({
      heading: 'Emergency information',
      name: 'Sara',
      continued: '(continued)',
      rows: [{ label: 'Allergies', lines: ['Penicillin · Rash'] }],
      foot: 'Entered by the family. Not checked by a doctor, and not medical advice.',
    });
    expect(new TextDecoder().decode(one.slice(0, 5))).toBe('%PDF-');
    expect((await PDFDocument.load(one)).getPageCount()).toBe(1);
    const long = await buildWalletCard({
      heading: 'Emergency information',
      name: 'Sara',
      continued: '(continued)',
      rows: [{ label: 'Medications', lines: Array.from({ length: 160 }, (_, i) => `Medicine ${i} · twice a day`) }],
      foot: 'Not medical advice.',
    });
    expect((await PDFDocument.load(long)).getPageCount()).toBeGreaterThan(1);
    expect(await lettersNotOnTheCard(['Zoë’s card — O+', 'Peanuts 花生'])).toEqual(['花', '生']);
    // A line break starts a line on the card: never a "?", never run together.
    const fonts = await PDFDocument.create().then(async (d) => ({
      regular: await d.embedFont('Helvetica'),
      bold: await d.embedFont('Helvetica-Bold'),
    }));
    const [notes, allergies] = layRows(
      [
        { label: 'Other information', lines: ['Hard of hearing.\nSpeak slowly.\r\n\nCarries a pen.'] },
        { label: 'Allergies', lines: ['Penicillin · Rash\nsevere'] },
      ],
      fonts,
    );
    expect(notes?.value).toEqual(['Hard of hearing.', 'Speak slowly.', '', 'Carries a pen.']);
    expect(allergies?.value).toEqual(['Penicillin · Rash', 'severe']);
    expect([...(notes?.value ?? []), ...(allergies?.value ?? [])].join('')).not.toContain('?');
    const doc = await PDFDocument.create();
    const font = await doc.embedFont('Helvetica');
    expect(wrap('a verylongwordthatcannotfit', font, 8, 30).every((l) => font.widthOfTextAtSize(l, 8) <= 30)).toBe(true);
  });
});

describe('editing emergency information on the phone (0.19.0)', () => {
  it('an owner edits a child’s page: filled as it is, a part changed, an entry added, one removed when asked; saved with If-Match and said', async () => {
    const v = vault();
    saraPage(v);
    const sent = ifMatches(v);
    await unlocked(v, <EmergencyPage id="sara" name="Sara" />);
    expect(await screen.findByTestId('emergency-edit-open')).toHaveTextContent('Edit');
    // No longer sent to the web.
    expect(screen.queryByTestId('emergency-web')).toBeNull();
    await fireEvent.press(screen.getByTestId('emergency-edit-open'));
    expect(routes().at(-1)).toEqual({ pathname: '/emergency/edit/[id]', params: { id: 'sara', name: 'Sara' } });

    expect(await screen.findByTestId('emergency-edit-allergies-0-name')).toBeTruthy();
    expect(value('emergency-edit-allergies-0-name')).toBe('Penicillin');
    expect(value('emergency-edit-allergies-0-note')).toBe('Rash');
    expect(value('emergency-edit-medications-1-dose')).toBe('5 mg');
    expect(value('emergency-edit-insurance-insurer')).toBe('Aviva');
    expect(screen.getByTestId('emergency-edit-blood-O+').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByTestId('emergency-edit-lede')).toHaveTextContent(/Type it as Sara would say it\. Entered by the family/);
    expect(screen.getByTestId('emergency-edit-dob')).toHaveTextContent(/comes from the family’s details/);
    expect(audit()).toEqual([]);

    await fireEvent.press(screen.getByTestId('emergency-edit-blood-A+'));
    await fireEvent.press(screen.getByTestId('emergency-edit-add-conditions'));
    await fireEvent.changeText(screen.getByTestId('emergency-edit-conditions-0-name'), 'Asthma');
    await fireEvent.changeText(screen.getByTestId('emergency-edit-conditions-0-note'), 'Mild');
    expect(screen.getByTestId('emergency-edit-medications-0-remove').props.accessibilityLabel).toBe('Remove Salbutamol');
    // Removing an entry with anything in it is asked first; Cancel keeps it.
    await fireEvent.press(screen.getByTestId('emergency-edit-medications-0-remove'));
    expect(await screen.findByTestId('emergency-edit-ask')).toHaveTextContent(/Remove “Salbutamol”\?/);
    await fireEvent.press(screen.getByTestId('emergency-edit-ask-cancel'));
    expect(value('emergency-edit-medications-0-name')).toBe('Salbutamol');
    await fireEvent.press(screen.getByTestId('emergency-edit-medications-0-remove'));
    await fireEvent.press(await screen.findByTestId('emergency-edit-ask-yes'));
    expect(value('emergency-edit-medications-0-name')).toBe('Cetirizine');
    // Nothing goes until Save.
    expect(page(v)?.fields.medications).toHaveLength(2);

    await fireEvent.press(screen.getByTestId('emergency-edit-save'));
    await waitFor(() => expect(page(v)?.version).toBe(3));
    expect(sent).toEqual(['"2"']);
    expect(page(v)?.fields).toMatchObject({
      blood_type: 'A+',
      medications: [{ id: 'm2', name: 'Cetirizine', dose: '5 mg' }],
      conditions: [{ name: 'Asthma', note: 'Mild' }],
    });
    // Back on the page: said, and read again.
    expect(await screen.findByTestId('emergency-said')).toHaveTextContent('Saved.');
    expect(await screen.findByTestId('emergency-blood_type')).toHaveTextContent('Blood typeA+');
    expect(screen.getByTestId('emergency-conditions')).toHaveTextContent('ConditionsAsthma · Mild');
  });

  it('a page of one’s own with nothing on it: Add emergency information; an entry needs a name; a blank one goes without asking', async () => {
    const v = vault();
    await unlocked(v, <EmergencyPage id="fake-member" />);
    expect(await screen.findByTestId('emergency-empty')).toHaveTextContent(/so the people you choose can find them quickly\.$/);
    expect(screen.getByTestId('emergency-edit-open')).toHaveTextContent('Add emergency information');
    await fireEvent.press(screen.getByTestId('emergency-edit-open'));
    expect(await screen.findByTestId('emergency-edit-lede')).toHaveTextContent(/^Type it as you would say it\./);

    // Added and left empty: taken away at once.
    await fireEvent.press(screen.getByTestId('emergency-edit-add-allergies'));
    await fireEvent.press(screen.getByTestId('emergency-edit-allergies-0-remove'));
    expect(screen.queryByTestId('emergency-edit-ask')).toBeNull();
    expect(screen.queryByTestId('emergency-edit-allergies-0')).toBeNull();

    // A note typed with no name: said there, nothing sent.
    await fireEvent.press(screen.getByTestId('emergency-edit-add-allergies'));
    await fireEvent.changeText(screen.getByTestId('emergency-edit-allergies-0-note'), 'Hives');
    await fireEvent.press(screen.getByTestId('emergency-edit-save'));
    expect(await screen.findByTestId('emergency-edit-problem')).toHaveTextContent('Something above needs putting right first.');
    expect(screen.getByText('Give it a name, or leave the entry out.')).toBeTruthy();
    expect(page(v, 'fake-member')).toBeUndefined();

    await fireEvent.changeText(screen.getByTestId('emergency-edit-allergies-0-name'), 'Peanuts');
    await fireEvent.changeText(screen.getByTestId('emergency-edit-notes'), 'Carries an adrenaline pen.');
    await fireEvent.press(screen.getByTestId('emergency-edit-save'));
    await waitFor(() => expect(page(v, 'fake-member')?.version).toBe(1));
    expect(page(v, 'fake-member')?.fields).toMatchObject({
      allergies: [{ name: 'Peanuts', note: 'Hives' }],
      notes: 'Carries an adrenaline pen.',
    });
    expect(await screen.findByTestId('emergency-allergies')).toHaveTextContent('AllergiesPeanuts · Hives');
  });

  it('changed somewhere else meanwhile: what was typed stays, nothing of theirs written over until Save is pressed again', async () => {
    const v = vault();
    saraPage(v);
    const sent = ifMatches(v);
    push({ pathname: '/emergency/edit/[id]', params: { id: 'sara', name: 'Sara' } });
    await unlocked(v, <EmergencyEditor id="sara" name="Sara" />);
    await fireEvent.press(await screen.findByTestId('emergency-edit-blood-B+'));
    await fireEvent.changeText(screen.getByTestId('emergency-edit-notes'), 'A long note typed with care.');
    // Somebody else, on the web, meanwhile.
    const kept = page(v);
    if (kept) Object.assign(kept, { fields: { ...SARA, blood_type: 'AB-' }, version: 3 });
    await fireEvent.press(screen.getByTestId('emergency-edit-save'));
    expect(await screen.findByTestId('emergency-edit-problem')).toHaveTextContent(
      'Someone else changed this while you were editing. What you typed is still here: Save again puts it in place of their version, or Cancel and open it again to see theirs first.',
    );
    expect(page(v)?.fields.blood_type).toBe('AB-');
    expect(screen.getByTestId('emergency-edit-blood-B+').props.accessibilityState).toMatchObject({ selected: true });
    expect(value('emergency-edit-notes')).toBe('A long note typed with care.');
    // Saved again, knowingly, from the version now read.
    await fireEvent.press(screen.getByTestId('emergency-edit-save'));
    await waitFor(() => expect(page(v)?.version).toBe(4));
    expect(sent).toEqual(['"2"', '"3"']);
    expect(page(v)?.fields).toMatchObject({ blood_type: 'B+', notes: 'A long note typed with care.' });
  });

  it('changed somewhere else, and the page can’t be read again: the form stays as typed, and says why', async () => {
    const v = vault();
    saraPage(v);
    push({ pathname: '/emergency/edit/[id]', params: { id: 'sara', name: 'Sara' } });
    await unlocked(v, <EmergencyEditor id="sara" name="Sara" />);
    await fireEvent.changeText(await screen.findByTestId('emergency-edit-notes'), 'Kept, whatever happens.');
    const kept = page(v);
    if (kept) Object.assign(kept, { version: 3 });
    const inner = v.fetch;
    v.fetch = (url, init) =>
      init.method === 'GET' && url.endsWith('/members/sara/emergency')
        ? Promise.resolve(respond(500, { error: { code: 'internal_error', message: 'The vault had a problem.' } }))
        : inner(url, init);
    await fireEvent.press(screen.getByTestId('emergency-edit-save'));
    expect(await screen.findByTestId('emergency-edit-problem')).toHaveTextContent(/^Someone else changed this while you were editing\..+\S/);
    expect(value('emergency-edit-notes')).toBe('Kept, whatever happens.');
    expect(screen.getByTestId('emergency-edit-save')).toBeTruthy();
  });

  it('clearing a part is asked first: a list, the insurance; Cancel with something changed asks too', async () => {
    const v = vault();
    saraPage(v);
    push({ pathname: '/emergency/edit/[id]', params: { id: 'sara', name: 'Sara' } });
    await unlocked(v, <EmergencyEditor id="sara" name="Sara" />);
    // One allergy is removed on its own; two medications can be cleared at once.
    expect(await screen.findByTestId('emergency-edit-clear-medications')).toBeTruthy();
    expect(screen.queryByTestId('emergency-edit-clear-allergies')).toBeNull();
    await fireEvent.press(screen.getByTestId('emergency-edit-clear-medications'));
    expect(await screen.findByTestId('emergency-edit-ask')).toHaveTextContent(/Clear Medications\?/);
    await fireEvent.press(screen.getByTestId('emergency-edit-ask-yes'));
    expect(screen.queryByTestId('emergency-edit-medications-0')).toBeNull();
    await fireEvent.press(screen.getByTestId('emergency-edit-clear-insurance'));
    await fireEvent.press(await screen.findByTestId('emergency-edit-ask-yes'));
    expect(value('emergency-edit-insurance-insurer')).toBe('');
    await fireEvent.press(screen.getByTestId('emergency-edit-cancel'));
    expect(await screen.findByTestId('emergency-edit-cancel-ask')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('emergency-edit-cancel-no'));
    await fireEvent.press(screen.getByTestId('emergency-edit-save'));
    await waitFor(() => expect(page(v)?.version).toBe(3));
    expect(page(v)?.fields.medications).toEqual([]);
    expect(page(v)?.fields.insurance).toBeNull();
  });

  it('Edit only where the vault allows it: an adult reads a child’s page; a teen edits their own but doesn’t choose who sees it', async () => {
    const adult = vault('adult');
    saraPage(adult);
    await unlocked(adult, <EmergencyPage id="sara" name="Sara" />);
    expect(await screen.findByTestId('emergency-blood_type')).toBeTruthy();
    expect(screen.queryByTestId('emergency-edit-open')).toBeNull();
    expect(screen.queryByTestId('emergency-who-open')).toBeNull();
    // Anybody who sees what is on it can print a card.
    expect(screen.getByTestId('emergency-wallet')).toBeTruthy();
    screen.unmount();

    // The editor reached anyway: told so, in the vault's words.
    resetRoutes();
    const again = vault('adult');
    saraPage(again);
    await unlocked(again, <EmergencyEditor id="sara" name="Sara" />);
    expect(await screen.findByTestId('emergency-edit-not-yours')).toHaveTextContent(
      'Only the person themselves, or an owner, can change their emergency information.',
    );
    screen.unmount();

    resetRoutes();
    const teen = vault('teen');
    await unlocked(teen, <EmergencyPage id="fake-member" />);
    expect(await screen.findByTestId('emergency-edit-open')).toBeTruthy();
    expect(screen.queryByTestId('emergency-who-open')).toBeNull();
  });

  it('with no connection, Save waits and says why; what was typed stays', async () => {
    const v = vault();
    saraPage(v);
    push({ pathname: '/emergency/edit/[id]', params: { id: 'sara', name: 'Sara' } });
    await unlocked(v, <EmergencyEditor id="sara" name="Sara" />);
    await fireEvent.changeText(await screen.findByTestId('emergency-edit-notes'), 'Hard of hearing');
    v.reachable.delete(ORIGIN);
    await fireEvent.press(screen.getByTestId('emergency-edit-save'));
    expect(await screen.findByTestId('emergency-edit-problem')).toBeTruthy();
    expect(page(v)?.version).toBe(2);
    expect(await screen.findByTestId('emergency-edit-needs-connection')).toHaveTextContent(
      'Changing it needs a connection to the vault. What you’ve typed stays here until you leave.',
    );
    expect(screen.getByTestId('emergency-edit-save').props.accessibilityState).toMatchObject({ disabled: true });
    expect(value('emergency-edit-notes')).toBe('Hard of hearing');
  });
});

describe('who can see it (0.19.0)', () => {
  it('an owner chooses for a child: the choices as the web’s, people named too; saved and said', async () => {
    const v = vault();
    saraPage(v);
    await unlocked(v, <EmergencyPage id="sara" name="Sara" />);
    await fireEvent.press(await screen.findByTestId('emergency-who-open'));
    expect(screen.getByTestId('emergency-who-always')).toHaveTextContent(
      'Sara and the owners always can, and so can a caregiver they keep.',
    );
    expect(screen.getByTestId('emergency-who-adults').props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByTestId('emergency-who-owners_and_self')).toHaveTextContent('Only them and the owners');
    expect(audit()).toEqual([]);
    expect(screen.queryByTestId('emergency-who-exports')).toBeNull();
    // Only them and the owners takes it from Pat, an adult: what that costs is said.
    await fireEvent.press(screen.getByTestId('emergency-who-owners_and_self'));
    expect(screen.getByTestId('emergency-who-exports')).toHaveTextContent(
      'Anyone who can no longer see it loses any export they made of it.',
    );
    await fireEvent.press(screen.getByTestId('emergency-who-person-kim'));
    await fireEvent.press(screen.getByTestId('emergency-who-save'));
    await waitFor(() => expect(page(v)?.audience).toBe('owners_and_self'));
    expect(page(v)?.chosen).toEqual(['kim']);
    expect(await screen.findByTestId('emergency-said')).toHaveTextContent('Who can see it is saved.');
    await waitFor(() =>
      expect(screen.getByTestId('emergency-who')).toHaveTextContent('Who can see it: Sara and the owners, and Kim.'),
    );
  });

  it('somebody named who can no longer be (now a viewer) is taken off, and said; the choice saves', async () => {
    const v = vault();
    v.vault.state.members.push({ id: 'ann', display_name: 'Ann', role: 'viewer', is_me: false } as never);
    saraPage(v);
    const kept = page(v);
    if (kept) kept.chosen = ['kim', 'ann'];
    await unlocked(v, <EmergencyPage id="sara" name="Sara" />);
    await fireEvent.press(await screen.findByTestId('emergency-who-open'));
    expect(screen.getByTestId('emergency-who-dropped')).toHaveTextContent('Ann can no longer be chosen and was taken off.');
    expect(screen.getByTestId('emergency-who-person-kim').props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.queryByTestId('emergency-who-person-ann')).toBeNull();
    await fireEvent.press(screen.getByTestId('emergency-who-save'));
    await waitFor(() => expect(page(v)?.chosen).toEqual(['kim']));
    expect(await screen.findByTestId('emergency-said')).toHaveTextContent('Who can see it is saved.');
  });

  it('the vault’s refusal is said in its words', async () => {
    const v = vault();
    saraPage(v);
    const inner = v.fetch;
    v.fetch = (url, init) =>
      init.method === 'PUT' && url.endsWith('/members/sara/emergency/audience')
        ? Promise.resolve(
            respond(422, {
              error: { code: 'validation_failed', message: 'Choose people of the family who sign in as an adult or a teen.' },
            }),
          )
        : inner(url, init);
    await unlocked(v, <EmergencyPage id="sara" name="Sara" />);
    await fireEvent.press(await screen.findByTestId('emergency-who-open'));
    await fireEvent.press(screen.getByTestId('emergency-who-person-pat'));
    await fireEvent.press(screen.getByTestId('emergency-who-save'));
    expect(await screen.findByTestId('emergency-who-problem')).toHaveTextContent(/Choose people of the family/);
    expect(page(v)?.chosen).toEqual([]);
  });
});

describe('the wallet card (0.19.0)', () => {
  it('ticked as the web ticks it, shown, and shared as a PDF to print; nothing on it but the paper', async () => {
    const v = vault();
    saraPage(v, { ...SARA, allergies: [{ id: 'a1', name: 'Peanuts 花生' }] });
    await unlocked(v, <EmergencyPage id="sara" name="Sara" />);
    await fireEvent.press(await screen.findByTestId('emergency-wallet'));
    // What a stranger needs first, ticked to begin with; insurance not.
    expect(screen.getByTestId('wallet-part-allergies').props.accessibilityState).toEqual({ checked: true });
    expect(screen.getByTestId('wallet-part-insurance').props.accessibilityState).toEqual({ checked: false });
    expect(screen.getByTestId('wallet-preview-medications')).toHaveTextContent(/Salbutamol · 2 puffs as needed/);
    expect(screen.queryByTestId('wallet-preview-insurance')).toBeNull();
    expect(await screen.findByTestId('wallet-letters')).toHaveTextContent(/花 生/);
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByTestId('wallet-part-insurance'));
    expect(screen.getByTestId('wallet-preview-insurance')).toHaveTextContent(/Aviva/);
    await fireEvent.press(screen.getByTestId('wallet-part-allergies'));
    expect(screen.queryByTestId('wallet-preview-allergies')).toBeNull();
    await waitFor(() => expect(screen.queryByTestId('wallet-letters')).toBeNull());

    await fireEvent.press(screen.getByTestId('wallet-share'));
    await waitFor(() => expect(shared).toHaveLength(1));
    expect(shared[0]?.name).toBe('Wallet card.pdf');
    expect(shared[0]?.mime).toBe('application/pdf');
    // Handed over, then taken off the phone again.
    await waitFor(() => expect(removed).toEqual(['cache:/copies/Wallet card.pdf']));
    const pdf = await PDFDocument.load(shared[0]?.bytes ?? new Uint8Array(), { updateMetadata: false });
    expect(pdf.getPageCount()).toBe(1);
    // Nothing of the vault's, nor about the phone: no link, title, author, producer, creator or dates.
    expect(pdf.getTitle()).toBeUndefined();
    expect(pdf.getAuthor()).toBeUndefined();
    expect(pdf.getProducer()).toBeUndefined();
    expect(pdf.getCreator()).toBeUndefined();
    expect(pdf.getCreationDate()).toBeUndefined();
    expect(pdf.getModificationDate()).toBeUndefined();
    expect(Buffer.from(shared[0]?.bytes ?? new Uint8Array()).toString('latin1')).not.toMatch(/vault\.test|\/URI/);

    // Nothing ticked: nothing to make.
    for (const k of ['date_of_birth', 'blood_type', 'medications', 'insurance', 'emergency_contacts']) {
      await fireEvent.press(screen.getByTestId(`wallet-part-${k}`));
    }
    expect(screen.getByTestId('wallet-preview-empty')).toBeTruthy();
    expect(screen.getByTestId('wallet-share').props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('the share sheet failing: said, and the copy taken off the phone at once', async () => {
    const v = vault();
    saraPage(v);
    jest.spyOn(saveCopyIo, 'share').mockRejectedValue(new Error('no share sheet'));
    await unlocked(v, <EmergencyPage id="sara" name="Sara" />);
    await fireEvent.press(await screen.findByTestId('emergency-wallet'));
    await fireEvent.press(screen.getByTestId('wallet-share'));
    expect(await screen.findByTestId('wallet-problem')).toHaveTextContent('The card couldn’t be made. Try again.');
    await waitFor(() => expect(removed).toEqual(['cache:/copies/Wallet card.pdf']));
  });
});
