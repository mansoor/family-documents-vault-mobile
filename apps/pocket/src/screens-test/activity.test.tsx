import { ACTIVITY_KINDS, SENSITIVE_IN_WORDS, type ActivityEvent, type ActivityLine } from '@fdv/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import MoreScreen from '../app/(tabs)/more';
import { ELSE, emptyKey, filtersOn, matches, NO_ACTIVITY_FILTERS, typedDay } from '../activity/filters';
import { ActivityScreen } from '../activity/screen';
import { DocumentDetail } from '../documents/detail';
import { audit } from '../test-support/a11y';
import { libraryDoc, unlocked } from '../test-support/lookup';
import { installed, respond } from '../test-support/render';
import { resetRoutes, routes } from '../test-support/router';
import { caps0519, capabilities, testVault, type TestVault } from '../test-support/vault';

jest.mock(
  'expo-router',
  () => jest.requireActual<typeof import('../test-support/router')>('../test-support/router').routerMock,
);

/**
 * Activity on the phone (app 0.17.0): the household's activity log from
 * More, and one document's own from its page (the vault's 0.9.0-dev.54,
 * DA), as the web's Activity page shows them — who did what, exactly when,
 * filtered by who, what sort of thing and which days. Read only.
 */

const ORIGIN = 'https://vault.test';

beforeEach(() => {
  installed();
  resetRoutes();
});

/** A vault of 0.9.0-dev.54 (`older`: one before DA, with the log alone). */
function vault(over: { older?: boolean; role?: 'owner' | 'adult' | 'teen' | 'viewer' } = {}): TestVault {
  const t = testVault([ORIGIN]);
  t.caps = capabilities({
    server_version: over.older ? '0.9.0-dev.53' : '0.9.0-dev.54',
    features: { ...caps0519().features, notes: true, ...(over.older ? {} : { document_activity: true }) },
  });
  t.vault.state.members.push({ id: 'pat', display_name: 'Pat', role: 'adult', is_me: false } as never);
  if (over.role) t.vault.state.role = over.role;
  return t;
}

/** A document the fake's log can speak of, and its page as the vault answers it. */
function doc(t: TestVault, id: string, title: string, over: Record<string, unknown> = {}) {
  t.vault.state.documents.push({ id, title, type_key: 'passport', owner_member_id: 'fake-member', visibility: 'household', deleted_at: null } as never);
  libraryDoc(t, { id, title, ...over });
}

const event = (over: Partial<ActivityEvent> & { id: number; action: string; object_id: string }): ActivityEvent => ({
  at: `2026-11-${String(10 + over.id).padStart(2, '0')}T10:00:00Z`,
  actor: 'Fake Owner',
  actor_member_id: 'fake-member',
  actor_label: null,
  object_type: 'document',
  object_title: null,
  detail: {},
  ...over,
});

/** Four things that happened, oldest first: added, shared by Pat, opened through the link, downloaded by Pat. */
function happened(t: TestVault) {
  doc(t, 'passport', 'Passport');
  doc(t, 'bill', 'Water bill');
  t.vault.state.activity = [
    event({ id: 1, action: 'document.created', object_id: 'passport', object_title: 'Passport' }),
    event({
      id: 2,
      action: 'share.created',
      object_id: 'passport',
      object_title: 'Passport',
      actor: 'Pat',
      actor_member_id: 'pat',
      detail: { recipient_label: 'Dr Patel' },
    }),
    event({
      id: 3,
      action: 'share.opened',
      object_id: 'passport',
      object_title: 'Passport',
      actor: null,
      actor_member_id: null,
      actor_label: 'shared link (Dr Patel)',
    }),
    event({ id: 4, action: 'document.downloaded', object_id: 'bill', object_title: 'Water bill', actor: 'Pat', actor_member_id: 'pat' }),
  ];
}

const line = (over: Partial<ActivityLine> & { id: number }): ActivityLine => ({
  at: '2026-11-15T10:00:00Z',
  text: 'Something happened',
  notable: false,
  document_id: null,
  ...over,
});

describe('the filters, as the web reads them', () => {
  const family = [{ id: 'fake-member' }, { id: 'pat' }];
  const pat = line({ id: 1, actor_member_id: 'pat', kind: 'opened', at: '2026-11-15T23:30:00Z' });
  const link = line({ id: 2, actor_member_id: null, kind: 'shared', at: '2026-11-10T10:00:00Z' });

  it('who, anybody else, what sort of thing, and days on the household’s calendar', () => {
    expect(matches(pat, { ...NO_ACTIVITY_FILTERS, who: 'pat' }, family, 'UTC')).toBe(true);
    expect(matches(link, { ...NO_ACTIVITY_FILTERS, who: 'pat' }, family, 'UTC')).toBe(false);
    // Anybody else: a link, somebody the reader isn't given.
    expect(matches(link, { ...NO_ACTIVITY_FILTERS, who: ELSE }, family, 'UTC')).toBe(true);
    expect(matches(pat, { ...NO_ACTIVITY_FILTERS, who: ELSE }, family, 'UTC')).toBe(false);
    expect(matches(pat, { ...NO_ACTIVITY_FILTERS, kind: 'shared' }, family, 'UTC')).toBe(false);
    expect(matches(link, { ...NO_ACTIVITY_FILTERS, kind: 'shared' }, family, 'UTC')).toBe(true);
    // 23:30 in London on the 15th is the 16th in Kolkata: the household's day decides.
    const day16 = { ...NO_ACTIVITY_FILTERS, from: '2026-11-16', to: '2026-11-16' };
    expect(matches(pat, day16, family, 'Europe/London')).toBe(false);
    expect(matches(pat, day16, family, 'Asia/Kolkata')).toBe(true);
    expect(filtersOn({ who: 'pat', kind: 'shared', from: '', to: '2026-11-16' })).toBe(3);
  });

  it('days typed as the card takes them; empty words for each case', () => {
    expect(typedDay('14 Nov 2026', false)).toBe('2026-11-14');
    expect(typedDay('Feb 2028', true)).toBe('2028-02-29');
    expect(typedDay('2026', false)).toBe('2026-01-01');
    expect(typedDay('', false)).toBeNull();
    expect(typedDay('soon', false)).toBe('bad');
    expect(emptyKey(false, false, false)).toBe('activity.nothingYet');
    // An empty page with older ones behind it is not "nothing yet".
    expect(emptyKey(false, true, false)).toBe('activity.nothingInStretch');
    expect(emptyKey(false, true, true)).toBeNull();
    expect(emptyKey(true, true, false)).toBe('activity.nothingLoadedMatches');
    expect(emptyKey(true, false, true)).toBe('activity.nothingMatches');
    expect(ACTIVITY_KINDS.map((k) => k.value)).toContain('shared');
  });
});

describe('Activity in More', () => {
  it('for whoever reads the log — owners, adults and teens; never a viewer', async () => {
    await unlocked(vault(), <MoreScreen />);
    expect(await screen.findByTestId('more-activity')).toHaveTextContent(/ActivityWho did what in the vault, and when/);
    expect(audit()).toEqual([]);
  });

  it('a viewer has none', async () => {
    await unlocked(vault({ role: 'viewer' }), <MoreScreen />);
    await screen.findByTestId('more-account');
    expect(screen.queryByTestId('more-activity')).toBeNull();
  });
});

describe('the household’s activity', () => {
  it.each(['adult', 'teen'] as const)('an %s reads it too: More has it, and the lines they may see', async (role) => {
    const t = vault({ role });
    happened(t);
    await unlocked(t, <MoreScreen />);
    expect(await screen.findByTestId('more-activity')).toBeTruthy();
    resetRoutes();
    await unlocked(t, <ActivityScreen />);
    expect(await screen.findByTestId('activity-count')).toHaveTextContent('4 loaded');
    expect(screen.getByTestId('activity-line-2')).toHaveTextContent(/^Pat /);
  });

  it('a sensitive document’s line says “a sensitive document”, never its title, as the vault words it', async () => {
    const t = vault();
    doc(t, 'lab', 'Blood test', { sensitive_effective: true });
    t.vault.state.activity = [
      event({ id: 1, action: 'document.downloaded', object_id: 'lab', object_title: 'Blood test', object_sensitive: true, actor: 'Pat', actor_member_id: 'pat' }),
    ];
    await unlocked(t, <ActivityScreen />);
    const line = await screen.findByTestId('activity-line-1');
    expect(line).toHaveTextContent(new RegExp(`^Pat downloaded ${SENSITIVE_IN_WORDS}`));
    expect(line).not.toHaveTextContent(/Blood test/);
    expect(line.props.accessibilityLabel).not.toMatch(/Blood test/);
  });

  it('a refusal is said with Try again, never taken for nothing; without a connection, it says it needs one', async () => {
    const t = vault();
    happened(t);
    let refuse = true;
    const inner = t.fetch;
    t.fetch = (url, init) =>
      refuse && url.endsWith('/api/v1/audit')
        ? Promise.resolve(respond(403, { error: { code: 'forbidden', message: 'Viewers can’t read the activity log.' } }))
        : inner(url, init);
    await unlocked(t, <ActivityScreen />);
    expect(await screen.findByText('Viewers can’t read the activity log.')).toBeTruthy();
    expect(screen.queryByTestId('activity-empty')).toBeNull();
    expect(screen.queryByTestId('activity-count')).toBeNull();
    refuse = false;
    await fireEvent.press(screen.getByTestId('load-failed-retry'));
    expect(await screen.findByTestId('activity-count')).toHaveTextContent('4 loaded');
  });

  it('without a connection: said, and nothing shown as if it were none', async () => {
    const t = vault();
    happened(t);
    await unlocked(t, <ActivityScreen />, { before: () => void t.reachable.delete(ORIGIN) });
    expect(await screen.findByTestId('activity-offline')).toHaveTextContent('Activity needs a connection to the vault.');
    expect(screen.queryByTestId('activity-empty')).toBeNull();
    expect(screen.queryByTestId('activity-count')).toBeNull();
  });

  it('an empty page with older ones behind it says to look further back, not “Nothing yet.”', async () => {
    const t = vault();
    const inner = t.fetch;
    t.fetch = (url, init) =>
      url.includes('/api/v1/audit')
        ? Promise.resolve(respond(200, url.includes('before=') ? { items: [line({ id: 3, text: 'Pat changed “Lease”' })], next: null } : { items: [], next: 9 }))
        : inner(url, init);
    await unlocked(t, <ActivityScreen />);
    expect(await screen.findByTestId('activity-empty')).toHaveTextContent(
      'Nothing in this stretch. Show older to look further back.',
    );
    await fireEvent.press(screen.getByTestId('activity-older'));
    expect(await screen.findByText('Pat changed “Lease”')).toBeTruthy();
  });

  it('a late reply for one document never overwrites the whole log, nor leaves the placeholder up', async () => {
    const t = vault();
    happened(t);
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => (release = r));
    const inner = t.fetch;
    t.fetch = async (url, init) => {
      // The document's lines are slow; the whole log comes at once.
      if (url.endsWith('/documents/passport/activity')) await held;
      return inner(url, init);
    };
    await unlocked(t, <ActivityScreen document="passport" />);
    // Its × before its lines have come: the whole log.
    await fireEvent.press(await screen.findByTestId('activity-document-chip'));
    expect(await screen.findByTestId('activity-count')).toHaveTextContent('4 loaded');
    release();
    await held;
    await waitFor(() => expect(screen.getByTestId('activity-count')).toHaveTextContent('4 loaded'));
    expect(screen.getByTestId('activity-line-4')).toBeTruthy();
  });

  it('a day typed well is used even while the other is not a date; one no longer typed takes its chip with it', async () => {
    const t = vault();
    happened(t);
    await unlocked(t, <ActivityScreen />);
    await screen.findByTestId('activity-count');
    await fireEvent.press(screen.getByTestId('activity-filters'));
    await fireEvent.changeText(screen.getByTestId('activity-to'), 'soon');
    await fireEvent.changeText(screen.getByTestId('activity-from'), '13 Nov 2026');
    expect(screen.getByTestId('activity-filters-done')).toHaveTextContent('Show 2 loaded lines');
    await fireEvent.changeText(screen.getByTestId('activity-from'), '13 No');
    expect(screen.getByTestId('activity-filters-done')).toHaveTextContent('Show 4 loaded lines');
    await fireEvent.press(screen.getByTestId('activity-filters-done'));
    expect(screen.queryByTestId('activity-chip-from')).toBeNull();
    expect(screen.queryByTestId('activity-chip-to')).toBeNull();
  });

  it('every line the vault gives, newest first, exactly when; a line about a document opens it', async () => {
    const t = vault();
    happened(t);
    await unlocked(t, <ActivityScreen />);
    expect(await screen.findByTestId('activity-count')).toHaveTextContent('4 loaded');
    const lines = within(screen.getByTestId('activity-lines'));
    expect(screen.getByTestId('activity-line-4')).toHaveTextContent(/^Pat downloaded .*Water bill.*14 Nov 2026, 10:00am$/);
    expect(screen.getByTestId('activity-line-3')).toHaveTextContent(/^Shared link \(Dr Patel\) opened .*Passport/);
    expect(lines.getAllByText(/Passport|Water bill/)).toHaveLength(4);
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByTestId('activity-line-4'));
    expect(routes().at(-1)).toEqual({ pathname: '/document/[id]', params: { id: 'bill' } });
  });

  it('filters slide out: who, what happened and days; each filter on is a chip, and Clear all takes them off', async () => {
    const t = vault();
    happened(t);
    await unlocked(t, <ActivityScreen />);
    await screen.findByTestId('activity-count');
    await fireEvent.press(screen.getByTestId('activity-filters'));
    expect(await screen.findByTestId('activity-filter-panel')).toBeTruthy();
    expect(screen.getByTestId('activity-who-pat')).toHaveTextContent('Pat');
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByTestId('activity-who-pat'));
    expect(screen.getByTestId('activity-who-pat').props.accessibilityState).toEqual({ checked: true });
    expect(screen.getByTestId('activity-filters-done')).toHaveTextContent('Show 2 loaded lines');
    await fireEvent.press(screen.getByTestId('activity-kind-opened'));
    expect(screen.getByTestId('activity-filters-done')).toHaveTextContent('Show 1 loaded line');
    await fireEvent.press(screen.getByTestId('activity-filters-done'));
    expect(screen.getByTestId('activity-count')).toHaveTextContent('1 of the 4 loaded match');
    expect(screen.getByTestId('activity-chip-who')).toHaveTextContent('Pat');
    expect(screen.getByTestId('activity-chip-kind')).toHaveTextContent('Opened and downloaded');
    expect(screen.getByTestId('activity-filters').props.accessibilityLabel).toBe('Filters: 2 on');
    expect(screen.queryByTestId('activity-line-2')).toBeNull();
    expect(screen.getByTestId('activity-line-4')).toBeTruthy();
    // A chip's tap takes it off.
    await fireEvent.press(screen.getByTestId('activity-chip-kind'));
    expect(screen.getByTestId('activity-count')).toHaveTextContent('2 of the 4 loaded match');

    // Anybody else: the link's opening alone; then days, typed.
    await fireEvent.press(screen.getByTestId('activity-filters'));
    await fireEvent.press(screen.getByTestId('activity-who-else'));
    expect(screen.getByTestId('activity-filters-done')).toHaveTextContent('Show 1 loaded line');
    await fireEvent.press(screen.getByTestId('activity-who-everybody'));
    await fireEvent.changeText(screen.getByTestId('activity-from'), 'soon');
    expect(screen.getByText('Not a date: write it as 10 Nov 2026')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('activity-from'), '13 Nov 2026');
    await fireEvent.changeText(screen.getByTestId('activity-to'), '14 Nov 2026');
    expect(screen.getByTestId('activity-filters-done')).toHaveTextContent('Show 2 loaded lines');
    await fireEvent.press(screen.getByTestId('activity-filters-done'));
    expect(screen.getByTestId('activity-chip-from')).toHaveTextContent('From 13 Nov 2026');
    expect(screen.getByTestId('activity-chip-to')).toHaveTextContent('To 14 Nov 2026');
    await fireEvent.press(screen.getByTestId('activity-filters'));
    await fireEvent.changeText(screen.getByTestId('activity-from'), '1 Dec 2026');
    await fireEvent.press(screen.getByTestId('activity-filters-done'));
    expect(screen.getByTestId('activity-empty')).toHaveTextContent('Nothing matches these filters.');
    await fireEvent.press(screen.getByTestId('activity-filters'));
    await fireEvent.press(screen.getByTestId('activity-filters-clear'));
    await fireEvent.press(screen.getByTestId('activity-filters-done'));
    expect(screen.getByTestId('activity-count')).toHaveTextContent('4 loaded');
    expect(screen.queryByTestId('activity-chip-from')).toBeNull();
  });

  it('Show older loads the next page after the last, and goes when there is no more', async () => {
    const t = vault();
    const asked: string[] = [];
    const real = t.fetch;
    t.fetch = async (url, init) => {
      if (url.includes('/api/v1/audit')) {
        asked.push(url.slice(ORIGIN.length));
        return url.includes('before=7')
          ? respond(200, { items: [line({ id: 6, text: 'Pat looked at “Lease”' })], next: null })
          : respond(200, { items: [line({ id: 8, text: 'Fake Owner added “Lease”' }), line({ id: 7, text: 'Pat changed “Lease”' })], next: 7 });
      }
      return real(url, init);
    };
    await unlocked(t, <ActivityScreen />);
    expect(await screen.findByTestId('activity-count')).toHaveTextContent('2 loaded');
    await fireEvent.press(screen.getByTestId('activity-older'));
    expect(await screen.findByText('Pat looked at “Lease”')).toBeTruthy();
    expect(screen.getByTestId('activity-count')).toHaveTextContent('3 loaded');
    expect(asked).toEqual(['/api/v1/audit', '/api/v1/audit?before=7']);
    expect(screen.queryByTestId('activity-older')).toBeNull();
  });

  it('nothing yet: says so', async () => {
    const t = vault();
    await unlocked(t, <ActivityScreen />);
    expect(await screen.findByTestId('activity-empty')).toHaveTextContent('Nothing yet.');
  });
});

describe('a document’s own Activity (DA)', () => {
  it('its page has Activity, which opens its lines alone, said by a chip whose × shows everything', async () => {
    const t = vault();
    happened(t);
    await unlocked(t, <DocumentDetail id="passport" />);
    const row = await screen.findByTestId('document-activity');
    expect(row.props.accessibilityHint).toBe('Who added, changed, opened or shared it, and when');
    await fireEvent.press(row);
    expect(routes().at(-1)).toEqual({ pathname: '/activity', params: { document: 'passport' } });
  });

  it('the lines about it — its links opened, too — and the chip that names it', async () => {
    const t = vault();
    happened(t);
    await unlocked(t, <ActivityScreen document="passport" />);
    expect(await screen.findByTestId('activity-count')).toHaveTextContent('3 loaded');
    await waitFor(() => expect(screen.getByTestId('activity-document-chip')).toHaveTextContent('About ‘Passport’'));
    expect(screen.queryByTestId('activity-line-4')).toBeNull();
    // A line about this document does not open it again.
    expect(screen.getByTestId('activity-line-3').props.accessibilityRole).toBeUndefined();
    expect(t.calls.some((c) => c.includes('/documents/passport/activity'))).toBe(true);
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByTestId('activity-document-chip'));
    expect(await screen.findByTestId('activity-count')).toHaveTextContent('4 loaded');
    expect(screen.queryByTestId('activity-document-chip')).toBeNull();
  });

  it('a sensitive one is “a sensitive document”; nothing about it yet says so', async () => {
    const t = vault();
    doc(t, 'lab', 'Blood test', { sensitive_effective: true });
    await unlocked(t, <ActivityScreen document="lab" />);
    await waitFor(() => expect(screen.getByTestId('activity-document-chip')).toHaveTextContent('About a sensitive document'));
    expect(screen.getByTestId('activity-empty')).toHaveTextContent('Nothing in the activity log is about this document yet.');
  });

  it('an older vault: the page has no Activity, and the screen shows the whole log', async () => {
    const t = vault({ older: true });
    happened(t);
    await unlocked(t, <DocumentDetail id="passport" />);
    await screen.findByTestId('document-versions');
    expect(screen.queryByTestId('document-activity')).toBeNull();
    resetRoutes();
    await unlocked(t, <ActivityScreen document="passport" />);
    expect(await screen.findByTestId('activity-count')).toHaveTextContent('4 loaded');
    expect(screen.queryByTestId('activity-document-chip')).toBeNull();
  });

  it('a viewer’s page has no Activity', async () => {
    const t = vault({ role: 'viewer' });
    happened(t);
    await unlocked(t, <DocumentDetail id="passport" />);
    await screen.findByTestId('document-versions');
    expect(screen.queryByTestId('document-activity')).toBeNull();
  });
});
