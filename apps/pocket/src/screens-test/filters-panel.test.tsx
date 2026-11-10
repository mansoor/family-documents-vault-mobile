import { addDays } from '@fdv/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import DocumentsScreen from '../app/(tabs)/documents';
import { listQuery, NO_FILTERS, quickRange, searchQuery, toggle } from '../documents/filter-model';
import { audit } from '../test-support/a11y';
import { unlocked } from '../test-support/lookup';
import { installed } from '../test-support/render';
import { resetRoutes } from '../test-support/router';
import { capabilities, testVault, type TestVault } from '../test-support/vault';

jest.mock(
  'expo-router',
  () => jest.requireActual<typeof import('../test-support/router')>('../test-support/router').routerMock,
);

const ORIGIN = 'https://vault.test';

beforeEach(() => {
  installed();
  resetRoutes();
});

/** The list's queries as this screen asked them (not the panel's counts, of one row). */
const asked = (t: TestVault) =>
  t.calls
    .filter((c) => c.startsWith(`GET ${ORIGIN}/api/v1/documents?`))
    .map((c) => Object.fromEntries(new URL(c.slice(4)).searchParams))
    .filter((q) => q.sort !== undefined && q.limit !== '1');

/** A vault of 0.9.0 with V1's filters (several, and days), or an older one with the table only. */
function vault(several = true): TestVault {
  const t = testVault([ORIGIN]);
  t.caps = capabilities({
    server_version: '0.9.0',
    features: { ...capabilities().features, document_table: true, ...(several ? { document_filters: true } : {}) },
  });
  t.vault.state.documents.push(
    { id: 'p1', title: 'Passport', type_key: 'passport', owner_member_id: 'fake-member', tags: [], extra: {} } as never,
    { id: 'b1', title: 'Bank', type_key: 'bank_statement', owner_member_id: null, tags: [], extra: {} } as never,
  );
  return t;
}

async function openPanel() {
  await fireEvent.press(await screen.findByTestId('documents-filters'));
  return screen.findByTestId('filter-status-expired');
}

describe('the filters, as each vault is asked (R5)', () => {
  const today = '2026-11-10';

  it('several, comma-separated, and the days, where the vault takes them; one of each where not', () => {
    const f = {
      ...NO_FILTERS,
      people: ['a', 'none'],
      kinds: ['passport', 'will'],
      statuses: ['expired' as const],
      date: quickRange('expires', 'next90', today),
    };
    expect(listQuery(f, { sort: 'title', table: true, several: true })).toEqual({
      sort: 'title',
      direction: 'asc',
      member_id: 'a,none',
      type_key: 'passport,will',
      status: 'expired',
      expires_from: '2026-11-10',
      expires_to: addDays('2026-11-10', 90),
    });
    expect(listQuery(f, { sort: 'recent', table: false, several: false })).toEqual({
      sort: 'recent',
      member_id: 'a',
      type_key: 'passport',
      status: 'expired',
    });
    // An older search narrows by one person and the kind's category; never nobody's.
    expect(searchQuery(f, { several: false, categoryOf: (k) => (k === 'passport' ? 'identity' : null) })).toEqual({
      member_id: 'a',
      category: 'identity',
    });
    expect(searchQuery(f, { several: true, categoryOf: () => null })).toEqual(
      expect.objectContaining({ member_id: 'a', type_key: 'passport,will', expires_from: '2026-11-10' }),
    );
  });

  it('a choice on an older vault replaces the one before', () => {
    expect(toggle(['a'], 'b', true)).toEqual(['a', 'b']);
    expect(toggle(['a'], 'b', false)).toEqual(['b']);
    expect(toggle(['a', 'b'], 'a', true)).toEqual(['b']);
  });

  it('quick ranges, on the family’s calendar', () => {
    expect(quickRange('expires', 'past', today)).toEqual(expect.objectContaining({ from: null, to: '2026-11-09' }));
    expect(quickRange('issued', 'lastYear', today)).toEqual(
      expect.objectContaining({ from: '2025-01-01', to: '2025-12-31' }),
    );
    expect(quickRange('added', 'thisYear', today)).toEqual(expect.objectContaining({ from: '2026-01-01', to: today }));
    // From 29 February, five years back is still a day.
    expect(quickRange('issued', 'last5Years', '2028-02-29').from).toBe('2023-03-01');
  });
});

describe('the filter panel (R5)', () => {
  it('several people, kinds and statuses, and a date; counted before it is left; then chips, each taken off', async () => {
    const t = vault();
    await unlocked(t, <DocumentsScreen />);
    await waitFor(() => expect(screen.getAllByTestId(/^doc-row-/)).toHaveLength(2));
    await openPanel();
    expect(audit()).toEqual([]);

    await fireEvent.press(screen.getByTestId('filter-person-fake-member'));
    await fireEvent.press(screen.getByTestId('filter-kind-passport'));
    // The rest of the kinds, in the picker behind the ⋯.
    await fireEvent.press(screen.getByTestId('filter-kinds-more'));
    await fireEvent.press(await screen.findByTestId('filter-kinds-pick-bank_statement'));
    await fireEvent.press(screen.getByTestId('filter-kinds-done'));
    await fireEvent.press(screen.getByTestId('filter-status-expired'));
    await fireEvent.press(screen.getByTestId('filter-status-valid'));
    await fireEvent.press(screen.getByTestId('filter-quick-next90'));
    // How many, asked of the vault as the choices change.
    await waitFor(() => expect(screen.getByTestId('filters-apply')).toHaveTextContent(/^Show \d+ documents?$/));
    await fireEvent.press(screen.getByTestId('filters-apply'));

    await waitFor(() =>
      expect(asked(t).at(-1)).toEqual(
        expect.objectContaining({
          member_id: 'fake-member',
          type_key: 'passport,bank_statement',
          status: 'expired,valid',
          expires_from: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
          expires_to: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        }),
      ),
    );
    expect(asked(t).at(-1)?.expires_to).toBe(addDays(asked(t).at(-1)?.expires_from as string, 90));
    expect(screen.getByTestId('documents-filters').props.accessibilityLabel).toBe('Filters: 4 on');
    expect(screen.getByTestId('documents-chip-people')).toHaveTextContent(/^Fake Owner/);
    expect(screen.getByTestId('documents-chip-date')).toHaveTextContent('Expires in 90 days');
    await fireEvent.press(screen.getByTestId('documents-chip-date'));
    await waitFor(() => expect(asked(t).at(-1)?.expires_from).toBeUndefined());
    await fireEvent.press(screen.getByTestId('documents-chips-clear'));
    await waitFor(() => expect(asked(t).at(-1)).toEqual({ sort: 'recent', limit: '50' }));
  });

  it('days typed as the card takes them: a month is all of it; what is not a day is said, and waits', async () => {
    const t = vault();
    await unlocked(t, <DocumentsScreen />);
    await openPanel();
    await fireEvent.press(screen.getByTestId('filter-date-issued'));
    await fireEvent.changeText(screen.getByTestId('filter-from'), '1 Jan 2030');
    await fireEvent.changeText(screen.getByTestId('filter-to'), 'soon');
    expect(screen.getByText('Not a date: write it as 10 Nov 2026')).toBeTruthy();
    expect(screen.getByTestId('filters-apply').props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );
    await fireEvent.changeText(screen.getByTestId('filter-to'), 'Feb 2030');
    await fireEvent.press(screen.getByTestId('filters-apply'));
    await waitFor(() =>
      expect(asked(t).at(-1)).toEqual(
        expect.objectContaining({ issued_from: '2030-01-01', issued_to: '2030-02-28' }),
      ),
    );
    expect(screen.getByTestId('documents-chip-date')).toHaveTextContent('Issued 1 Jan 2030 – 28 Feb 2030');
  });

  it('an older vault: one of each, and no dates, said so', async () => {
    const t = vault(false);
    await unlocked(t, <DocumentsScreen />);
    await openPanel();
    expect(screen.getByTestId('filters-older')).toBeTruthy();
    expect(screen.queryByTestId('filter-date-expires')).toBeNull();
    expect(screen.queryByTestId('filter-person-none')).toBeNull();
    await fireEvent.press(screen.getByTestId('filter-status-expired'));
    await fireEvent.press(screen.getByTestId('filter-status-valid'));
    expect(screen.getByTestId('filter-status-expired').props.accessibilityState).toEqual(
      expect.objectContaining({ selected: false }),
    );
    await fireEvent.press(screen.getByTestId('filters-apply'));
    await waitFor(() => expect(asked(t).at(-1)).toEqual(expect.objectContaining({ status: 'valid' })));
  });

  it('closed without Show, nothing changes', async () => {
    const t = vault();
    await unlocked(t, <DocumentsScreen />);
    await openPanel();
    await fireEvent.press(screen.getByTestId('filter-status-expired'));
    await fireEvent.press(screen.getByTestId('filters-close'));
    expect(screen.queryByTestId('documents-chip-statuses')).toBeNull();
    expect(asked(t).every((q) => q.status === undefined)).toBe(true);
  });

  it('with words in the box, the search is narrowed by them too (V1)', async () => {
    const t = vault();
    t.library.search = () => ({ items: [], sealed: 0 });
    await unlocked(t, <DocumentsScreen />);
    await openPanel();
    await fireEvent.press(screen.getByTestId('filter-kind-passport'));
    await fireEvent.press(screen.getByTestId('filters-apply'));
    await fireEvent.changeText(screen.getByTestId('search-field'), 'renew');
    await waitFor(() =>
      expect(t.calls.some((c) => c.includes('/api/v1/search?') && c.includes('q=renew') && c.includes('type_key=passport'))).toBe(
        true,
      ),
    );
  });
});
