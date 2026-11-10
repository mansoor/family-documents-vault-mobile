import type { Capabilities, DetailProposal } from '@fdv/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Linking from 'expo-linking';
import CaptureScreen from '../app/capture';
import { fixtureScanner, type ScanOutcome } from '../capture/scanner';
import { MemoryQueueStore } from '../queue/store';
import { useCapture } from '../state/capture';
import { jpeg } from '../test-support/capture';
import Home, { add } from '../test-support/home';
import { installed, renderApp, signedIn, testCapture } from '../test-support/render';
import { capabilities, testVault, type TestVault } from '../test-support/vault';

jest.mock('expo-router', () => ({
  Link: (p: { children: unknown }) => p.children,
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn() }),
  useNavigation: () => ({ addListener: () => () => undefined, dispatch: jest.fn() }),
}));
jest.mock('expo-linking', () => ({ openURL: jest.fn(async () => true) }));
const mockPush = jest.fn();

const ORIGIN = 'https://vault.test';
const TEN_OCT = new Date(2026, 9, 10, 9, 30).getTime();

/** A vault that reads what comes into the Inbox, and files it from a card (I2, I3). */
function readingVault(over: Partial<Capabilities['features']> = {}): Capabilities {
  return capabilities({
    server_version: '0.9.0-dev.25',
    features: {
      ...capabilities().features,
      custom_types: true,
      batches: true,
      batch_proposals: true,
      batch_review: true,
      ...over,
    },
  });
}

function App() {
  const { pending } = useCapture();
  return pending ? <CaptureScreen /> : <Home />;
}

function phone() {
  const store = new MemoryQueueStore();
  const scan: ScanOutcome = { kind: 'pages', pages: [{ uri: 'cache:/scan/a.jpg' }, { uri: 'cache:/scan/b.jpg' }] };
  const p = testCapture({ scanner: fixtureScanner([scan]), openStore: async () => store, now: () => TEN_OCT });
  p.files.set('cache:/scan/a.jpg', jpeg('letter-with-exif.jpg'));
  p.files.set('cache:/scan/b.jpg', jpeg('card.jpg'));
  return p;
}

/**
 * The test vault, where each file sent into a batch is read at once, as the
 * vault's worker would read it: what its pages proposed, or that they
 * could not be read. Null leaves it waiting to be read.
 */
function readAtOnce(t: TestVault, read: { proposal: DetailProposal } | { failed: 'blank' } | null): TestVault['fetch'] {
  return async (url, init) => {
    const res = await t.fetch(url, init);
    if (read && /\/api\/v1\/batches\/[^/]+\/items$/.test(url) && init.method === 'POST' && res.ok) {
      for (const b of t.vault.state.batches) {
        for (const it of b.items) {
          if (it.reading && it.reading !== 'waiting') continue;
          if ('failed' in read) {
            it.reading = 'failed';
            it.read_failure = read.failed;
          } else {
            it.reading = 'read';
            it.proposal = read.proposal;
          }
        }
      }
    }
    return res;
  };
}

/** A passport, all there: the vault calls it Ready. */
const PASSPORT: DetailProposal = {
  type_key: { value: 'passport', confidence: 0.96, cue: 'title' },
  owner_member_id: { value: 'fake-member', confidence: 0.93, cue: 'name' },
  issued_by: { value: 'HM Passport Office', confidence: 0.9, cue: 'label' },
  issued: { value: { date: '2021-03-14', precision: 'day' }, confidence: 0.9, cue: 'label' },
  expires: { value: { date: '2031-03-14', precision: 'day' }, confidence: 0.95, cue: 'label' },
  identifier: { value: '123456789', confidence: 0.9, cue: 'label' },
} as never;

async function sendToInbox() {
  await add();
  await fireEvent.press(await screen.findByTestId('capture-inbox'));
  await screen.findByTestId('home-saved');
}

beforeEach(() => {
  installed();
  mockPush.mockClear();
  (Linking.openURL as jest.Mock).mockClear();
});

describe('what the vault read of a scan sent to the Inbox (P3)', () => {
  it('Ready: says what it read, and File it like this files it as the web would, untouched', async () => {
    const t = testVault([ORIGIN]);
    t.caps = readingVault();
    await signedIn(t);
    await renderApp(<App />, { fetch: readAtOnce(t, { proposal: PASSPORT }), capture: phone() });
    await screen.findByTestId('home-ready');
    await sendToInbox();

    const card = await screen.findByTestId('vault-read');
    expect(screen.getByTestId('home-saved')).toHaveTextContent(/^Sent to your Inbox\. What the vault reads of it is below\./);
    expect(card).toHaveTextContent(/^The vault read your scan:/);
    expect(screen.getByTestId('vault-read-level')).toHaveTextContent('Ready');
    expect(card).toHaveTextContent(/What it isPassport/);
    expect(card).toHaveTextContent(/Expires14 Mar 2031/);
    expect(card).toHaveTextContent(/Number123456789/);

    await fireEvent.press(screen.getByTestId('vault-read-confirm'));
    expect(await screen.findByTestId('vault-read-filed')).toHaveTextContent(/^Filed as /);
    // Filed once, as a document of the person's, with what the pages said.
    expect(t.vault.state.documents).toEqual([
      expect.objectContaining({
        type_key: 'passport',
        owner_member_id: 'fake-member',
        expires: { date: '2031-03-14', precision: 'day' },
      }),
    ]);
    await fireEvent.press(screen.getByTestId('vault-read-open'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/document/[id]',
      params: { id: t.vault.state.documents[0]?.id },
    });
  });

  it('unsure of anything: no filing from the phone, it is finished in the browser, at that very item', async () => {
    const t = testVault([ORIGIN]);
    t.caps = readingVault();
    await signedIn(t);
    // The pages say what it is, not whose.
    const { owner_member_id: _whose, ...unsure } = PASSPORT as Record<string, unknown>;
    await renderApp(<App />, { fetch: readAtOnce(t, { proposal: unsure as DetailProposal }), capture: phone() });
    await screen.findByTestId('home-ready');
    await sendToInbox();
    await screen.findByTestId('vault-read');
    expect(screen.queryByTestId('vault-read-confirm')).toBeNull();
    expect(screen.getByTestId('vault-read')).toHaveTextContent(/Finish it in your Inbox in the browser/);
    await fireEvent.press(screen.getByTestId('vault-read-browser'));
    const batch = t.vault.state.batches[0];
    const item = batch?.items[0];
    expect(Linking.openURL).toHaveBeenCalledWith(`${ORIGIN}/inbox/batches/${batch?.id}/items/${item?.id}`);
    expect(t.vault.state.documents).toEqual([]);
  });

  it('pages that could not be read: says why, in the vault’s words, and leaves it to the browser', async () => {
    const t = testVault([ORIGIN]);
    t.caps = readingVault();
    await signedIn(t);
    await renderApp(<App />, { fetch: readAtOnce(t, { failed: 'blank' }), capture: phone() });
    await screen.findByTestId('home-ready');
    await sendToInbox();
    expect(await screen.findByTestId('vault-read-failed')).toHaveTextContent(/^The pages look blank/);
    expect(screen.queryByTestId('vault-read-confirm')).toBeNull();
    expect(screen.getByTestId('vault-read-browser')).toBeTruthy();
  });

  it('while the vault is still reading it, says so', async () => {
    const t = testVault([ORIGIN]);
    t.caps = readingVault();
    await signedIn(t);
    await renderApp(<App />, { fetch: readAtOnce(t, null), capture: phone() });
    await screen.findByTestId('home-ready');
    await sendToInbox();
    expect(await screen.findByTestId('vault-read-reading')).toHaveTextContent('The vault is reading your scan…');
  });

  it('a vault that reads but files nothing from a card says nothing more than before', async () => {
    const t = testVault([ORIGIN]);
    t.caps = readingVault({ batch_review: false });
    await signedIn(t);
    await renderApp(<App />, { fetch: readAtOnce(t, { proposal: PASSPORT }), capture: phone() });
    await screen.findByTestId('home-ready');
    await sendToInbox();
    await waitFor(() => expect(screen.getByTestId('home-saved')).toHaveTextContent(/^Sent to your Inbox\./));
    expect(screen.queryByTestId('vault-read')).toBeNull();
    expect(screen.queryByTestId('vault-read-reading')).toBeNull();
  });
});
