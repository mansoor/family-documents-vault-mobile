import { addDays, localToday, type ReminderView } from '@fdv/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import AttentionScreen from '../app/(tabs)/attention';
import { fixtureScanner } from '../capture/scanner';
import { MemoryQueueStore } from '../queue/store';
import { audit } from '../test-support/a11y';
import { jpeg } from '../test-support/capture';
import { libraryDoc, unlocked } from '../test-support/lookup';
import { installed, testCapture } from '../test-support/render';
import { resetRoutes } from '../test-support/router';
import { testVault } from '../test-support/vault';

jest.mock(
  'expo-router',
  () => jest.requireActual<typeof import('../test-support/router')>('../test-support/router').routerMock,
);

const ORIGIN = 'https://vault.test';

function reminder(over: Partial<ReminderView> & { id: string; document_id: string }): ReminderView {
  return {
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
  };
}

beforeEach(() => {
  installed();
  resetRoutes();
});

describe('Needs attention', () => {
  it('snooze a week moves it out of due', async () => {
    const t = testVault([ORIGIN]);
    t.reminders = [reminder({ id: 'r1', document_id: 'passport' })];
    t.upcoming = [reminder({ id: 'r2', document_id: 'card', document_title: 'Bank card', label: 'In 40 days' })];
    await unlocked(t, <AttentionScreen />);
    expect(await screen.findByText('Expires in 12 days')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('snooze-week-r1'));
    await waitFor(() => expect(screen.queryByText('Expires in 12 days')).toBeNull());
    const today = localToday(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(t.library.snoozed).toEqual([{ id: 'r1', until: addDays(today, 7) }]);
    // What is coming up is still there; Done takes it away too.
    expect(screen.getByText('In 40 days')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('done-r2'));
    expect(await screen.findByTestId('attention-calm')).toHaveTextContent('Nothing needs you right now.');
    expect(t.library.acknowledged).toEqual(['r2']);
  });

  it('Scan the new one queues a version', async () => {
    const t = testVault([ORIGIN]);
    libraryDoc(t, { id: 'passport', title: 'Passport' });
    t.reminders = [reminder({ id: 'r1', document_id: 'passport' })];
    const store = new MemoryQueueStore();
    const phone = testCapture({
      scanner: fixtureScanner([{ kind: 'pages', pages: [{ uri: 'cache:/scan/1.jpg' }] }]),
      openStore: async () => store,
    });
    phone.files.set('cache:/scan/1.jpg', jpeg('card.jpg'));
    await unlocked(t, <AttentionScreen />, { capture: phone });
    await fireEvent.press(await screen.findByTestId('scan-new-passport'));
    await waitFor(async () =>
      expect((await store.list()).map((i) => [i.kind, i.target])).toEqual([['version', 'passport']]),
    );
    // Queued: not offered again while it waits to go.
    await waitFor(() => expect(screen.queryByTestId('scan-new-passport')).toBeNull());
  });

  it('can be used with a screen reader and a thumb', async () => {
    const t = testVault([ORIGIN]);
    t.reminders = [reminder({ id: 'r1', document_id: 'passport' })];
    await unlocked(t, <AttentionScreen />);
    await screen.findByText('Expires in 12 days');
    expect(audit()).toEqual([]);
  });
});
