import { addDays, localToday, type ReminderView } from '@fdv/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import AttentionScreen from '../app/attention';
import { DocumentDetail } from '../documents/detail';
import { audit } from '../test-support/a11y';
import { libraryDoc, unlocked } from '../test-support/lookup';
import { installed } from '../test-support/render';
import { resetRoutes } from '../test-support/router';
import { testVault } from '../test-support/vault';

jest.mock(
  'expo-router',
  () => jest.requireActual<typeof import('../test-support/router')>('../test-support/router').routerMock,
);

const ORIGIN = 'https://vault.test';

beforeEach(() => {
  installed();
  resetRoutes();
});

const today = () => localToday(Intl.DateTimeFormat().resolvedOptions().timeZone);

function reminder(id: string, over: Partial<ReminderView> = {}): ReminderView {
  return {
    id,
    document_id: 'passport',
    document_title: 'Passport',
    kind: 'derived',
    fire_at: '2026-09-20',
    lead_days: 90,
    note: null,
    recurrence: null,
    status: 'due',
    snoozed_until: null,
    label: 'Expires in 12 days',
    ...over,
  } as ReminderView;
}

describe('Remind me, from a document (reminders you set yourself)', () => {
  it('a quick choice or a typed day, and a note; then it is in Needs attention', async () => {
    const t = testVault([ORIGIN]);
    libraryDoc(t, { id: 'passport', title: 'Passport' });
    await unlocked(t, <DocumentDetail id="passport" />);
    await fireEvent.press(await screen.findByTestId('document-more'));
    await fireEvent.press(await screen.findByTestId('document-remind'));
    expect(await screen.findByTestId('remind-question')).toBeTruthy();
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByTestId('remind-in-week'));
    expect(screen.getByTestId('remind-day').props.value).toMatch(/^\d{1,2} \w{3} \d{4}$/);
    await fireEvent.changeText(screen.getByTestId('remind-note'), 'Book the renewal');
    await fireEvent.press(screen.getByTestId('remind-yes'));
    expect(await screen.findByTestId('document-notice')).toHaveTextContent(/^You will be reminded on /);
    const made = t.upcoming.find((r) => r.kind === 'manual');
    expect(made).toEqual(
      expect.objectContaining({ document_id: 'passport', fire_at: addDays(today(), 7), note: 'Book the renewal' }),
    );
  });

  it('what is not a day is said, and nothing is set', async () => {
    const t = testVault([ORIGIN]);
    libraryDoc(t, { id: 'passport', title: 'Passport' });
    await unlocked(t, <DocumentDetail id="passport" />);
    await fireEvent.press(await screen.findByTestId('document-more'));
    await fireEvent.press(await screen.findByTestId('document-remind'));
    await fireEvent.changeText(await screen.findByTestId('remind-day'), 'soon');
    await fireEvent.press(screen.getByTestId('remind-yes'));
    expect(await screen.findByTestId('remind-problem')).toHaveTextContent(/^Not a date: write it as /);
    expect([...t.reminders, ...t.upcoming]).toEqual([]);
  });

  it('never on a document no longer needed', async () => {
    const t = testVault([ORIGIN]);
    libraryDoc(t, {
      id: 'passport',
      title: 'Passport',
      no_longer_needed: { at: '2026-11-01T10:00:00Z', by_name: null, reason: null, replaced_by: null },
    } as never);
    await unlocked(t, <DocumentDetail id="passport" />);
    await fireEvent.press(await screen.findByTestId('document-more'));
    await screen.findByTestId('document-trash');
    expect(screen.queryByTestId('document-remind')).toBeNull();
  });
});

describe('a reminder you set yourself, in Needs attention', () => {
  it('shows its note, and Delete removes it after asking; one from a date has no Delete', async () => {
    const t = testVault([ORIGIN]);
    t.reminders = [
      reminder('mine-1', { kind: 'manual', note: 'Check the meter', label: 'Due today', source: null, about: null }),
      reminder('r-derived'),
    ];
    await unlocked(t, <AttentionScreen />);
    expect(await screen.findByTestId('note-mine-1')).toHaveTextContent('Check the meter');
    expect(screen.queryByTestId('remove-r-derived')).toBeNull();
    await fireEvent.press(screen.getByTestId('remove-mine-1'));
    expect(await screen.findByText('Delete this reminder?')).toBeTruthy();
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByTestId('remove-cancel'));
    expect(t.reminders.map((r) => r.id)).toContain('mine-1');
    await fireEvent.press(screen.getByTestId('remove-mine-1'));
    await fireEvent.press(await screen.findByTestId('remove-yes'));
    await waitFor(() => expect(t.reminders.map((r) => r.id)).toEqual(['r-derived']));
    await waitFor(() => expect(screen.queryByTestId('reminder-mine-1')).toBeNull());
  });
});
