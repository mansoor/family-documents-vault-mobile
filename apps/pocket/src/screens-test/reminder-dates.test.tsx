import { REMIND_ONCE, type ReminderView } from '@fdv/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Text } from 'react-native';
import AttentionScreen from '../app/(tabs)/attention';
import Home from '../app/(tabs)/index';
import CaptureScreen from '../app/capture';
import { fixtureScanner } from '../capture/scanner';
import { useCapture } from '../state/capture';
import { useVault } from '../state/vault';
import { jpeg, reply } from '../test-support/capture';
import { ownerApi } from '../test-support/kinds';
import { libraryDoc, unlocked } from '../test-support/lookup';
import { installed, renderApp, signedIn, testCapture } from '../test-support/render';
import { resetRoutes } from '../test-support/router';
import { capabilities, testVault, type TestVault } from '../test-support/vault';

jest.mock(
  'expo-router',
  () => jest.requireActual<typeof import('../test-support/router')>('../test-support/router').routerMock,
);

/**
 * Reminders from any date (the vault's 0.5.15/0.5.16, on the phone in
 * 5.31): a bill reminds before its due date, and says so under it; its
 * reminder reads the date it is about; and it is paid, not replaced.
 */

const ORIGIN = 'https://vault.test';
const PROMISE = "We'll remind you 7 days and 1 day before its due date.";

/** A vault that keeps each kind's details (0.5.11), and with `dates`, says which date reminds (0.5.16). */
function vaultOf(dates: boolean): TestVault {
  const t = testVault([ORIGIN]);
  t.caps = capabilities({
    server_version: dates ? '0.5.32' : '0.5.11',
    features: { ...capabilities().features, custom_types: true, ...(dates ? { reminder_dates: true } : {}) },
  });
  return t;
}

/** The household's Council tax: a bill, reminded 7 days and 1 day before its Due date. */
async function councilTax(t: TestVault) {
  const { api, token } = await ownerApi(t.vault);
  return api.createDocumentType(token, {
    label: 'Council tax',
    category: 'bills',
    fields: [{ key: 'due_date' }],
    remind_from: 'due_date',
    remind_leads: [7, 1],
  });
}

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

/** What Home will say once the scan is safe: the note the card left. */
function SavedNote() {
  const { saved } = useCapture();
  return <Text testID="saved-note">{saved ? (saved.reminder ?? '(none)') : ''}</Text>;
}

async function cardFor(t: TestVault, beside?: ReactElement) {
  await councilTax(t);
  await signedIn(t);
  const phone = testCapture({ scanner: fixtureScanner([{ kind: 'pages', pages: [{ uri: 'cache:/scan/1.jpg' }] }]) });
  phone.files.set('cache:/scan/1.jpg', jpeg('card.jpg'));
  await renderApp(
    <>
      <Scanned />
      {beside}
    </>,
    { fetch: t.fetch, capture: phone },
  );
  await screen.findByText('What it is');
  // Council tax is the household's own: found under More.
  await fireEvent.press(screen.getByTestId('types-more'));
  await fireEvent.changeText(screen.getByTestId('types-search'), 'Council');
  await fireEvent.press(await screen.findByText('Council tax'));
  await fireEvent.press(screen.getByTestId('more-details'));
  await screen.findByTestId('field-detail-due_date');
}

function reminder(over: Partial<ReminderView> & { id: string; document_id: string }): ReminderView {
  return {
    document_title: 'Council tax, March',
    kind: 'derived',
    fire_at: '2026-10-03',
    lead_days: 7,
    note: null,
    recurrence: null,
    status: 'due',
    snoozed_until: null,
    label: 'Overdue by 1 day',
    ...over,
  };
}

/** A bill's reminder, as a vault of 0.5.16 answers it; and a passport's. */
function bothKinds(t: TestVault) {
  libraryDoc(t, { id: 'bill', title: 'Council tax, March', type_key: 'council_tax' });
  libraryDoc(t, { id: 'passport', title: 'Passport', type_key: 'passport' });
  t.reminders = [
    reminder({ id: 'r-bill', document_id: 'bill', source: 'due_date', about: 'Due date: 10 Oct, in 7 days' }),
    reminder({
      id: 'r-pass',
      document_id: 'passport',
      document_title: 'Passport',
      label: 'Due today',
      source: 'expires',
      about: 'Expires: 2 Jan, in 90 days',
    }),
  ];
}

beforeEach(() => {
  installed();
  resetRoutes();
});

describe('reminders from any date (5.31)', () => {
  it('a Due-date kind shows its sentence under the due date', async () => {
    const t = vaultOf(true);
    await cardFor(t);
    // Directly under the date it is about, with the 'once' line.
    const date = screen.getByTestId('date-due_date');
    expect(within(date).getByTestId('field-detail-due_date')).toBeTruthy();
    expect(within(date).getByText(PROMISE)).toBeTruthy();
    expect(within(date).getByText(REMIND_ONCE)).toBeTruthy();
    // Said once: not also at the foot of the card.
    expect(screen.getAllByText(PROMISE)).toHaveLength(1);
    expect(within(date).queryByTestId('capture-reminder-only-me')).toBeNull();
    // On an Only me document — the owner's own — what the vault can read of it.
    await fireEvent.press(screen.getByText(/^Fake Owner/));
    await fireEvent.press(screen.getByTestId('visibility-private'));
    expect(within(screen.getByTestId('date-due_date')).getByTestId('capture-reminder-only-me')).toHaveTextContent(
      'The vault can read this date, so it can remind you. Your other details stay sealed.',
    );
    // More details closed: the promise stays on the card, at its foot, as before.
    await fireEvent.press(screen.getByTestId('more-details'));
    expect(screen.getByTestId('capture-reminder')).toHaveTextContent(PROMISE);
    expect(screen.queryByText(REMIND_ONCE)).toBeNull();
  });

  it.each([
    ['ahead', '01/09/2099', PROMISE],
    // A paid bill filed afterwards: the vault makes no reminder for a date gone (0.5.15).
    ['gone', '01/09/2020', 'Its due date has passed, so no reminder is set.'],
  ])('saved, the note promises reminders only for a due date still %s', async (_when, typed, words) => {
    const t = vaultOf(true);
    await cardFor(t, <SavedNote />);
    await fireEvent.changeText(screen.getByTestId('field-detail-due_date'), typed);
    await fireEvent.press(screen.getByTestId('capture-save'));
    await waitFor(() => expect(screen.getByTestId('saved-note')).toHaveTextContent(words));
  });

  it('a reminder about a due date reads its line and offers no Scan the new one', async () => {
    const t = vaultOf(true);
    bothKinds(t);
    await unlocked(t, <AttentionScreen />);
    // The date it is about, never "Overdue by 1 day" above a bill still ahead.
    expect(await screen.findByText('Due date: 10 Oct, in 7 days')).toBeTruthy();
    expect(screen.queryByText('Overdue by 1 day')).toBeNull();
    expect(screen.getByText('Expires: 2 Jan, in 90 days')).toBeTruthy();
    // A bill is paid, not replaced; a passport is renewed.
    expect(screen.queryByTestId('scan-new-bill')).toBeNull();
    expect(screen.getByTestId('scan-new-passport')).toBeTruthy();
  });

  it('Home reads the same line, and offers Scan the new one only for an expiry', async () => {
    const t = vaultOf(true);
    bothKinds(t);
    await unlocked(t, <Home />);
    expect(await screen.findByText('Due date: 10 Oct, in 7 days')).toBeTruthy();
    expect(screen.queryByText('Overdue by 1 day')).toBeNull();
    expect(screen.queryByTestId('renew-bill')).toBeNull();
    expect(screen.getByTestId('renew-passport')).toBeTruthy();
  });

  it("put off, the row shows the vault's answer: a bill's snooze stops at its date", async () => {
    const t = vaultOf(true);
    bothKinds(t);
    // A month asked for, nine days given (the vault stops it at the due date), and listed as coming up.
    const fetch: TestVault['fetch'] = async (url, init) => {
      const res = await t.fetch(url, init);
      if (!url.endsWith('/api/v1/reminders/r-bill/snooze')) return res;
      const answer = reminder({
        id: 'r-bill',
        document_id: 'bill',
        source: 'due_date',
        about: 'Due date: 10 Oct, in 9 days',
        status: 'snoozed',
        snoozed_until: '2026-10-10',
        label: 'Later · 10 Oct',
      });
      t.upcoming = [answer];
      return reply(200, answer);
    };
    await unlocked({ ...t, fetch }, <AttentionScreen />);
    await fireEvent.press(await screen.findByTestId('snooze-month-r-bill'));
    expect(await screen.findByTestId('when-r-bill')).toHaveTextContent('Later · 10 Oct');
    expect(screen.getByText('Due date: 10 Oct, in 9 days')).toBeTruthy();
  });

  it('nothing new is shown with a vault without the flag', async () => {
    // The card: the same bill, from a vault that does not say which date reminds.
    const t = vaultOf(false);
    await cardFor(t);
    expect(screen.queryByTestId('date-due_date')).toBeNull();
    expect(screen.queryByText(PROMISE)).toBeNull();
    expect(screen.queryByText(REMIND_ONCE)).toBeNull();
  });

  it('nothing new on the reminder rows with a vault from before reminder dates', async () => {
    const t = vaultOf(false);
    libraryDoc(t, { id: 'passport', title: 'Passport' });
    // As a vault of 0.5.11 answers: no source, no about.
    t.reminders = [reminder({ id: 'r1', document_id: 'passport', document_title: 'Passport', label: 'Due today' })];
    await unlocked(t, <AttentionScreen />);
    expect(await screen.findByText('Due today')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('scan-new-passport')).toBeTruthy());
  });
});
