import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { PDFDocument } from 'pdf-lib';
import { useEffect, useRef, useState } from 'react';
import CaptureScreen from '../app/capture';
import Home from '../test-support/home';
import { fixtureScanner, type ScanOutcome } from '../capture/scanner';
import { MemoryQueueStore } from '../queue/store';
import type { QueueItem } from '../queue/item';
import { jpeg, reply } from '../test-support/capture';
import { installed, renderApp, signedIn, testCapture } from '../test-support/render';
import { testVault, type TestVault } from '../test-support/vault';
import { useCapture } from '../state/capture';
import { useVault } from '../state/vault';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn() };
const mockListeners: Record<string, (e: unknown) => void> = {};
const mockNavigation = {
  addListener: jest.fn((name: string, fn: (e: unknown) => void) => {
    mockListeners[name] = fn;
    return () => delete mockListeners[name];
  }),
  dispatch: jest.fn(),
};

jest.mock('expo-router', () => ({
  Link: (p: { children: unknown }) => p.children,
  useRouter: () => mockRouter,
  useNavigation: () => mockNavigation,
}));

const TWO_PAGES: ScanOutcome = { kind: 'pages', pages: [{ uri: 'cache:/scan/1.jpg' }, { uri: 'cache:/scan/2.jpg' }] };

/** The card, the way Home opens it: the scanner has just said Done. */
function Scanned(props: { how?: 'scan' | 'file' }) {
  const capture = useCapture();
  const { who } = useVault();
  const [open, setOpen] = useState(false);
  const started = useRef(false);
  useEffect(() => {
    // As a tap would: once somebody is signed in.
    if (!who || started.current) return;
    started.current = true;
    void capture.start(props.how ?? 'scan').then((o) => setOpen(o === 'card'));
  }, [who, capture, props.how]);
  return open ? <CaptureScreen /> : null;
}

async function withMembers(t: TestVault) {
  t.vault.state.members = [
    { id: 'fake-member', display_name: 'Fake Owner', role: 'owner', is_me: true },
    { id: 'member-aisha', display_name: 'Aisha Khan', role: 'adult', is_me: false },
  ];
  await signedIn(t);
}

/**
 * The test vault, as the app sees it: every capture's body kept (the fake
 * does not keep dates), and each document with the status the real vault
 * gives it.
 */
function recording(t: TestVault) {
  const sent: Uint8Array[] = [];
  const fetch: TestVault['fetch'] = async (url, init) => {
    if (url.endsWith('/api/v1/capture') && init.body instanceof Uint8Array) sent.push(init.body);
    const res = await t.fetch(url, init);
    if (!/\/api\/v1\/documents(\?|$)/.test(url) || init.method !== 'GET') return res;
    const body = (await res.json()) as { items: { type_key: string | null }[] };
    const items = body.items.map((d) => ({
      ...d,
      status: d.type_key ? { value: 'valid', label: '' } : { value: 'needs_info', label: 'Needs a name' },
    }));
    return reply(200, { ...body, items });
  };
  /** The details each capture carried, as the vault read them. */
  const metadata = () =>
    sent.map((b) => {
      // Byte for byte: Expo's TextDecoder reads UTF-8 only.
      let text = '';
      for (const c of b) text += String.fromCharCode(c);
      const m = /name="metadata"\r\n\r\n([^]*?)\r\n--/.exec(text);
      return m ? (JSON.parse(m[1] as string) as Record<string, unknown>) : null;
    });
  return { fetch, sent, metadata };
}

async function openCard(opts: { outcomes?: ScanOutcome[]; how?: 'scan' | 'file' } = {}) {
  const t = testVault();
  await withMembers(t);
  const rec = recording(t);
  const phone = testCapture({ scanner: fixtureScanner(opts.outcomes ?? [TWO_PAGES]) });
  phone.files.set('cache:/scan/1.jpg', jpeg('letter-with-exif.jpg'));
  phone.files.set('cache:/scan/2.jpg', jpeg('card.jpg'));
  phone.files.set('cache:/scan/3.jpg', jpeg('card.jpg'));
  const utils = await renderApp(<Scanned how={opts.how ?? 'scan'} />, { fetch: rec.fetch, capture: phone });
  await screen.findByText('What it is');
  return { ...utils, t, phone, rec };
}

const captures = (t: TestVault) => t.calls.filter((c) => c.startsWith('POST') && c.endsWith('/api/v1/capture'));
const chip = (name: string | RegExp) => screen.getByRole('button', { name });

beforeEach(() => {
  installed();
  jest.clearAllMocks();
});

describe('the confirm card', () => {
  it('Only me is offered only when the document is yours', async () => {
    await openCard();
    const onlyMe = () => screen.getByTestId('visibility-private');
    // Nobody chosen yet: not yours.
    expect(onlyMe().props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(chip('Aisha Khan'));
    expect(onlyMe().props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(chip('Fake Owner (Yours)'));
    expect(onlyMe().props.accessibilityState).toMatchObject({ disabled: false });
    await fireEvent.press(onlyMe());
    expect(
      screen.getByText('Only you can open this. Nobody can open it after you, unless you leave a key.'),
    ).toBeTruthy();
    // Given to someone else, it stops being Only me.
    await fireEvent.press(chip('Aisha Khan'));
    expect(onlyMe().props.accessibilityState).toMatchObject({ disabled: true, selected: false });
    expect(screen.getByTestId('visibility-adults').props.accessibilityState).toMatchObject({ selected: true });
  });

  it('choosing a type sets its default visibility, Essential and a name from the chosen person', async () => {
    await openCard();
    await fireEvent.press(chip('Bank statement'));
    expect(screen.getByTestId('visibility-adults').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByTestId('essential').props.value).toBe(false);

    await fireEvent.press(chip('Passport'));
    expect(screen.getByTestId('visibility-household').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByTestId('essential').props.value).toBe(true);
    await fireEvent.press(chip('Aisha Khan'));
    await fireEvent.press(screen.getByTestId('more-details'));
    expect(screen.getByTestId('field-name').props.placeholder).toBe("Aisha's passport");
    // The reminder it will get.
    expect(screen.getByTestId('capture-reminder')).toHaveTextContent(
      "We'll remind you 9 months and 6 months before it expires.",
    );
  });

  it('Expires is hidden when the type has no expiry', async () => {
    await openCard();
    await fireEvent.press(screen.getByTestId('more-details'));
    expect(screen.queryByTestId('field-expires')).toBeNull();
    await fireEvent.press(chip('Passport'));
    expect(screen.getByTestId('field-expires')).toBeTruthy();
    await fireEvent.press(chip('Bank statement'));
    expect(screen.queryByTestId('field-expires')).toBeNull();
  });

  it('dates accept 14 Mar 2031, March 2031 and 2031', async () => {
    for (const [typed, expected] of [
      ['14 Mar 2031', { date: '2031-03-14', precision: 'day' }],
      ['March 2031', { date: '2031-03-31', precision: 'month' }],
      ['2031', { date: '2031-12-31', precision: 'year' }],
    ] as const) {
      const { t, rec, unmount } = await openCard();
      await fireEvent.press(chip('Passport'));
      await fireEvent.press(chip('Fake Owner (Yours)'));
      await fireEvent.press(screen.getByTestId('more-details'));
      await fireEvent.changeText(screen.getByTestId('field-expires'), typed);
      await fireEvent.press(screen.getByTestId('capture-save'));
      await waitFor(() => expect(t.vault.state.documents).toHaveLength(1));
      expect(rec.metadata()[0]).toMatchObject({
        type_key: 'passport',
        owner_member_id: 'fake-member',
        expires: expected,
      });
      unmount();
    }
  });

  it('a date it cannot read is said plainly, and nothing is kept', async () => {
    const { t, phone } = await openCard();
    await fireEvent.press(chip('Passport'));
    await fireEvent.press(screen.getByTestId('more-details'));
    await fireEvent.changeText(screen.getByTestId('field-expires'), 'next spring');
    await fireEvent.press(screen.getByTestId('capture-save'));
    expect(await screen.findByText(/That isn't a date we can read/)).toBeTruthy();
    expect(captures(t)).toHaveLength(0);
    expect(phone.files.size).toBe(3);
  });

  it('Back asks save, throw away or keep editing', async () => {
    const { phone } = await openCard();
    const back = () =>
      act(() => {
        mockListeners.beforeRemove?.({ preventDefault: jest.fn(), data: { action: { type: 'GO_BACK' } } });
      });
    await back();
    const sheet = await screen.findByTestId('leave-question');
    expect(within(sheet).getByText('Save without details')).toBeTruthy();
    // Keep editing: still here, nothing lost.
    await fireEvent.press(screen.getByTestId('leave-keep'));
    expect(mockNavigation.dispatch).not.toHaveBeenCalled();
    // Throw it away: the scanner's files go, and so does the card.
    await back();
    await fireEvent.press(screen.getByTestId('leave-throw'));
    await waitFor(() => expect(mockNavigation.dispatch).toHaveBeenCalledWith({ type: 'GO_BACK' }));
    expect(phone.files.has('cache:/scan/1.jpg')).toBe(false);
    expect(phone.files.has('cache:/scan/2.jpg')).toBe(false);
  });

  it('Save without details keeps the scan, as Skip does', async () => {
    const { t } = await openCard();
    await act(() => {
      mockListeners.beforeRemove?.({ preventDefault: jest.fn(), data: { action: { type: 'GO_BACK' } } });
    });
    await fireEvent.press(await screen.findByTestId('leave-save'));
    await waitFor(() => expect(t.vault.state.documents).toHaveLength(1));
    expect(t.vault.state.documents[0]).toMatchObject({ title: null, type_key: null });
  });

  it('nothing is uploaded before Save or Skip', async () => {
    const { t, phone } = await openCard();
    await fireEvent.press(chip('Passport'));
    await fireEvent.press(chip('Aisha Khan'));
    await fireEvent.press(screen.getByTestId('more-details'));
    await fireEvent.changeText(screen.getByTestId('field-number'), '123456789');
    expect(captures(t)).toHaveLength(0);
    await fireEvent.press(screen.getByTestId('capture-save'));
    await waitFor(() => expect(captures(t)).toHaveLength(1));
    expect(t.vault.state.documents[0]).toMatchObject({
      title: "Aisha's passport",
      type_key: 'passport',
      owner_member_id: 'member-aisha',
      visibility: 'household',
    });
    // The scanner's files are gone: the scan lived in the queue until the vault had it.
    expect(phone.files.size).toBe(1); // the third page was never scanned into this capture
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it('a picked file shows as one row and goes as it is', async () => {
    const t = testVault();
    await withMembers(t);
    const phone = testCapture({
      scanner: fixtureScanner([
        {
          kind: 'file',
          file: { uri: 'cache:/picked/lease.pdf', name: 'Lease.pdf', mime: 'application/pdf', size: 2048 },
        },
      ]),
    });
    phone.files.set('cache:/picked/lease.pdf', new TextEncoder().encode('%PDF-1.4\n%%EOF\n'));
    await renderApp(<Scanned how="file" />, { fetch: t.fetch, capture: phone });
    expect(await screen.findByText('Lease.pdf · 2 KB')).toBeTruthy();
    expect(screen.queryByTestId('page-strip')).toBeNull();
    await fireEvent.press(screen.getByTestId('capture-skip'));
    await waitFor(() => expect(t.vault.state.documents).toHaveLength(1));
  });
});

describe('while a Save is under way', () => {
  it('Back waits for it, asks nothing, and the scan is kept once', async () => {
    const t = testVault();
    await withMembers(t);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    class SlowStore extends MemoryQueueStore {
      override async add(item: QueueItem, bytes: Uint8Array): Promise<void> {
        await gate;
        return super.add(item, bytes);
      }
    }
    const store = new SlowStore();
    const phone = testCapture({ scanner: fixtureScanner([TWO_PAGES]), openStore: async () => store });
    phone.files.set('cache:/scan/1.jpg', jpeg('letter-with-exif.jpg'));
    phone.files.set('cache:/scan/2.jpg', jpeg('card.jpg'));
    await renderApp(<Scanned />, { fetch: recording(t).fetch, capture: phone });
    await screen.findByText('What it is');
    await fireEvent.press(chip('Passport'));
    await fireEvent.press(screen.getByTestId('capture-save'));
    // Back, twice, while the PDF is still going into the queue.
    const prevented = jest.fn();
    await act(() => {
      mockListeners.beforeRemove?.({ preventDefault: prevented, data: { action: { type: 'GO_BACK' } } });
    });
    expect(prevented).toHaveBeenCalled();
    expect(screen.queryByTestId('leave-question')).toBeNull();
    await fireEvent.press(screen.getByTestId('capture-skip'));
    await act(async () => {
      release();
    });
    await waitFor(() => expect(t.vault.state.documents).toHaveLength(1));
    expect(t.vault.state.documents[0]).toMatchObject({ type_key: 'passport' });
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });
});

describe('the card, for a screen reader and for privacy', () => {
  it('page pictures never go to the phone’s image cache', async () => {
    await openCard();
    const page = screen.getByLabelText('Page 1');
    expect(page.props.cachePolicy ?? page.parent?.props.cachePolicy).toBe('none');
  });

  it('More… says it opens more, not that it is the kind chosen', async () => {
    await openCard();
    expect(screen.getByTestId('types-more').props.accessibilityState).toEqual({ expanded: false, disabled: false });
    await fireEvent.press(screen.getByTestId('types-more'));
    expect(screen.getByTestId('types-more').props.accessibilityState).toEqual({ expanded: true, disabled: false });
  });
});

describe('the page strip', () => {
  it('Move earlier changes the PDF order', async () => {
    const { rec } = await openCard();
    await fireEvent.press(screen.getByRole('button', { name: 'Move page 2 earlier' }));
    await fireEvent.press(screen.getByTestId('capture-skip'));
    await waitFor(() => expect(rec.sent).toHaveLength(1));
    const body = rec.sent[0] as Uint8Array;
    const start = indexOf(body, new TextEncoder().encode('%PDF'));
    const pdf = await PDFDocument.load(body.slice(start));
    // The card (300 × 190 px at 200 dpi) now comes first, the letter second.
    const sizes = pdf.getPages().map((p) => Math.round(p.getWidth()));
    expect(sizes).toEqual([108, 144]);
  });

  it('Remove and Retake work without dragging', async () => {
    const { phone } = await openCard({
      outcomes: [TWO_PAGES, { kind: 'pages', pages: [{ uri: 'cache:/scan/3.jpg' }] }],
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Retake page 1' }));
    await waitFor(() => expect(phone.files.has('cache:/scan/1.jpg')).toBe(false));
    expect(screen.getByText('2 pages')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Remove page 2' }));
    expect(await screen.findByText('1 page')).toBeTruthy();
    expect(phone.files.has('cache:/scan/2.jpg')).toBe(false);
    // The last page cannot be removed; the scan can only be thrown away.
    expect(screen.getByRole('button', { name: 'Remove page 1' }).props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });
});

describe('after the save', () => {
  it('Home says it is saved, with the reminder, and counts what needs a name', async () => {
    const t = testVault();
    await withMembers(t);
    const phone = testCapture({ scanner: fixtureScanner([TWO_PAGES, TWO_PAGES, TWO_PAGES]) });
    const pages = () => {
      phone.files.set('cache:/scan/1.jpg', jpeg('letter-with-exif.jpg'));
      phone.files.set('cache:/scan/2.jpg', jpeg('card.jpg'));
    };
    pages();
    function Both() {
      const { pending } = useCapture();
      return pending ? <CaptureScreen /> : <Home />;
    }
    await renderApp(<Both />, { fetch: recording(t).fetch, capture: phone });

    // A passport with its expiry date: the reminders it will get.
    await fireEvent.press(await screen.findByTestId('home-scan'));
    await fireEvent.press(await screen.findByRole('button', { name: 'Passport' }));
    await fireEvent.press(screen.getByTestId('more-details'));
    await fireEvent.changeText(screen.getByTestId('field-expires'), '14/03/2031');
    await fireEvent.press(screen.getByTestId('capture-save'));
    expect(await screen.findByTestId('home-saved')).toHaveTextContent(
      /^Saved\. We'll remind you 9 months and 6 months before it expires\./,
    );
    await waitFor(() => expect(t.vault.state.documents).toHaveLength(1));

    // Without it: no promise of reminders it cannot keep.
    pages();
    await fireEvent.press(screen.getByTestId('home-scan'));
    await fireEvent.press(await screen.findByRole('button', { name: 'Passport' }));
    await fireEvent.press(screen.getByTestId('capture-save'));
    expect(await screen.findByTestId('home-saved')).toHaveTextContent(
      /^Saved\. Add the expiry date whenever you want reminders\./,
    );
    await waitFor(() => expect(t.vault.state.documents).toHaveLength(2));

    // Skipped: it needs a name, and Home says so.
    pages();
    await fireEvent.press(screen.getByTestId('home-scan'));
    await fireEvent.press(await screen.findByTestId('capture-skip'));
    expect(await screen.findByTestId('home-saved')).toHaveTextContent(
      /^Saved\. It's under Needs a name whenever you want to finish it\./,
    );
    await waitFor(() => expect(t.vault.state.documents).toHaveLength(3));
    expect(await screen.findByTestId('home-unnamed')).toHaveTextContent('1 document needs a name');
  });
});

function indexOf(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i <= haystack.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}
