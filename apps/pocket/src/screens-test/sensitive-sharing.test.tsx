import {
  DOWNLOAD_KEEPS_DETAILS,
  SENSITIVE_FOLLOW_CONFIRM,
  SENSITIVE_ONLY_ME_NOTE,
  SENSITIVE_SHARE_CONFIRM,
  sensitiveCollectionShareConfirm,
  sensitiveResumeConfirm,
  SHOW_TITLE_COLLECTION_HINT,
  SHOW_TITLE_SENSITIVE_HINT,
  type DocumentTypeView,
  type DocumentView,
  type SearchHit,
} from '@fdv/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useEffect, useRef, useState } from 'react';
import { Text } from 'react-native';
import SearchScreen from '../app/(tabs)/documents';
import CaptureScreen from '../app/capture';
import CollectionScreen from '../app/collection/[id]';
import EditScreen from '../app/edit/[id]';
import SharingScreen from '../app/sharing';
import { fixtureScanner } from '../capture/scanner';
import { chooseOwner, chooseType, newDraft, startsOnlyMe, toMetadata, visibilityOf, type Household } from '../capture/draft';
import { DocumentDetail } from '../documents/detail';
import { useCapture } from '../state/capture';
import { useVault } from '../state/vault';
import { audit } from '../test-support/a11y';
import { jpeg } from '../test-support/capture';
import { libraryDoc, openSearch, unlocked } from '../test-support/lookup';
import { installed, renderApp, signedIn, testCapture } from '../test-support/render';
import { push, resetRoutes, routes } from '../test-support/router';
import { caps0519, capabilities, testVault, type TestVault } from '../test-support/vault';

jest.mock(
  'expo-router',
  () => jest.requireActual<typeof import('../test-support/router')>('../test-support/router').routerMock,
);

/**
 * What Sensitive protects, on the phone (the vault's H1a, 0.9.0-dev.41):
 * asked before a sensitive document goes outside the family — a link to
 * it, a collection's link with it ticked, a collection whose link keeps up
 * with it, a paused link turned back on — with `confirm_sensitive` sent
 * once asked; its title off the link page unless shown; a document made
 * sensitive while shared, saved and then asked about its links; and a
 * teen's own sensitive paper starting as Only me. An older vault: as before.
 */

const ORIGIN = 'https://vault.test';
const PASSWORD = 'correct horse battery staple';

beforeEach(() => {
  installed();
  resetRoutes();
});

/** A vault of 0.9.0-dev.41 (`older`: one of dev.40, without what Sensitive protects). */
function vault(older = false): TestVault {
  const t = testVault([ORIGIN]);
  t.caps = capabilities({
    server_version: older ? '0.9.0-dev.40' : '0.9.0-dev.41',
    features: {
      ...caps0519().features,
      collections: true,
      notes: true,
      share_options: true,
      share_second_factor: true,
      collection_shares: true,
      share_reveal: true,
      document_table: true,
      document_filters: true,
      sensitive_documents: true,
      ...(older ? {} : { sensitive_protects: true }),
    },
  });
  return t;
}

/** A passport, sensitive by its kind, as the vault says it. */
const passport = (t: TestVault) =>
  libraryDoc(t, { id: 'passport', title: 'Passport', type_key: 'passport', sensitive: null, sensitive_effective: true } as never);

/** Its page, its ⋯, then Share. */
async function openShare(t: TestVault, id: string) {
  await unlocked(t, <DocumentDetail id={id} />);
  await fireEvent.press(await screen.findByTestId('document-more'));
  await fireEvent.press(await screen.findByTestId('document-share'));
  await screen.findByTestId('share-label');
}

describe('a link to a sensitive document', () => {
  it('asks first, in the web’s words; its title is off the link page unless shown; then the link, said as asked', async () => {
    const t = vault();
    passport(t);
    t.library.asksSensitive.set('share:passport', SENSITIVE_SHARE_CONFIRM);
    await openShare(t, 'passport');
    // Off for a sensitive document, and why; and that a file keeps its own details.
    const titled = screen.getByTestId('share-show-title');
    expect(titled.props.value).toBe(false);
    expect(titled.props.accessibilityLabel).toBe('Show its title on the link page');
    expect(screen.getByTestId('share-show-title-hint')).toHaveTextContent(SHOW_TITLE_SENSITIVE_HINT);
    expect(screen.getByTestId('share-download-keeps')).toHaveTextContent(DOWNLOAD_KEEPS_DETAILS);
    expect(audit()).toEqual([]);

    // Cancel is an answer: nothing is sent, and the form is back as it was.
    await fireEvent.press(screen.getByTestId('share-make'));
    expect(await screen.findByText('Share a sensitive document?')).toBeTruthy();
    expect(screen.getByText(SENSITIVE_SHARE_CONFIRM)).toBeTruthy();
    expect(screen.queryByTestId('share-make')).toBeNull();
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByTestId('share-sensitive-cancel'));
    expect(await screen.findByTestId('share-make')).toBeTruthy();
    expect(t.library.shareBodies).toEqual([]);
    expect(t.calls.some((c) => c.includes('/documents/passport/share'))).toBe(false);

    // Share it anyway: sent once, with the flag, and no title said (the vault's own rule keeps it off).
    await fireEvent.press(screen.getByTestId('share-make'));
    await fireEvent.press(await screen.findByTestId('share-sensitive-yes'));
    expect(await screen.findByTestId('share-send')).toBeTruthy();
    expect(t.library.shareBodies).toHaveLength(1);
    expect(t.library.shareBodies[0]?.body).toMatchObject({ confirm_sensitive: true });
    expect(t.library.shareBodies[0]?.body).not.toHaveProperty('show_title');
    expect(t.calls.filter((c) => c.includes('/documents/passport/share'))).toHaveLength(1);
  });

  it('its title shown, when chosen', async () => {
    const t = vault();
    passport(t);
    await openShare(t, 'passport');
    await fireEvent(screen.getByTestId('share-show-title'), 'valueChange', true);
    await fireEvent.press(screen.getByTestId('share-make'));
    await fireEvent.press(await screen.findByTestId('share-sensitive-yes'));
    await screen.findByTestId('share-send');
    expect(t.library.shareBodies[0]?.body).toMatchObject({ show_title: true, confirm_sensitive: true });
  });

  it('a document the phone did not know was sensitive: the vault’s 409 asks its question, then the link is made again', async () => {
    const t = vault();
    libraryDoc(t, { id: 'gp', title: 'GP letter', type_key: 'medical_record', sensitive: null, sensitive_effective: false } as never);
    const question = 'This document is sensitive. A link lets somebody outside the family open it. Share it anyway?';
    t.library.asksSensitive.set('share:gp', question);
    await openShare(t, 'gp');
    // Not sensitive, as far as the phone knows: its title shows, and nothing is said under it.
    expect(screen.getByTestId('share-show-title').props.value).toBe(true);
    expect(screen.queryByTestId('share-show-title-hint')).toBeNull();
    await fireEvent.press(screen.getByTestId('share-make'));
    expect(await screen.findByText(question)).toBeTruthy();
    expect(t.library.shareBodies).toEqual([]);
    await fireEvent.press(screen.getByTestId('share-sensitive-yes'));
    expect(await screen.findByTestId('share-send')).toBeTruthy();
    expect(t.library.confirmedSensitive).toEqual(['share:gp']);
    expect(t.library.shareBodies[0]?.body).toMatchObject({ confirm_sensitive: true });
    expect(t.library.shareBodies[0]?.body).not.toHaveProperty('show_title');
  });

  it('a document not sensitive: nothing asked, its title shows, and unticked it is sent hidden', async () => {
    const t = vault();
    libraryDoc(t, { id: 'bill', title: 'Water bill', type_key: 'utility_bill', sensitive: null, sensitive_effective: false } as never);
    await openShare(t, 'bill');
    await fireEvent(screen.getByTestId('share-show-title'), 'valueChange', false);
    await fireEvent.press(screen.getByTestId('share-make'));
    expect(await screen.findByTestId('share-send')).toBeTruthy();
    expect(screen.queryByTestId('share-sensitive')).toBeNull();
    expect(t.library.shareBodies[0]?.body).toMatchObject({ show_title: false });
    expect(t.library.shareBodies[0]?.body).not.toHaveProperty('confirm_sensitive');
  });

  it('an older vault: no question, no title choice, nothing new sent', async () => {
    const t = vault(true);
    passport(t);
    await openShare(t, 'passport');
    expect(screen.queryByTestId('share-show-title')).toBeNull();
    expect(screen.queryByTestId('share-download-keeps')).toBeNull();
    await fireEvent.press(screen.getByTestId('share-make'));
    expect(await screen.findByTestId('share-send')).toBeTruthy();
    expect(t.library.shareBodies[0]?.body).not.toHaveProperty('confirm_sensitive');
    expect(t.library.shareBodies[0]?.body).not.toHaveProperty('show_title');
  });
});

/** A collection as the client's fake keeps one: for everyone, made by the person signed in. */
function collection(t: TestVault, id: string, name: string, ids: string[] = []) {
  t.vault.state.collections.push({
    id,
    name,
    description: null,
    audience: 'everyone',
    owner_member_id: 'fake-member',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    revision: 1,
    deleted: false,
    items: ids.map((document_id) => ({ document_id, added_at: '2026-09-02T00:00:00Z' })),
  } as never);
}

describe('a collection’s link with a sensitive document ticked', () => {
  it('says which are sensitive, asks how many first, then confirms it is you; the title choice off, for later ones too', async () => {
    const t = vault();
    collection(t, 'hol', 'Holiday');
    t.library.sharePreviews.set('hol', {
      collection_id: 'hol',
      collection_name: 'Holiday',
      audience: 'everyone',
      items: [
        { document_id: 'p1', title: 'Passport', type_label: 'Passport', ticked: true, lock: null, reason: null, viewable: true, sensitive: true },
        { document_id: 'b1', title: 'Water bill', type_label: 'Bill', ticked: true, lock: null, reason: null, viewable: true, sensitive: false },
      ],
    });
    t.library.asksSensitive.set('share:hol', sensitiveCollectionShareConfirm(1));
    push({ pathname: '/collection/[id]', params: { id: 'hol' } });
    await unlocked(t, <CollectionScreen />);
    await fireEvent.press(await screen.findByTestId('collection-more'));
    await fireEvent.press(await screen.findByTestId('collection-share'));
    expect(await screen.findByTestId('share-item-sensitive-p1')).toHaveTextContent('Sensitive');
    expect(screen.queryByTestId('share-item-sensitive-b1')).toBeNull();
    expect(screen.getByTestId('share-show-title').props.value).toBe(false);
    expect(screen.getByTestId('share-show-title-hint')).toHaveTextContent(SHOW_TITLE_COLLECTION_HINT);
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByTestId('share-make'));
    expect(await screen.findByText('Share sensitive documents?')).toBeTruthy();
    expect(screen.getByText(sensitiveCollectionShareConfirm(1))).toBeTruthy();
    await fireEvent.press(screen.getByTestId('share-sensitive-yes'));
    await fireEvent.changeText(await screen.findByTestId('step-up-password'), PASSWORD);
    await fireEvent.press(screen.getByTestId('step-up-go'));
    expect(await screen.findByTestId('share-reveal')).toBeTruthy();
    expect(t.library.shareBodies[0]?.body).toMatchObject({ document_ids: ['p1', 'b1'], confirm_sensitive: true });
    expect(t.library.shareBodies[0]?.body).not.toHaveProperty('show_title');
  });

  it('none sensitive ticked: nothing asked, and no title choice until it keeps up with the collection', async () => {
    const t = vault();
    collection(t, 'acc', 'Accountant');
    t.library.sharePreviews.set('acc', {
      collection_id: 'acc',
      collection_name: 'Accountant',
      audience: 'everyone',
      items: [
        { document_id: 'p1', title: 'Passport', type_label: 'Passport', ticked: false, lock: null, reason: null, viewable: true, sensitive: true },
        { document_id: 'b1', title: 'Water bill', type_label: 'Bill', ticked: true, lock: null, reason: null, viewable: true, sensitive: false },
      ],
    });
    push({ pathname: '/collection/[id]', params: { id: 'acc' } });
    await unlocked(t, <CollectionScreen />);
    await fireEvent.press(await screen.findByTestId('collection-more'));
    await fireEvent.press(await screen.findByTestId('collection-share'));
    await screen.findByTestId('share-item-b1');
    expect(screen.queryByTestId('share-show-title')).toBeNull();
    await fireEvent(screen.getByTestId('share-follow'), 'valueChange', true);
    await fireEvent(await screen.findByTestId('share-show-title'), 'valueChange', true);
    await fireEvent.press(screen.getByTestId('share-make'));
    await fireEvent.changeText(await screen.findByTestId('step-up-password'), PASSWORD);
    await fireEvent.press(screen.getByTestId('step-up-go'));
    expect(await screen.findByTestId('share-reveal')).toBeTruthy();
    expect(t.library.shareBodies[0]?.body).toMatchObject({ follow_collection: true, show_title: true });
    expect(t.library.shareBodies[0]?.body).not.toHaveProperty('confirm_sensitive');
  });
});

/** In the vault's lists too, as the client's fake keeps documents. */
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

const hit = (doc: DocumentView): SearchHit =>
  ({
    document_id: doc.id,
    title: doc.title,
    type_key: doc.type_key,
    category: 'identity',
    owner_member_id: doc.owner_member_id,
    status: doc.status,
    snippet: '',
    matched_in: 'title',
  }) as SearchHit;

describe('putting a sensitive document in a collection whose link keeps up with it', () => {
  it('from its ⋯: the vault’s question, then put in with the flag; Cancel puts nothing in', async () => {
    const t = vault();
    const doc = listed(t, passport(t));
    collection(t, 'trip', 'Trip');
    t.library.asksSensitive.set('items:trip', SENSITIVE_FOLLOW_CONFIRM);
    t.library.search = () => ({ items: [hit(doc)], sealed: 0 });
    await unlocked(t, <SearchScreen />);
    await openSearch();
    await fireEvent.changeText(await screen.findByTestId('search-field'), 'passport');
    await fireEvent.press(await screen.findByTestId('doc-menu-passport'));
    await fireEvent.press(await screen.findByTestId('row-sheet-collect'));
    await fireEvent.press(await screen.findByTestId('row-collection-add-trip'));
    expect(await screen.findByText('Put a sensitive document in?')).toBeTruthy();
    expect(screen.getByText(SENSITIVE_FOLLOW_CONFIRM)).toBeTruthy();
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByTestId('row-collect-sensitive-cancel'));
    expect(await screen.findByTestId('row-collection-add-trip')).toBeTruthy();
    expect(t.vault.state.collections[0]?.items).toEqual([]);

    await fireEvent.press(screen.getByTestId('row-collection-add-trip'));
    await fireEvent.press(await screen.findByTestId('row-collect-sensitive-yes'));
    expect(await screen.findByTestId('row-sheet-said')).toHaveTextContent('“Passport” is in “Trip” now.');
    expect(t.library.confirmedSensitive).toEqual(['items:trip']);
    expect(t.vault.state.collections[0]?.items.map((i) => i.document_id)).toEqual(['passport']);
  });

  it('from the collection’s Add documents: the same', async () => {
    const t = vault();
    listed(t, passport(t));
    collection(t, 'trip', 'Trip');
    t.library.asksSensitive.set('items:trip', SENSITIVE_FOLLOW_CONFIRM);
    push({ pathname: '/collection/[id]', params: { id: 'trip' } });
    await unlocked(t, <Text>Collections</Text>);
    await fireEvent.press(await screen.findByTestId('collection-add'));
    await fireEvent.press(await screen.findByTestId('add-documents-passport'));
    await fireEvent.press(screen.getByTestId('add-documents-add'));
    expect(await screen.findByText(SENSITIVE_FOLLOW_CONFIRM)).toBeTruthy();
    expect(screen.queryByTestId('add-documents-add')).toBeNull();
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByTestId('add-documents-sensitive-yes'));
    expect(await screen.findByTestId('collection-said')).toHaveTextContent('1 document is in “Trip” now.');
    expect(t.library.confirmedSensitive).toEqual(['items:trip']);
    expect(t.vault.state.collections[0]?.items.map((i) => i.document_id)).toEqual(['passport']);
  });
});

describe('Sharing, in More: a link a restore paused, turned back on', () => {
  const paused = (t: TestVault) =>
    t.library.shares.push({
      id: 'p1',
      document_id: 'passport',
      document_title: 'Passport',
      recipient_label: 'Dr Patel',
      created_by_name: 'Fake Owner',
      created_at: '2026-11-10T10:00:00Z',
      expires_at: '2030-11-17T10:00:00Z',
      has_pin: false,
      open_count: 0,
      last_opened_at: null,
      state: 'paused',
      paused_reason: 'restored',
      summary: 'A link',
    } as never);

  it('one giving a sensitive document asks first, in the vault’s words, then works again', async () => {
    const t = vault();
    paused(t);
    t.library.asksSensitive.set('resume:p1', sensitiveResumeConfirm(1));
    await unlocked(t, <SharingScreen />);
    const resume = await screen.findByTestId('sharing-resume-p1');
    expect(resume.props.accessibilityLabel).toBe('Turn the link to Passport back on');
    expect(audit()).toEqual([]);
    await fireEvent.press(resume);
    expect(await screen.findByText('Turn on a link to sensitive documents?')).toBeTruthy();
    expect(screen.getByText(sensitiveResumeConfirm(1))).toBeTruthy();
    await fireEvent.press(screen.getByTestId('sharing-resume-sensitive-cancel'));
    await waitFor(() => expect(screen.queryByTestId('sharing-resume-sensitive-yes')).toBeNull());
    expect(t.library.shares[0]?.state).toBe('paused');

    await fireEvent.press(screen.getByTestId('sharing-resume-p1'));
    await fireEvent.press(await screen.findByTestId('sharing-resume-sensitive-yes'));
    expect(await screen.findByTestId('sharing-said')).toHaveTextContent('The link to “Passport” works again.');
    expect(t.library.confirmedSensitive).toEqual(['resume:p1']);
    expect(t.library.shares[0]?.state).toBe('active');
    expect(screen.queryByTestId('sharing-resume-p1')).toBeNull();
  });

  it('one giving nothing sensitive is turned back on with nothing asked', async () => {
    const t = vault();
    paused(t);
    await unlocked(t, <SharingScreen />);
    await fireEvent.press(await screen.findByTestId('sharing-resume-p1'));
    expect(await screen.findByTestId('sharing-said')).toHaveTextContent(/works again/);
    expect(t.library.confirmedSensitive).toEqual([]);
  });

  it('an older vault, which never asks, and anybody but an owner: not offered here', async () => {
    const old = vault(true);
    paused(old);
    await unlocked(old, <SharingScreen />);
    await screen.findByTestId('sharing-p1');
    expect(screen.queryByTestId('sharing-resume-p1')).toBeNull();

    const t = vault();
    paused(t);
    t.vault.state.role = 'adult';
    await unlocked(t, <SharingScreen />);
    await screen.findByTestId('sharing-p1');
    expect(screen.queryByTestId('sharing-resume-p1')).toBeNull();
  });
});

describe('Edit details: made sensitive while it is shared outside the family', () => {
  /** A bill, not sensitive, shared by `links` links. */
  async function editBill(t: TestVault, links: number) {
    libraryDoc(t, {
      id: 'bill',
      title: 'Water bill',
      type_key: 'utility_bill',
      extra: { due_date: { date: '2026-12-01', precision: 'day' } },
      sensitive: null,
      sensitive_effective: false,
    } as never);
    t.library.stillShared.set('bill', links);
    push({ pathname: '/document/[id]', params: { id: 'bill' } });
    push({ pathname: '/edit/[id]', params: { id: 'bill' } });
    await unlocked(t, <EditScreen />);
    await fireEvent.press(await screen.findByTestId('edit-sensitive-yes'));
    await fireEvent.press(screen.getByTestId('edit-save'));
  }

  it('saved, then asked; End them now ends them and says what was done, then goes back', async () => {
    const t = vault();
    await editBill(t, 2);
    expect(await screen.findByText('This paper is shared outside the family by 2 links. Keep them, or end them now?')).toBeTruthy();
    // Saved already: the question is never in its way.
    expect(t.library.documents.get('bill')?.sensitive).toBe(true);
    expect(screen.getByTestId('edit-still-shared-end')).toHaveTextContent('End them now');
    expect(screen.getByTestId('edit-still-shared-keep')).toHaveTextContent('Keep them');
    expect(audit()).toEqual([]);
    const before = routes().length;
    await fireEvent.press(screen.getByTestId('edit-still-shared-end'));
    expect(await screen.findByTestId('edit-still-shared-words')).toHaveTextContent('Ended its 2 links.');
    expect(t.library.stopped).toEqual(['bill']);
    expect(routes()).toHaveLength(before);
    await fireEvent.press(screen.getByTestId('edit-still-shared-done'));
    await waitFor(() => expect(routes()).toHaveLength(before - 1));
  });

  it('one link, kept: nothing ended, and back', async () => {
    const t = vault();
    await editBill(t, 1);
    expect(await screen.findByText('This paper is shared outside the family by a link. Keep it, or end it now?')).toBeTruthy();
    const before = routes().length;
    await fireEvent.press(screen.getByTestId('edit-still-shared-keep'));
    await waitFor(() => expect(routes()).toHaveLength(before - 1));
    expect(t.library.stopped).toEqual([]);
  });

  it('a collection’s link it is taken out of, and one the person cannot see, are said as the vault counts them', async () => {
    const t = vault();
    t.library.stopSharing = { ended: 1, left_out: 1, kept: 1 };
    await editBill(t, 3);
    await fireEvent.press(await screen.findByTestId('edit-still-shared-end'));
    expect(await screen.findByTestId('edit-still-shared-words')).toHaveTextContent(
      'Ended its link, and took it out of a collection’s link (the rest of the collection still goes). One link you can’t see stayed: ask whoever made it.',
    );
  });

  it('not shared, or an older vault: saved and back, nothing asked', async () => {
    const t = vault(true);
    await editBill(t, 0);
    await waitFor(() => expect(t.library.documents.get('bill')?.sensitive).toBe(true));
    expect(screen.queryByTestId('edit-still-shared')).toBeNull();
    expect(t.library.stopped).toEqual([]);
  });
});

const kind = (key: string, sensitive: boolean): DocumentTypeView =>
  ({
    key,
    label: key,
    category: 'household',
    fields: [],
    expiry_driver: null,
    reminder_leads: [],
    usually_essential: false,
    default_visibility: 'household',
    sensitive_default: sensitive,
  }) as DocumentTypeView;

describe('a new paper of one’s own, sensitive: where it starts (the vault’s rule)', () => {
  const base: Household = {
    types: [kind('passport', true), kind('warranty', false)],
    members: [
      { id: 'me', display_name: 'Sam' },
      { id: 'mum', display_name: 'Mum' },
    ],
    me: { member_id: 'me', role: 'teen' },
    issuedBy: true,
    details: false,
    sensitive: true,
    keepsOwnSensitive: true,
  };

  it('a teen’s own passport starts as Only me, and is sent so; a warranty as before', () => {
    const d = chooseType(newDraft('camera' as never, base.me), 'passport', base);
    expect(visibilityOf(d, base)).toBe('private');
    expect(startsOnlyMe(d, base)).toBe(true);
    expect(toMetadata(d, base).metadata.visibility).toBe('private');
    const w = chooseType(d, 'warranty', base);
    expect(visibilityOf(w, base)).toBe('household');
    expect(startsOnlyMe(w, base)).toBe(false);
    // Marked sensitive on the card: Only me again.
    expect(visibilityOf({ ...w, sensitive: true }, base)).toBe('private');
  });

  it('chosen otherwise, it is kept as chosen; a paper about somebody else follows the adder’s choice', () => {
    const d = chooseType(newDraft('camera' as never, base.me), 'passport', base);
    expect(visibilityOf({ ...d, visibility: 'household' }, base)).toBe('household');
    expect(startsOnlyMe({ ...d, visibility: 'household' }, base)).toBe(false);
    const adult = { ...base, me: { member_id: 'me', role: 'adult' as const } };
    const about = chooseOwner(chooseType(newDraft('camera' as never, adult.me), 'passport', adult), 'mum', adult);
    expect(visibilityOf(about, adult)).not.toBe('private');
  });

  it('nobody who keeps theirs, or an older vault: as before', () => {
    const d = chooseType(newDraft('camera' as never, base.me), 'passport', base);
    expect(visibilityOf(d, { ...base, keepsOwnSensitive: false })).toBe('household');
    const { keepsOwnSensitive: _unsaid, ...older } = base;
    expect(visibilityOf(d, older)).toBe('household');
  });
});

/** The card, the way the + opens it: the scanner has just said Done. */
function Scanned() {
  const capture = useCapture();
  const { who } = useVault();
  const [open, setOpen] = useState(false);
  const started = useRef(false);
  useEffect(() => {
    if (!who || started.current) return;
    started.current = true;
    void capture.start('scan').then((o) => setOpen(o === 'card'));
  }, [who, capture]);
  return open ? <CaptureScreen /> : null;
}

async function card(t: TestVault) {
  await signedIn(t);
  const phone = testCapture({ scanner: fixtureScanner([{ kind: 'pages', pages: [{ uri: 'cache:/scan/1.jpg' }] }]) });
  phone.files.set('cache:/scan/1.jpg', jpeg('card.jpg'));
  await renderApp(<Scanned />, { fetch: t.fetch, capture: phone });
  await screen.findByText('What it is');
}

/** The person signed in is a teen, as the vault says: their sign-in and the family's list. */
function asTeen(t: TestVault) {
  t.vault.state.role = 'teen';
  t.vault.state.members = t.vault.state.members.map((m) => (m.is_me ? { ...m, role: 'teen' } : m));
}

describe('the capture card, for a teen', () => {
  it('their own sensitive scan starts as Only me, and says why; they can change it', async () => {
    const t = vault();
    asTeen(t);
    await card(t);
    await waitFor(() =>
      expect(screen.getByTestId('visibility-private').props.accessibilityState).toEqual(
        expect.objectContaining({ selected: true }),
      ),
    );
    expect(screen.getByTestId('capture-sensitive-only-me')).toHaveTextContent(SENSITIVE_ONLY_ME_NOTE);
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByTestId('visibility-household'));
    expect(screen.getByTestId('visibility-household').props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );
    expect(screen.queryByTestId('capture-sensitive-only-me')).toBeNull();
  });

  it('an older vault: as before', async () => {
    const t = vault(true);
    asTeen(t);
    await card(t);
    await screen.findByTestId('visibility-household');
    expect(screen.getByTestId('visibility-private').props.accessibilityState).toEqual(
      expect.objectContaining({ selected: false }),
    );
    expect(screen.queryByTestId('capture-sensitive-only-me')).toBeNull();
  });
});
