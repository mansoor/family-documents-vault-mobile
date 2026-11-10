import type { ReminderView } from '@fdv/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import Home from '../app/(tabs)/index';
import DocumentsScreen from '../app/(tabs)/documents';
import { countAlert, hide, prefsName, prune, reminderAlert, shows, unhide, type Hidden } from '../home/alerts';
import { fileNameOf } from '../platform/prefs';
import { audit } from '../test-support/a11y';
import { unlocked } from '../test-support/lookup';
import { installed } from '../test-support/render';
import { push, resetRoutes, routes } from '../test-support/router';
import { capabilities, testVault, type TestVault } from '../test-support/vault';

jest.mock(
  'expo-router',
  () => jest.requireActual<typeof import('../test-support/router')>('../test-support/router').routerMock,
);

const ORIGIN = 'https://vault.test';
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  installed();
  resetRoutes();
});

function reminder(id: string, over: Partial<ReminderView> = {}): ReminderView {
  return {
    id,
    document_id: `doc-${id}`,
    document_title: `Passport ${id}`,
    kind: 'derived',
    fire_at: '2026-09-20T00:00:00Z',
    lead_days: 90,
    note: null,
    recurrence: null,
    status: 'due',
    snoozed_until: null,
    label: 'Expires in 26 days',
    ...over,
  } as ReminderView;
}

describe("Home's alerts, hidden for a while (R4): the rules", () => {
  const now = Date.parse('2026-11-10T09:00:00Z');

  it('hidden for days: back when they are over, or sooner if it changes', () => {
    const a = reminderAlert(reminder('r1'));
    const hidden = hide({}, a, 7, now);
    expect(shows(a, hidden, now + 6 * DAY)).toBe(false);
    expect(shows(a, hidden, now + 7 * DAY)).toBe(true);
    // Snoozed meanwhile, or its date moved: it says something new.
    expect(shows(reminderAlert(reminder('r1', { fire_at: '2026-12-01T00:00:00Z' })), hidden, now + DAY)).toBe(true);
  });

  it('hidden until it changes: the countdown in its words is not a change; its date, its state, a count are', () => {
    const a = reminderAlert(reminder('r1'));
    const hidden = hide({}, a, 'change', now);
    expect(shows(reminderAlert(reminder('r1', { label: 'Expires in 25 days' })), hidden, now + 400 * DAY)).toBe(false);
    expect(shows(reminderAlert(reminder('r1', { status: 'snoozed' })), hidden, now)).toBe(true);
    const unnamed = hide({}, countAlert('unnamed', 2), 'change', now);
    expect(shows(countAlert('unnamed', 2), unnamed, now)).toBe(false);
    expect(shows(countAlert('unnamed', 3), unnamed, now)).toBe(true);
  });

  it('kept under a name a phone may use for a file: nothing of the address but letters, digits, dots, dashes', () => {
    const name = prefsName('http://10.0.2.2:8099|4473223a-d7db-464b-9dfa-58a3d93220e3');
    expect(name).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(name).not.toBe(prefsName('https://10.0.2.2:8099|4473223a-d7db-464b-9dfa-58a3d93220e3'));
    // And whatever a name holds, the phone's file for it is a plain one; a plain name keeps its file.
    expect(fileNameOf('homeHidden.http://x|y')).toBe('homeHidden.http___x_y.json');
    expect(fileNameOf('display')).toBe('display.json');
  });

  it('Undo puts it back; what has gone, or run out, is let go of', () => {
    const a = reminderAlert(reminder('r1'));
    const b = reminderAlert(reminder('r2'));
    let hidden: Hidden = hide(hide({}, a, 1, now), b, 'change', now);
    expect(shows(a, unhide(hidden, a), now)).toBe(true);
    hidden = prune(hidden, [b], now);
    expect(Object.keys(hidden)).toEqual(['reminder:r2']);
    expect(prune(hide({}, a, 1, now), [a], now + 2 * DAY)).toEqual({});
  });
});

describe("Home's alerts (R4)", () => {
  it('a due reminder is an alert with Open; hidden for a week from its ✕, with Undo; nothing says "nothing to do"', async () => {
    const t = testVault([ORIGIN]);
    t.reminders = [reminder('r1')];
    await unlocked(t, <Home />);
    const card = await screen.findByTestId('home-alert-r1');
    expect(card).toHaveTextContent(/^Passport r1/);
    expect(screen.queryByText('Nothing needs you right now.')).toBeNull();
    expect(screen.queryByText('Needs attention')).toBeNull();
    expect(audit()).toEqual([]);

    await fireEvent.press(screen.getByTestId('home-alert-r1-hide'));
    expect(await screen.findByText('Hide this alert')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('alert-hide-7'));
    await waitFor(() => expect(screen.queryByTestId('home-alert-r1')).toBeNull());
    expect(screen.getByTestId('home-alert-hidden')).toHaveTextContent(/^Hidden\. It comes back in a week\./);
    await fireEvent.press(screen.getByTestId('home-alert-undo'));
    expect(await screen.findByTestId('home-alert-r1')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('home-alert-open-r1'));
    expect(routes().at(-1)).toEqual({ pathname: '/document/[id]', params: { id: 'doc-r1' } });
  });

  it('hidden on this phone stays hidden the next time Home is opened', async () => {
    const t = testVault([ORIGIN]);
    t.reminders = [reminder('r1'), reminder('r2')];
    const first = await unlocked(t, <Home />);
    await fireEvent.press(await screen.findByTestId('home-alert-r1-hide'));
    await fireEvent.press(await screen.findByTestId('alert-hide-change'));
    await waitFor(() => expect(screen.queryByTestId('home-alert-r1')).toBeNull());
    await first.app.unmount();

    resetRoutes();
    await unlocked(t, <Home />);
    expect(await screen.findByTestId('home-alert-r2')).toBeTruthy();
    expect(screen.queryByTestId('home-alert-r1')).toBeNull();
  });

  it('three at most; the rest are behind the bell', async () => {
    const t = testVault([ORIGIN]);
    t.reminders = ['a', 'b', 'c', 'd', 'e'].map((id) => reminder(id));
    await unlocked(t, <Home />);
    await screen.findByTestId('home-alert-a');
    expect(screen.queryByTestId('home-alert-d')).toBeNull();
    const more = screen.getByTestId('home-alerts-more');
    expect(more).toHaveTextContent('2 more need attention');
    await fireEvent.press(more);
    expect(routes().at(-1)).toEqual({ pathname: '/attention', params: {} });
  });
});

/** A vault with the Documents table (0.6.0), which counts. */
function counting(t: TestVault, n: number) {
  t.caps = capabilities({ features: { ...capabilities().features, document_table: true } });
  for (let i = 0; i < n; i += 1) {
    t.vault.state.documents.push({ id: `d${i}`, title: `Doc ${i}`, type_key: 'passport', tags: [], extra: {} } as never);
  }
}

describe('Home at a glance (R4)', () => {
  it('counts what the vault counts; each number opens Documents, narrowed; the five added last below', async () => {
    const t = testVault([ORIGIN]);
    counting(t, 7);
    await unlocked(t, <Home />);
    expect(await screen.findByTestId('home-count-documents')).toHaveTextContent('7documents');
    expect(screen.getByTestId('home-count-expiring')).toBeTruthy();
    await screen.findByTestId('home-ready');
    expect(screen.getAllByTestId(/^doc-row-/)).toHaveLength(5);
    await fireEvent.press(screen.getByTestId('home-count-details'));
    expect(routes().at(-1)).toEqual({ pathname: '/documents', params: { status: 'needs_info' } });
  });

  it('an older vault, which does not count: no numbers', async () => {
    const t = testVault([ORIGIN]);
    await unlocked(t, <Home />);
    await screen.findByTestId('home-ready');
    expect(screen.queryByTestId('home-count-documents')).toBeNull();
  });

  it('Documents, opened from a number, is narrowed to it', async () => {
    const t = testVault([ORIGIN]);
    counting(t, 2);
    push({ pathname: '/documents', params: { status: 'expiring_soon' } });
    await unlocked(t, <DocumentsScreen />);
    await waitFor(() =>
      expect(screen.getByTestId('documents-status-expiring_soon').props.accessibilityState).toEqual(
        expect.objectContaining({ selected: true }),
      ),
    );
  });
});
