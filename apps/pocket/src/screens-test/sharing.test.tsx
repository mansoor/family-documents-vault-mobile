import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import CollectionScreen from '../app/collection/[id]';
import MoreScreen from '../app/(tabs)/more';
import SharingScreen from '../app/sharing';
import { DocumentDetail } from '../documents/detail';
import { SecureTokenStore } from '../session/store';
import { NO_SHARE_OPTIONS, readShareOptions } from '../sharing/share-model';
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
const PASSWORD = 'correct horse battery staple';

beforeEach(() => {
  installed();
  resetRoutes();
});

/** A vault of 0.9.0: links with their options, a password made up, collections shared. */
function vault(): TestVault {
  const t = testVault([ORIGIN]);
  t.caps = capabilities({
    features: {
      ...caps0519().features,
      collections: true,
      notes: true,
      share_options: true,
      share_second_factor: true,
      collection_shares: true,
    },
  });
  return t;
}

describe('a link’s options, read as the web reads them', () => {
  const ctx = { timezone: 'Europe/London', maxDays: 90, viewable: true, note: false, options: true, passwords: true };
  const now = new Date('2026-11-11T10:00:00Z');

  it('In a week by default; whom for, view only, a limit and a password', () => {
    const read = readShareOptions(
      { ...NO_SHARE_OPTIONS, label: ' Dr Patel ', permission: 'view', opens: '3', protection: 'password' },
      { ...ctx, now },
    );
    expect(read.end).toBe('week');
    expect(read.body).toEqual({
      recipient_label: 'Dr Patel',
      expires_at: '2026-11-18T10:00:00.000Z',
      permission: 'view',
      max_opens: 3,
      with_pin: false,
      with_password: true,
    });
  });

  it('another day and time on the family’s clock; what is wrong is said, and nothing is sent', () => {
    const other = { ...NO_SHARE_OPTIONS, end: 'other' as const, day: '20 Nov 2026', time: '9:30' };
    expect(readShareOptions(other, { ...ctx, now }).body?.expires_at).toBe('2026-11-20T09:30:00.000Z');
    expect(readShareOptions({ ...other, day: 'soon' }, { ...ctx, now })).toEqual(
      expect.objectContaining({ endProblem: 'day', body: null }),
    );
    expect(readShareOptions({ ...other, time: '25:00' }, { ...ctx, now }).endProblem).toBe('time');
    expect(readShareOptions({ ...NO_SHARE_OPTIONS, opens: '5e' }, { ...ctx, now })).toEqual(
      expect.objectContaining({ opensProblem: 'opens', body: null }),
    );
  });

  it('a note goes to view only; an older vault is sent days, and no options', () => {
    expect(readShareOptions(NO_SHARE_OPTIONS, { ...ctx, note: true, now }).body?.permission).toBe('view');
    expect(readShareOptions(NO_SHARE_OPTIONS, { ...ctx, options: false, now }).body).toEqual({
      expires_in_days: 7,
      with_pin: false,
    });
  });
});

describe('Share, from a document’s ⋯', () => {
  it('whom for, a PIN; the link and its PIN shown once, to send or copy', async () => {
    const t = vault();
    libraryDoc(t, { id: 'passport', title: 'Passport' });
    await unlocked(t, <DocumentDetail id="passport" />);
    await fireEvent.press(await screen.findByTestId('document-more'));
    await fireEvent.press(await screen.findByTestId('document-share'));
    await fireEvent.changeText(await screen.findByTestId('share-label'), 'Dr Patel');
    await fireEvent.press(screen.getByTestId('share-permission-view'));
    await fireEvent.press(screen.getByTestId('share-protect-pin'));
    expect(screen.getByTestId('share-end-words')).toHaveTextContent(/^Stops /);
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByTestId('share-make'));

    expect(await screen.findByTestId('share-link')).toHaveTextContent('https://share.vault.test/s#tok-1');
    expect(screen.getByTestId('share-secret')).toHaveTextContent('4821');
    expect(screen.getByTestId('share-send')).toBeTruthy();
    expect(t.library.shareBodies).toEqual([
      {
        to: 'passport',
        body: expect.objectContaining({ recipient_label: 'Dr Patel', permission: 'view', with_pin: true }),
      },
    ]);
    await fireEvent.press(screen.getByTestId('share-done'));
    await waitFor(() => expect(screen.queryByTestId('share-sheet')).toBeNull());
  });

  it('an Only me document, where the household shares none: no link, and why', async () => {
    const t = vault();
    t.library.onlyMeShareable = false;
    libraryDoc(t, { id: 'will', title: 'Will', visibility: 'private' });
    await unlocked(t, <DocumentDetail id="will" />);
    await fireEvent.press(await screen.findByTestId('document-more'));
    await fireEvent.press(await screen.findByTestId('document-share'));
    expect(await screen.findByTestId('share-refused')).toHaveTextContent(/does not share Only me documents/);
    expect(screen.queryByTestId('share-make')).toBeNull();
  });

  it('a teen is offered no Share', async () => {
    const t = vault();
    libraryDoc(t, { id: 'passport', title: 'Passport', owner_member_id: 'fake-member' });
    // The phone keeps this role for whoever signed in.
    const asTeen = async () => {
      const store = new SecureTokenStore();
      const kept = await store.load();
      await store.save({ ...(kept as NonNullable<typeof kept>), role: 'teen' as never });
    };
    await unlocked(t, <DocumentDetail id="passport" />, { before: asTeen });
    await fireEvent.press(await screen.findByTestId('document-more'));
    await screen.findByTestId('document-trash');
    expect(screen.queryByTestId('document-share')).toBeNull();
  });
});

describe('Share, from a collection’s page', () => {
  it('what goes, ticked as the web ticks it; confirms it is you; then the link', async () => {
    const t = vault();
    t.vault.state.collections.push({
      id: 'hol',
      name: 'Holiday',
      description: null,
      audience: 'everyone',
      owner_member_id: 'fake-member',
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-01T00:00:00Z',
      revision: 1,
      deleted: false,
      items: [],
    } as never);
    t.library.sharePreviews.set('hol', {
      collection_id: 'hol',
      collection_name: 'Holiday',
      audience: 'everyone',
      items: [
        { document_id: 'p1', title: 'Passport', type_label: 'Passport', ticked: true, lock: null, reason: null, viewable: true },
        { document_id: 'w1', title: 'Will', type_label: 'Will', ticked: false, lock: 'private', reason: 'Only me: tick it to send it anyway.', viewable: true },
      ],
    });
    push({ pathname: '/collection/[id]', params: { id: 'hol' } });
    await unlocked(t, <CollectionScreen />);
    await fireEvent.press(await screen.findByTestId('collection-share'));
    const passport = await screen.findByTestId('share-item-p1');
    expect(passport.props.accessibilityState).toEqual(expect.objectContaining({ checked: true }));
    expect(screen.getByTestId('share-item-w1').props.accessibilityState).toEqual(
      expect.objectContaining({ checked: false }),
    );
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByTestId('share-make'));
    await fireEvent.changeText(await screen.findByTestId('step-up-password'), PASSWORD);
    await fireEvent.press(screen.getByTestId('step-up-go'));
    expect(await screen.findByTestId('share-link')).toBeTruthy();
    expect(t.library.shareBodies[0]).toEqual({
      to: 'hol',
      body: expect.objectContaining({ document_ids: ['p1'], left_out_ids: ['w1'] }),
    });
  });
});

describe('Sharing, in More', () => {
  it('lists the links that still work, and ends one after asking', async () => {
    const t = vault();
    libraryDoc(t, { id: 'passport', title: 'Passport' });
    await unlocked(t, <MoreScreen />);
    await fireEvent.press(await screen.findByTestId('more-sharing'));
    expect(routes()).toEqual([{ pathname: '/sharing', params: {} }]);
    resetRoutes();

    t.library.shares.push(
      {
        id: 's1',
        document_id: 'passport',
        document_title: 'Passport',
        recipient_label: 'Dr Patel',
        created_by_name: 'Fake Owner',
        created_at: '2026-11-10T10:00:00Z',
        expires_at: '2030-11-17T10:00:00Z',
        has_pin: false,
        open_count: 2,
        last_opened_at: null,
        state: 'active',
        summary: 'A link',
      } as never,
      { id: 's2', document_id: 'passport', document_title: 'Old', state: 'revoked', created_at: '2026-11-01T10:00:00Z', expires_at: '2026-11-02T10:00:00Z', open_count: 0, summary: '' } as never,
    );
    await unlocked(t, <SharingScreen />);
    const row = await screen.findByTestId('sharing-s1');
    expect(row).toHaveTextContent(/PassportFor Dr PatelStops .*Opened 2 times/);
    expect(screen.queryByTestId('sharing-s2')).toBeNull();
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByTestId('sharing-end-s1'));
    expect(await screen.findByText('End this link?')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('sharing-end-yes'));
    expect(await screen.findByTestId('sharing-said')).toHaveTextContent('The link to “Passport” is ended.');
    expect(t.library.shares.find((s) => s.id === 's1')?.state).toBe('revoked');
    expect(screen.queryByTestId('sharing-s1')).toBeNull();
  });

  it('nothing shared: says so', async () => {
    const t = vault();
    await unlocked(t, <SharingScreen />);
    expect(await screen.findByTestId('sharing-none')).toHaveTextContent('Nothing is shared outside the family.');
  });
});
