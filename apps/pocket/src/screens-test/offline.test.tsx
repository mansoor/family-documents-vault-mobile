import type { ReminderView } from '@fdv/shared';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import CaptureScreen from '../app/capture';
import Home from '../app/index';
import Settings from '../app/settings';
import SignIn from '../app/sign-in';
import { fixtureScanner, type ScanOutcome } from '../capture/scanner';
import type { QueueItem } from '../queue/item';
import { MemoryQueueStore } from '../queue/store';
import { useCapture } from '../state/capture';
import { useVault } from '../state/vault';
import { jpeg, reply } from '../test-support/capture';
import { installed, renderApp, signedIn, testCapture } from '../test-support/render';
import { testVault, type TestVault } from '../test-support/vault';

jest.mock('expo-router', () => ({
  Link: (p: { children: unknown }) => p.children,
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
  useNavigation: () => ({ addListener: () => () => undefined, dispatch: jest.fn() }),
}));

const ORIGIN = 'https://vault.test';
const TWO_PAGES: ScanOutcome = { kind: 'pages', pages: [{ uri: 'cache:/scan/1.jpg' }, { uri: 'cache:/scan/2.jpg' }] };

/** What the app shows: Home, or the card while a capture is on it, or sign-in once signed out. */
function App() {
  const { pending } = useCapture();
  const { phase } = useVault();
  if (phase === 'sign_in') return <SignIn />;
  return pending ? <CaptureScreen /> : <Home />;
}

/** Documents as the real vault lists them: with a status. */
function withStatus(t: TestVault): TestVault['fetch'] {
  return async (url, init) => {
    const res = await t.fetch(url, init);
    if (!/\/api\/v1\/documents(\?|$)/.test(url) || init.method !== 'GET') return res;
    const body = (await res.json()) as { items: { type_key: string | null }[] };
    return reply(200, {
      ...body,
      items: body.items.map((d) => ({
        ...d,
        status: d.type_key ? { value: 'valid', label: '' } : { value: 'needs_info', label: 'Needs a name' },
      })),
    });
  };
}

const networkChanged = () =>
  act(() => {
    for (const l of (globalThis as unknown as { __networkListeners: Set<() => void> }).__networkListeners) l();
  });

function item(over: Partial<QueueItem>): QueueItem {
  return {
    id: 'q1',
    kind: 'capture',
    target: null,
    key: '5b1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
    origin: ORIGIN,
    account: 'fake-member',
    createdAt: 1,
    state: 'waiting',
    metadata: { title: 'Waiting letter' },
    filename: 'Scan.pdf',
    mime: 'application/pdf',
    size: 4,
    attempts: 0,
    nextAt: 0,
    askFirst: false,
    problem: null,
    lastCode: null,
    ...over,
  };
}

beforeEach(() => installed());

describe('the card with no connection', () => {
  it('works with what the phone last saw, and the scan goes once the connection is back', async () => {
    const t = testVault([ORIGIN]);
    await signedIn(t);
    const phone = testCapture({ scanner: fixtureScanner([TWO_PAGES]) });
    phone.files.set('cache:/scan/1.jpg', jpeg('letter-with-exif.jpg'));
    phone.files.set('cache:/scan/2.jpg', jpeg('card.jpg'));
    await renderApp(<App />, { fetch: withStatus(t), capture: phone });
    // Online at the start: the card's choices are fetched and kept.
    await screen.findByTestId('home-calm');
    await waitFor(() => expect(t.calls.some((c) => c.includes('/api/v1/members'))).toBe(true));

    // Airplane mode.
    t.reachable.delete(ORIGIN);
    await fireEvent.press(screen.getByTestId('home-scan'));
    await fireEvent.press(await screen.findByRole('button', { name: 'Passport' }));
    await fireEvent.press(screen.getByRole('button', { name: /\(Yours\)$/ }));
    await fireEvent.press(screen.getByTestId('capture-save'));
    expect(await screen.findByTestId('home-saved')).toHaveTextContent(
      /^Saved on this phone\. It'll go to the vault as soon as there's a connection\./,
    );
    expect(t.vault.state.documents).toHaveLength(0);
    expect(await screen.findByText('Waiting to send')).toBeTruthy();

    // The connection comes back.
    t.reachable.add(ORIGIN);
    await networkChanged();
    await waitFor(() => expect(t.vault.state.documents).toHaveLength(1));
    expect(t.vault.state.documents[0]).toMatchObject({ type_key: 'passport', owner_member_id: 'fake-member' });
  });

  it('saved while the vault seemed there, but the first try found no connection: the Saved line says so', async () => {
    const t = testVault([ORIGIN]);
    await signedIn(t);
    const phone = testCapture({ scanner: fixtureScanner([TWO_PAGES]) });
    phone.files.set('cache:/scan/1.jpg', jpeg('letter-with-exif.jpg'));
    phone.files.set('cache:/scan/2.jpg', jpeg('card.jpg'));
    // Everything answers except the upload itself.
    const noUpload: TestVault['fetch'] = async (url, init) => {
      if (url.endsWith('/api/v1/capture')) throw new TypeError('Network request failed');
      return withStatus(t)(url, init);
    };
    await renderApp(<App />, { fetch: noUpload, capture: phone });
    await fireEvent.press(await screen.findByTestId('home-scan'));
    await fireEvent.press(await screen.findByRole('button', { name: 'Passport' }));
    await fireEvent.press(screen.getByTestId('capture-save'));
    await waitFor(() =>
      expect(screen.getByTestId('home-saved')).toHaveTextContent(
        /^Saved on this phone\. It'll go to the vault as soon as there's a connection\./,
      ),
    );
  });

  it('never having seen the choices, offers Skip only', async () => {
    const t = testVault([]);
    await (async () => {
      t.reachable.add(ORIGIN);
      await signedIn(t);
      t.reachable.delete(ORIGIN);
    })();
    const phone = testCapture({ scanner: fixtureScanner([TWO_PAGES]) });
    phone.files.set('cache:/scan/1.jpg', jpeg('letter-with-exif.jpg'));
    phone.files.set('cache:/scan/2.jpg', jpeg('card.jpg'));
    await renderApp(<App />, { fetch: withStatus(t), capture: phone });
    await fireEvent.press(await screen.findByTestId('home-scan'));
    expect(await screen.findByTestId('capture-offline')).toHaveTextContent(/you can name it when you're back online/);
    expect(screen.queryByTestId('capture-save')).toBeNull();
    await fireEvent.press(screen.getByTestId('capture-skip'));
    expect(await screen.findByTestId('home-saved')).toBeTruthy();
  });
});

describe('scans belong to the person who made them', () => {
  it('Home offers to remove scans made by someone else who used this phone', async () => {
    const t = testVault([ORIGIN]);
    await signedIn(t);
    const store = new MemoryQueueStore();
    await store.add(item({ id: 'theirs', account: 'someone-else' }), new Uint8Array([1]));
    await renderApp(<App />, { fetch: withStatus(t), capture: testCapture({ openStore: async () => store }) });
    expect(await screen.findByTestId('home-others')).toHaveTextContent(
      /^This scan was made by someone else who used this phone\. Remove it from this phone\?Remove itKeep it$/,
    );
    await fireEvent.press(screen.getByTestId('home-others-remove'));
    await waitFor(() => expect(screen.queryByTestId('home-others')).toBeNull());
    expect(await store.list()).toEqual([]);
    expect(t.calls.filter((c) => c.endsWith('/api/v1/capture'))).toEqual([]);
  });

  it('signing out asks about scans still waiting, and keeps them for next time', async () => {
    const t = testVault([ORIGIN]);
    await signedIn(t);
    const busy: TestVault['fetch'] = async (url, init) =>
      url.endsWith('/api/v1/capture')
        ? reply(503, { error: { code: 'unavailable', message: 'Busy.', retriable: true } })
        : withStatus(t)(url, init);
    const store = new MemoryQueueStore();
    await store.add(item({}), new Uint8Array([1]));
    function Both() {
      const { phase } = useVault();
      return phase === 'sign_in' ? <SignIn /> : <Settings />;
    }
    await renderApp(<Both />, { fetch: busy, capture: testCapture({ openStore: async () => store }) });
    await fireEvent.press(await screen.findByTestId('settings-sign-out'));
    expect(await screen.findByTestId('sign-out-question')).toHaveTextContent(/A scan hasn't reached the vault yet\./);
    await fireEvent.press(screen.getByTestId('sign-out-keep'));
    // Signed out, the scan is kept — and the sign-in screen says it will go.
    expect(await screen.findByTestId('sign-in-waiting')).toHaveTextContent(
      'A scan is waiting on this phone. It goes to the vault when the person who made it signs in.',
    );
    expect(await store.list()).toHaveLength(1);
  });
});

describe('Needs you, and renewals', () => {
  it('a scan for someone who has left the family is given to someone else, and goes', async () => {
    const t = testVault([ORIGIN]);
    await signedIn(t);
    const store = new MemoryQueueStore();
    await store.add(
      item({
        state: 'needs_you',
        metadata: { title: 'Gym membership', owner_member_id: 'member-gone', visibility: 'household' },
        problem: { status: 422, code: 'validation_failed', message: 'That person is not in the family.' },
      }),
      new TextEncoder().encode('%PDF-1.4\n%%EOF\n'),
    );
    await renderApp(<App />, { fetch: withStatus(t), capture: testCapture({ openStore: async () => store }) });
    expect(await screen.findByText(/The person it was for is no longer in the family/)).toBeTruthy();
    await fireEvent.press(await screen.findByRole('button', { name: 'For Fake Owner' }));
    await waitFor(() => expect(t.vault.state.documents).toHaveLength(1));
    expect(t.vault.state.documents[0]).toMatchObject({ title: 'Gym membership', owner_member_id: 'fake-member' });
  });

  it('Scan the new one: the renewal goes in as the next version of the same document', async () => {
    const t = testVault([ORIGIN]);
    await signedIn(t);
    t.vault.state.documents.push({ id: 'doc-passport', title: "Aisha's passport", type_key: 'passport' });
    const due: ReminderView = {
      id: 'rem-1',
      document_id: 'doc-passport',
      document_title: "Aisha's passport",
      kind: 'derived',
      fire_at: '2026-09-25',
      lead_days: 180,
      note: null,
      recurrence: null,
      status: 'due',
      snoozed_until: null,
      label: 'Expires in 6 months',
    };
    t.reminders = [due];
    const phone = testCapture({ scanner: fixtureScanner([TWO_PAGES]) });
    phone.files.set('cache:/scan/1.jpg', jpeg('letter-with-exif.jpg'));
    phone.files.set('cache:/scan/2.jpg', jpeg('card.jpg'));
    await renderApp(<App />, { fetch: withStatus(t), capture: phone });
    await fireEvent.press(await screen.findByTestId('renew-doc-passport'));
    expect(await screen.findByTestId('home-saved')).toHaveTextContent(/^Saved as the new version\./);
    await waitFor(() => expect(t.calls).toContain(`POST ${ORIGIN}/api/v1/documents/doc-passport/versions`));
    expect(t.vault.state.documents).toHaveLength(1);
    expect(phone.files.size).toBe(0);
  });

  it('Scan the new one shows once per document, and not while its new version is waiting', async () => {
    const t = testVault([ORIGIN]);
    await signedIn(t);
    t.vault.state.documents.push({ id: 'doc-passport', title: "Aisha's passport", type_key: 'passport' });
    const reminder = (id: string, lead: number): ReminderView => ({
      id,
      document_id: 'doc-passport',
      document_title: "Aisha's passport",
      kind: 'derived',
      fire_at: '2026-09-25',
      lead_days: lead,
      note: null,
      recurrence: null,
      status: 'due',
      snoozed_until: null,
      label: 'Expires soon',
    });
    t.reminders = [reminder('r-180', 180), reminder('r-30', 30)];
    const busy: TestVault['fetch'] = async (url, init) =>
      url.includes('/versions') ? reply(503, { error: { code: 'unavailable', message: 'Busy.', retriable: true } }) : withStatus(t)(url, init);
    const phone = testCapture({ scanner: fixtureScanner([TWO_PAGES]) });
    phone.files.set('cache:/scan/1.jpg', jpeg('letter-with-exif.jpg'));
    phone.files.set('cache:/scan/2.jpg', jpeg('card.jpg'));
    await renderApp(<App />, { fetch: busy, capture: phone });
    expect(await screen.findAllByTestId('renew-doc-passport')).toHaveLength(1);
    await fireEvent.press(screen.getByTestId('renew-doc-passport'));
    await screen.findByTestId('home-saved');
    await waitFor(() => expect(screen.queryByTestId('renew-doc-passport')).toBeNull());
  });

  it('a renewal that cannot be kept is deleted from the phone, with the reason', async () => {
    const t = testVault([ORIGIN]);
    await signedIn(t);
    t.vault.state.documents.push({ id: 'doc-passport', title: "Aisha's passport", type_key: 'passport' });
    t.reminders = [
      {
        id: 'r-1',
        document_id: 'doc-passport',
        document_title: "Aisha's passport",
        kind: 'derived',
        fire_at: '2026-09-25',
        lead_days: 180,
        note: null,
        recurrence: null,
        status: 'due',
        snoozed_until: null,
        label: 'Expires in 6 months',
      },
    ];
    class Full extends MemoryQueueStore {
      override async add(): Promise<void> {
        throw new Error('database or disk is full');
      }
    }
    const phone = testCapture({ scanner: fixtureScanner([TWO_PAGES]), openStore: async () => new Full() });
    phone.files.set('cache:/scan/1.jpg', jpeg('letter-with-exif.jpg'));
    phone.files.set('cache:/scan/2.jpg', jpeg('card.jpg'));
    await renderApp(<App />, { fetch: withStatus(t), capture: phone });
    await fireEvent.press(await screen.findByTestId('renew-doc-passport'));
    expect(await screen.findByTestId('home-renew-problem')).toHaveTextContent(/Your phone is out of space/);
    expect(phone.files.size).toBe(0);
    expect(screen.queryByTestId('home-scanner-failed')).toBeNull();
  });
});
