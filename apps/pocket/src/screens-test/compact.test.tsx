import type { ReminderView } from '@fdv/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import AttentionScreen from '../app/attention';
import { DocumentDetail } from '../documents/detail';
import { audit } from '../test-support/a11y';
import { libraryDoc, unlocked } from '../test-support/lookup';
import { installed } from '../test-support/render';
import { resetRoutes, routes } from '../test-support/router';
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

function reminder(id: string, over: Partial<ReminderView> = {}): ReminderView {
  return {
    id,
    document_id: 'passport',
    document_title: 'Passport',
    kind: 'derived',
    fire_at: '2026-09-20T00:00:00Z',
    lead_days: 90,
    note: null,
    recurrence: null,
    status: 'due',
    snoozed_until: null,
    label: 'Expires in 12 days',
    ...over,
  } as ReminderView;
}

/** A vault of 0.9.0 that counts (the Documents table). */
function counting(): TestVault {
  const t = testVault([ORIGIN]);
  t.caps = capabilities({
    server_version: '0.9.0',
    features: { ...capabilities().features, document_table: true },
  });
  return t;
}

describe('Needs attention, compact (R6)', () => {
  it('Now and Coming up, one at a time, with how many; its name is the header’s, not said twice', async () => {
    const t = testVault([ORIGIN]);
    t.reminders = [reminder('r1'), reminder('r2', { document_id: 'will', document_title: 'Will' })];
    t.upcoming = [reminder('u1', { status: 'scheduled', document_title: 'Licence', label: 'In 40 days · 20 Dec' })];
    await unlocked(t, <AttentionScreen />);
    expect(await screen.findByTestId('attention-now')).toBeTruthy();
    expect(screen.getByTestId('attention-tab-now')).toHaveTextContent('Now (2)');
    expect(screen.getByTestId('attention-tab-coming')).toHaveTextContent('Coming up (1)');
    expect(screen.getByTestId('attention-tab-now').props.accessibilityState).toEqual({ selected: true });
    expect(screen.queryByText('Licence')).toBeNull();
    expect(screen.queryByText('Needs attention')).toBeNull();
    expect(audit()).toEqual([]);

    await fireEvent.press(screen.getByTestId('attention-tab-coming'));
    expect(await screen.findByText('Licence')).toBeTruthy();
    expect(screen.queryByText('Will')).toBeNull();
    // Coming up is not put off from Now's buttons: each row has its own.
    expect(screen.getByTestId('later-u1')).toBeTruthy();
  });

  it('nothing due, something coming: Coming up is shown, and Now says it is empty when chosen', async () => {
    const t = testVault([ORIGIN]);
    t.upcoming = [reminder('u1', { status: 'scheduled', document_title: 'Licence' })];
    await unlocked(t, <AttentionScreen />);
    expect(await screen.findByTestId('attention-coming')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('attention-tab-now'));
    expect(await screen.findByTestId('attention-empty')).toHaveTextContent('Nothing is due now.');
  });

  it('Later asks how long; Cancel puts nothing off', async () => {
    const t = testVault([ORIGIN]);
    t.reminders = [reminder('r1')];
    await unlocked(t, <AttentionScreen />);
    await fireEvent.press(await screen.findByTestId('later-r1'));
    expect(await screen.findByText('Remind me again in')).toBeTruthy();
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByTestId('later-cancel'));
    expect(t.library.snoozed).toEqual([]);
    await fireEvent.press(screen.getByTestId('later-r1'));
    await fireEvent.press(await screen.findByTestId('snooze-month-r1'));
    await waitFor(() => expect(t.library.snoozed).toHaveLength(1));
  });

  it('how many documents need details, where the vault counts, and Review them opens them', async () => {
    const t = counting();
    // A scan with no name or kind yet, in the vault's own list.
    t.vault.state.documents.push({ id: 'blank', title: null, type_key: null, owner_member_id: null, tags: [], extra: {} } as never);
    await unlocked(t, <AttentionScreen />);
    expect(await screen.findByTestId('attention-details')).toHaveTextContent(/^1 document needs details/);
    await fireEvent.press(screen.getByTestId('attention-review'));
    expect(routes()).toEqual([{ pathname: '/documents', params: { status: 'needs_info' } }]);
  });

  it('an older vault, which does not count, says nothing of details', async () => {
    const t = testVault([ORIGIN]);
    t.reminders = [reminder('r1')];
    await unlocked(t, <AttentionScreen />);
    await screen.findByTestId('attention-now');
    expect(screen.queryByTestId('attention-details')).toBeNull();
  });
});

describe('a document, compact (R6)', () => {
  it('a line of whose, what kind and who can see it; round actions; details in a grid; Edit and ⋯ in the header', async () => {
    const t = testVault([ORIGIN]);
    libraryDoc(t, {
      id: 'passport',
      title: 'Passport',
      issued_by: 'HM Passport Office',
      is_essential: true,
      tags: ['travel'],
    });
    await unlocked(t, <DocumentDetail id="passport" />);
    expect(await screen.findByTestId('document-subline')).toHaveTextContent(/Passport · Everyone in the family$/);
    expect(screen.getByTestId('document-essential-pill')).toHaveTextContent('Essential');
    for (const id of ['document-show', 'document-pages', 'document-save', 'document-add-version'])
      expect(screen.getByTestId(id)).toBeTruthy();
    expect(screen.getByTestId('document-facts')).toHaveTextContent(/Issued byHM Passport Office/);
    expect(screen.getByTestId('document-tags')).toHaveTextContent(/travel/);
    expect(screen.getByTestId('document-edit')).toBeTruthy();
    expect(screen.getByTestId('document-more')).toBeTruthy();
    expect(audit()).toEqual([]);
  });

  it('its versions are one line, opened in place', async () => {
    const t = testVault([ORIGIN]);
    libraryDoc(t, { id: 'bill', title: 'Council tax bill' });
    await unlocked(t, <DocumentDetail id="bill" />);
    const line = await screen.findByTestId('document-versions');
    expect(line).toHaveTextContent(/^Versions1 · added /);
    expect(line.props.accessibilityState).toEqual(expect.objectContaining({ expanded: false }));
    expect(screen.queryByTestId('version-1')).toBeNull();
    await fireEvent.press(line);
    expect(await screen.findByTestId('version-1')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('document-versions'));
    expect(screen.queryByTestId('version-1')).toBeNull();
  });

  it('a note has no actions row and no versions line; its pencil edits it (the gaps review)', async () => {
    const t = testVault([ORIGIN]);
    libraryDoc(t, {
      id: 'n1',
      title: 'Where the spare key is',
      type_key: 'note',
      notes: 'Under the blue pot.',
      notes_updated_at: '2026-11-01T10:00:00Z',
    });
    await unlocked(t, <DocumentDetail id="n1" />);
    expect(await screen.findByTestId('document-notes')).toHaveTextContent(/Under the blue pot\./);
    expect(screen.queryByTestId('document-actions')).toBeNull();
    expect(screen.queryByTestId('document-versions')).toBeNull();
    expect(screen.getByTestId('document-edit')).toBeTruthy();
  });
});
