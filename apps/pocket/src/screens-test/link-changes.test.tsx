import type { Share } from '@fdv/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import SharingScreen from '../app/sharing';
import { readChange, startChange } from '../sharing/change-model';
import { audit } from '../test-support/a11y';
import { unlocked } from '../test-support/lookup';
import { installed } from '../test-support/render';
import { resetRoutes } from '../test-support/router';
import { caps0519, capabilities, testVault, type TestVault } from '../test-support/vault';

jest.mock(
  'expo-router',
  () => jest.requireActual<typeof import('../test-support/router')>('../test-support/router').routerMock,
);

const ORIGIN = 'https://vault.test';
const PASSWORD = 'correct horse battery staple';
const ZONE = 'Europe/London';

beforeEach(() => {
  installed();
  resetRoutes();
});

/** A vault of 0.9.0-dev.49 on: links changed after they are made; dev.53, ended ones kept a while. */
function vault(over: Record<string, boolean> = {}): TestVault {
  const t = testVault([ORIGIN]);
  t.caps = capabilities({
    server_version: '0.9.0',
    features: {
      ...caps0519().features,
      share_options: true,
      share_second_factor: true,
      share_reveal: true,
      sensitive_protects: true,
      link_changes: true,
      ended_sharing: true,
      ...over,
    },
  });
  return t;
}

/** A link the person made, as the vault of 0.9.0-dev.49 lists it. */
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
    open_count: 1,
    last_opened_at: null,
    state: 'active',
    permission: 'view',
    max_opens: null,
    summary: 'A link',
    revealable: true,
    changeable: true,
    mine: true,
    latest_end: '2031-01-01T00:00:00Z',
    show_title: null,
    version: 3,
    ...over,
  } as Share;
}

describe('a link’s change, read as the web reads it', () => {
  const now = new Date('2026-11-16T10:00:00Z');
  const base = link({ id: 'l', expires_at: '2026-11-20T17:00:00Z', latest_end: '2026-12-01T10:00:00Z' });

  it('as it is: nothing to send', () => {
    const read = readChange(base, startChange(base, ZONE), { timezone: ZONE, protects: true, now });
    expect(read).toEqual(expect.objectContaining({ nothing: true, problem: null, has: 'pin', maker: true }));
    expect(read.body).toEqual({});
  });

  it('only what changed: whom for, View and download, a limit, a new PIN, its title shown', () => {
    const v = {
      ...startChange(base, ZONE),
      label: ' Dr Rao ',
      permission: 'download' as const,
      opens: '5',
      secret: 'pin' as const,
      showTitle: true,
    };
    expect(readChange(base, v, { timezone: ZONE, protects: true, now }).body).toEqual({
      recipient_label: 'Dr Rao',
      permission: 'download',
      max_opens: 5,
      secret: 'pin',
      show_title: true,
    });
    // Its title is not offered without H1a, and not sent.
    expect(readChange(base, v, { timezone: ZONE, protects: false, now }).body.show_title).toBeUndefined();
  });

  it('a new end: In a week; past its latest, said as its latest; a day typed wrong', () => {
    const week = readChange(base, { ...startChange(base, ZONE), end: 'week' }, { timezone: ZONE, protects: true, now });
    expect(week.body.expires_at).toBe('2026-11-23T10:00:00.000Z');
    const late = readChange(
      base,
      { ...startChange(base, ZONE), end: 'other', day: '20 Dec 2026', time: '17:00' },
      { timezone: ZONE, protects: true, now },
    );
    expect(late).toEqual(expect.objectContaining({ endProblem: 'latest', body: {} }));
    const bad = readChange(base, { ...startChange(base, ZONE), end: 'other', day: 'soon' }, { timezone: ZONE, protects: true, now });
    expect(bad.problem).toBe('day');
  });

  it('the same end chosen again is no change', () => {
    const same = readChange(
      base,
      { ...startChange(base, ZONE), end: 'other', day: '20 Nov 2026', time: '17:00' },
      { timezone: ZONE, protects: true, now },
    );
    expect(same).toEqual(expect.objectContaining({ nothing: true, problem: null, body: {} }));
  });

  it('a password typed too short is said; somebody else’s link keeps its PIN; a clinician’s stays to view', () => {
    const v = { ...startChange(base, ZONE), secret: 'password' as const, passwordMode: 'typed' as const, password: 'short' };
    expect(readChange(base, v, { timezone: ZONE, protects: true, now }).problem).toBe('password');
    const theirs = link({ id: 'x', mine: false });
    expect(readChange(theirs, { ...startChange(theirs, ZONE), secret: 'none' }, { timezone: ZONE, protects: true, now }).body).toEqual({});
    const clinician = link({ id: 'e', document_id: null, document_title: null, permission: 'view' });
    const read = readChange(
      clinician,
      { ...startChange(clinician, ZONE), permission: 'download', showTitle: true },
      { timezone: ZONE, protects: true, now },
    );
    expect(read).toEqual(expect.objectContaining({ emergency: true, nothing: true }));
  });
});

describe('Change, in Sharing (LK)', () => {
  it('whom for and a new PIN: saved with its version, the new PIN shown once, then said', async () => {
    const t = vault();
    t.library.shares.push(link({ id: 's1' }));
    t.library.shareSecrets.set('s1', { link_token: 'tok-1', link_url: 'https://share.vault.test/s#tok-1', pin: '4821' });
    await unlocked(t, <SharingScreen />);
    const change = await screen.findByTestId('sharing-change-s1');
    expect(change.props.accessibilityLabel).toBe('Change the link to Passport');
    await fireEvent.press(change);
    expect(await screen.findByTestId('change-link-nothing')).toHaveTextContent('Nothing is changed yet.');
    expect(screen.getByTestId('change-link-save').props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );
    expect(screen.getByTestId('change-link-label').props.value).toBe('Dr Patel');
    expect(audit()).toEqual([]);
    await fireEvent.changeText(screen.getByTestId('change-link-label'), 'Dr Rao');
    await fireEvent.press(screen.getByTestId('change-link-secret-pin'));
    expect(screen.getByTestId('change-link-old-stops')).toHaveTextContent(/old PIN stops working at once/);
    await fireEvent.press(screen.getByTestId('change-link-save'));
    expect(await screen.findByTestId('change-link-new-secret')).toHaveTextContent('7356');
    // Not selectable (0.19.0): only Copy puts it on the clipboard, and clears it in a minute.
    expect(screen.getByTestId('change-link-new-secret').props.selectable).toBeFalsy();
    expect(t.library.shareChanges).toEqual([
      { id: 's1', body: { recipient_label: 'Dr Rao', secret: 'pin' }, ifMatch: '"3"' },
    ]);
    await fireEvent.press(screen.getByTestId('change-link-done'));
    expect(await screen.findByTestId('sharing-said')).toHaveTextContent('The link to “Passport” is changed.');
    expect(await screen.findByTestId('sharing-s1')).toHaveTextContent(/For Dr Rao/);
  });

  it('letting it do more confirms it is you first', async () => {
    const t = vault();
    t.library.changeStepUp = true;
    t.library.shares.push(link({ id: 's1' }));
    await unlocked(t, <SharingScreen />);
    await fireEvent.press(await screen.findByTestId('sharing-change-s1'));
    await fireEvent.press(await screen.findByTestId('change-link-permission-download'));
    await fireEvent.press(screen.getByTestId('change-link-save'));
    await fireEvent.changeText(await screen.findByTestId('step-up-password'), PASSWORD);
    await fireEvent.press(screen.getByTestId('step-up-go'));
    expect(await screen.findByTestId('sharing-said')).toHaveTextContent('The link to “Passport” is changed.');
    expect(t.library.shareChanges[0]?.body).toEqual({ permission: 'download' });
    expect(t.library.stepUps).toEqual([PASSWORD]);
  });

  it('an owner changing somebody else’s: its PIN stays theirs, and what else protects it is said', async () => {
    const t = vault();
    t.library.shares.push(
      link({ id: 's2', mine: false, protection: ['pin', 'code'], code_to: 'j•••@e•••.com', this_device_only: true }),
    );
    await unlocked(t, <SharingScreen />);
    await fireEvent.press(await screen.findByTestId('sharing-change-s2'));
    expect(await screen.findByTestId('change-link-not-maker')).toHaveTextContent(
      /It asks for a PIN\. Only whoever made it can change its PIN or password/,
    );
    expect(screen.queryByTestId('change-link-secret-pin')).toBeNull();
    const protect = screen.getByTestId('change-link-protect');
    expect(protect).toHaveTextContent(/emails a code to j•••@e•••\.com/);
    expect(protect).toHaveTextContent(/opens only in the first browser/);
    await fireEvent.press(screen.getByTestId('change-link-cancel'));
    await waitFor(() => expect(screen.queryByTestId('change-link')).toBeNull());
    expect(t.library.shareChanges).toEqual([]);
  });

  it('changed meanwhile (409): Sharing reads the links again, and Change opened again saves on the new version', async () => {
    const t = vault();
    t.library.shares.push(link({ id: 's1' }));
    await unlocked(t, <SharingScreen />);
    await fireEvent.press(await screen.findByTestId('sharing-change-s1'));
    await fireEvent.changeText(await screen.findByTestId('change-link-label'), 'Dr Rao');
    // Somebody else changes it while the form is open (a new answer, not the one the phone holds).
    t.library.shares[0] = { ...(t.library.shares[0] as Share), version: 4, recipient_label: 'Dr Shah' };
    const lists = () => t.calls.filter((c) => c === `GET ${ORIGIN}/api/v1/shares`).length;
    const before = lists();
    await fireEvent.press(screen.getByTestId('change-link-save'));
    expect(await screen.findByTestId('change-link-problem')).toBeTruthy();
    await waitFor(() => expect(lists()).toBeGreaterThan(before));
    expect(t.library.shareChanges).toEqual([]);
    await fireEvent.press(screen.getByTestId('change-link-cancel'));
    expect(await screen.findByTestId('sharing-s1')).toHaveTextContent(/For Dr Shah/);
    await fireEvent.press(screen.getByTestId('sharing-change-s1'));
    expect((await screen.findByTestId('change-link-label')).props.value).toBe('Dr Shah');
    await fireEvent.changeText(screen.getByTestId('change-link-label'), 'Dr Rao');
    await fireEvent.press(screen.getByTestId('change-link-save'));
    expect(await screen.findByTestId('sharing-said')).toHaveTextContent('The link to “Passport” is changed.');
    expect(t.library.shareChanges).toEqual([{ id: 's1', body: { recipient_label: 'Dr Rao' }, ifMatch: '"4"' }]);
  });

  it('Cancel reads the links again', async () => {
    const t = vault();
    t.library.shares.push(link({ id: 's1' }));
    await unlocked(t, <SharingScreen />);
    await fireEvent.press(await screen.findByTestId('sharing-change-s1'));
    await screen.findByTestId('change-link-label');
    t.library.shares[0] = { ...(t.library.shares[0] as Share), recipient_label: 'Dr Shah' };
    await fireEvent.press(screen.getByTestId('change-link-cancel'));
    expect(await screen.findByTestId('sharing-s1')).toHaveTextContent(/For Dr Shah/);
  });

  it('a link that can’t be changed, or an older vault: no Change', async () => {
    const t = vault();
    t.library.shares.push(link({ id: 's3', changeable: false }));
    await unlocked(t, <SharingScreen />);
    await screen.findByTestId('sharing-s3');
    expect(screen.queryByTestId('sharing-change-s3')).toBeNull();

    const older = vault({ link_changes: false });
    older.library.shares.push(link({ id: 's4' }));
    await unlocked(older, <SharingScreen />);
    await screen.findByTestId('sharing-s4');
    expect(screen.queryByTestId('sharing-change-s4')).toBeNull();
  });
});

describe('links that no longer work (RQ)', () => {
  it('under No longer working: 20, then Show N more, and how long they are kept', async () => {
    const t = vault();
    t.library.shares.push(link({ id: 'now1' }));
    for (let i = 0; i < 23; i += 1) {
      t.library.shares.push(
        link({
          id: `old-${i}`,
          state: 'revoked',
          created_at: `2026-10-${String(i + 1).padStart(2, '0')}T10:00:00Z`,
          summary: 'Taken back',
        }),
      );
    }
    await unlocked(t, <SharingScreen />);
    await screen.findByTestId('sharing-live');
    expect(screen.getByTestId('sharing-ended')).toHaveTextContent(/No longer working/);
    expect(await screen.findByTestId('sharing-kept')).toHaveTextContent(
      /^Links and requests that no longer work are removed 90 days after they end\. The activity log keeps/,
    );
    // Newest first; the oldest three behind Show 3 more.
    expect(screen.getByTestId('sharing-ended-old-22')).toHaveTextContent(/Taken back/);
    expect(screen.queryByTestId('sharing-ended-old-0')).toBeNull();
    // Nothing to do with one that ended.
    expect(screen.queryByTestId('sharing-end-old-22')).toBeNull();
    const more = screen.getByTestId('sharing-ended-more');
    expect(more).toHaveTextContent('Show 3 more');
    await fireEvent.press(more);
    expect(await screen.findByTestId('sharing-ended-old-0')).toBeTruthy();
    expect(screen.queryByTestId('sharing-ended-more')).toBeNull();
  });

  it('ended here, it moves under No longer working', async () => {
    const t = vault();
    t.library.shares.push(link({ id: 's1' }));
    await unlocked(t, <SharingScreen />);
    await fireEvent.press(await screen.findByTestId('sharing-end-s1'));
    await fireEvent.press(await screen.findByTestId('sharing-end-yes'));
    expect(await screen.findByTestId('sharing-ended-s1')).toBeTruthy();
    expect(screen.queryByTestId('sharing-s1')).toBeNull();
    expect(screen.getByTestId('sharing-none')).toHaveTextContent('Nothing is shared outside the family.');
  });
});
