import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { PDFDocument } from 'pdf-lib';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, TextInput } from 'react-native';
import CaptureScreen from '../app/capture';
import Home, { add } from '../test-support/home';
import { fixtureScanner, type ScanOutcome } from '../capture/scanner';
import { MemoryQueueStore } from '../queue/store';
import type { QueueItem } from '../queue/item';
import { jpeg, reply } from '../test-support/capture';
import { audit } from '../test-support/a11y';
import { addCar, fieldOf, ownerApi } from '../test-support/kinds';
import { installed, renderApp, signedIn, testCapture } from '../test-support/render';
import { capabilities, testVault, type TestVault } from '../test-support/vault';
import { SecureTokenStore } from '../session/store';
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

async function openCard(
  opts: {
    outcomes?: ScanOutcome[];
    how?: 'scan' | 'file';
    /** A vault of 0.5.11, which asks for each type's details. */
    kinds?: boolean;
    /** The vault set up first, as the family left it. */
    before?: (t: TestVault) => Promise<void>;
    /** After the sign-in, before the card opens: who is signed in, say. */
    after?: (t: TestVault) => Promise<void>;
  } = {},
) {
  const t = testVault();
  if (opts.kinds) t.caps = kindsCaps();
  await opts.before?.(t);
  await withMembers(t);
  await opts.after?.(t);
  const rec = recording(t);
  const phone = testCapture({ scanner: fixtureScanner(opts.outcomes ?? [TWO_PAGES]) });
  phone.files.set('cache:/scan/1.jpg', jpeg('letter-with-exif.jpg'));
  phone.files.set('cache:/scan/2.jpg', jpeg('card.jpg'));
  phone.files.set('cache:/scan/3.jpg', jpeg('card.jpg'));
  const utils = await renderApp(<Scanned how={opts.how ?? 'scan'} />, { fetch: rec.fetch, capture: phone });
  await screen.findByText('What it is');
  return { ...utils, t, phone, rec };
}

/** A vault of 0.5.11: it keeps each type's details, and says which fields each requires. */
const kindsCaps = () =>
  capabilities({ server_version: '0.5.11', features: { ...capabilities().features, custom_types: true } });

/**
 * Signed in as somebody of this role: the fake files everything as its one
 * person, and the phone reads that person's role from GET /members, as it
 * does a role changed since sign-in.
 */
const signedInAs = (role: 'teen' | 'adult', name: string) => async (t: TestVault) => {
  t.vault.state.members = [
    { id: 'fake-member', display_name: name, role, is_me: true },
    { id: 'member-aisha', display_name: 'Aisha Khan', role: 'adult', is_me: false },
  ];
  const store = new SecureTokenStore();
  const kept = await store.load();
  await store.save({ ...(kept as NonNullable<typeof kept>), role });
};

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

describe('who can see it when nobody chooses (A71, vault 0.5.19)', () => {
  const selected = (v: string) => screen.getByTestId(`visibility-${v}`).props.accessibilityState;

  it('a teen capturing their own document of an Adults-only kind sends Only me by default', async () => {
    const { t, rec } = await openCard({ after: signedInAs('teen', 'Sam') });
    // Theirs, and only theirs to choose.
    expect(chip('Sam (Yours)')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Aisha Khan' })).toBeNull();
    await fireEvent.press(chip('Bank statement'));
    // Their Only me, not Everyone: Adults only, which would hide it from them too, is not offered.
    expect(selected('private')).toMatchObject({ selected: true });
    expect(selected('household')).toMatchObject({ selected: false });
    expect(screen.queryByTestId('visibility-adults')).toBeNull();
    await fireEvent.press(screen.getByTestId('capture-save'));
    await waitFor(() => expect(captures(t)).toHaveLength(1));
    expect(rec.metadata()[0]).toMatchObject({
      type_key: 'bank_statement',
      owner_member_id: 'fake-member',
      visibility: 'private',
    });
    expect(t.vault.state.documents[0]).toMatchObject({ visibility: 'private' });
  });

  it('an adult capturing their own document of an Adults-only kind sends Adults only by default', async () => {
    const { t, rec } = await openCard({ after: signedInAs('adult', 'Omar') });
    await fireEvent.press(chip('Omar (Yours)'));
    await fireEvent.press(chip('Bank statement'));
    expect(selected('adults')).toMatchObject({ selected: true });
    expect(selected('private')).toMatchObject({ selected: false, disabled: false });
    await fireEvent.press(screen.getByTestId('capture-save'));
    await waitFor(() => expect(captures(t)).toHaveLength(1));
    expect(rec.metadata()[0]).toMatchObject({
      type_key: 'bank_statement',
      owner_member_id: 'fake-member',
      visibility: 'adults',
    });
    expect(t.vault.state.documents[0]).toMatchObject({ visibility: 'adults' });
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

describe('a type’s details (a vault of 0.5.11)', () => {
  it('Save that waits goes to the first field it waits for, or to what it says when that has no box', async () => {
    const focus = jest.spyOn(TextInput.prototype, 'focus');
    const toEnd = jest.spyOn(ScrollView.prototype, 'scrollToEnd');
    const focused = () => (focus.mock.contexts.at(-1) as { props: { testID?: string } } | undefined)?.props.testID;
    try {
      const { t } = await openCard({
        kinds: true,
        // A kind of the household's own that requires one of its answers.
        before: async (v) => {
          const { api, token } = await ownerApi(v.vault);
          const cover = await api.createDocumentAttribute(token, {
            label: 'Cover',
            kind: 'choice',
            choices: ['Basic', 'Full'],
          });
          await api.createDocumentType(token, {
            label: 'Pet plan',
            category: 'other',
            fields: [{ key: cover.key, required: true }],
          });
        },
      });
      await fireEvent.press(chip('Passport'));
      await fireEvent.press(chip('Fake Owner (Yours)'));
      // The details are closed: Save opens them, and the place is in the first field it waits for.
      await fireEvent.press(screen.getByTestId('capture-save'));
      await screen.findByTestId('capture-error');
      expect(focused()).toBe('field-number');
      await fireEvent.changeText(screen.getByTestId('field-number'), '123456789');
      await fireEvent.press(screen.getByTestId('capture-save'));
      await screen.findByText('Still needed: Expires. Fill it in, or skip for now.');
      expect(focused()).toBe('field-expires');
      expect(toEnd).not.toHaveBeenCalled();
      // A choice has no box to type in: the notice that says what is needed is brought into view.
      focus.mockClear();
      await fireEvent.press(screen.getByTestId('types-more'));
      await fireEvent.changeText(screen.getByTestId('types-search'), 'pet plan');
      await fireEvent.press(chip('Pet plan'));
      await fireEvent.press(screen.getByTestId('capture-save'));
      await screen.findByText('Still needed: Cover. Fill it in, or skip for now.');
      expect(toEnd).toHaveBeenCalledTimes(1);
      expect(focus).not.toHaveBeenCalled();
      expect(captures(t)).toHaveLength(0);
    } finally {
      focus.mockRestore();
      toEnd.mockRestore();
    }
  });

  it('a passport card asks for its number when the vault has the flag', async () => {
    const { t, rec } = await openCard({ kinds: true });
    await fireEvent.press(chip('Passport'));
    await fireEvent.press(chip('Fake Owner (Yours)'));
    await fireEvent.press(screen.getByTestId('more-details'));
    // The type's own names for its fields, and the ones it requires marked.
    expect(screen.getByText('Passport number * required')).toBeTruthy();
    expect(screen.getByLabelText('Passport number, required').props.testID).toBe('field-number');
    expect(screen.getByLabelText('Expires, required').props.testID).toBe('field-expires');
    expect(screen.getByLabelText('Issuing country').props.testID).toBe('field-issued-by');
    // Save waits for them, and says which.
    await fireEvent.press(screen.getByTestId('capture-save'));
    expect(await screen.findByTestId('capture-error')).toHaveTextContent(
      'Still needed: Passport number and Expires. Fill them in, or skip for now.',
    );
    expect(captures(t)).toHaveLength(0);
    await fireEvent.changeText(screen.getByTestId('field-number'), ' 123456789 ');
    await fireEvent.press(screen.getByTestId('capture-save'));
    expect(await screen.findByText('Still needed: Expires. Fill it in, or skip for now.')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('field-expires'), '14 Mar 2031');
    await fireEvent.press(screen.getByTestId('capture-save'));
    await waitFor(() => expect(t.vault.state.documents).toHaveLength(1));
    expect(rec.metadata()[0]).toMatchObject({
      type_key: 'passport',
      identifier: '123456789',
      expires: { date: '2031-03-14', precision: 'day' },
    });
    // A passport has no details of its own: nothing else is sent.
    expect(rec.metadata()[0]).not.toHaveProperty('extra');
  });

  it('a kind of the household’s own asks for its details, waits for the required one, and sends them', async () => {
    let car = { key: '' } as Awaited<ReturnType<typeof addCar>>;
    const { t, rec } = await openCard({ kinds: true, before: async (v) => void (car = await addCar(v.vault)) });
    const plate = fieldOf(car, 'Registration plate');
    await fireEvent.press(screen.getByTestId('types-more'));
    await fireEvent.changeText(screen.getByTestId('types-search'), 'car');
    await fireEvent.press(chip('Car'));
    await fireEvent.press(screen.getByTestId('more-details'));
    expect(screen.getByText('Registration plate * required')).toBeTruthy();
    expect(screen.getByLabelText('On finance')).toBeTruthy();
    // Each answer, and the switch, work with a screen reader and a thumb.
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByTestId('capture-save'));
    expect(await screen.findByTestId('capture-error')).toHaveTextContent(
      'Still needed: Registration plate. Fill it in, or skip for now.',
    );
    expect(captures(t)).toHaveLength(0);
    await fireEvent.changeText(screen.getByTestId(`field-detail-${plate}`), 'AB12 CDE');
    await fireEvent.press(chip('Electric'));
    await fireEvent.press(screen.getByTestId('capture-save'));
    await waitFor(() => expect(t.vault.state.documents).toHaveLength(1));
    const fuel = fieldOf(car, 'Fuel');
    // Only what has a value: On finance was left alone, and is not required.
    expect(rec.metadata()[0]).toMatchObject({ type_key: car.key, extra: { [plate]: 'AB12 CDE', [fuel]: 'Electric' } });
    expect(Object.keys(rec.metadata()[0]?.extra as object)).toHaveLength(2);
    expect(t.vault.state.documents[0]?.extra).toEqual({ [plate]: 'AB12 CDE', [fuel]: 'Electric' });
  });

  it('Skip never waits', async () => {
    const { t } = await openCard({ kinds: true });
    await fireEvent.press(chip('Passport'));
    await fireEvent.press(screen.getByTestId('capture-skip'));
    await waitFor(() => expect(t.vault.state.documents).toHaveLength(1));
    expect(screen.queryByTestId('capture-error')).toBeNull();
  });

  it('nothing new is sent to a vault without it', async () => {
    let car = { key: '' } as Awaited<ReturnType<typeof addCar>>;
    const { t, rec } = await openCard({ before: async (v) => void (car = await addCar(v.vault)) });
    // The card as in 0.2.0: its own words, nothing marked, no details of a kind's own.
    await fireEvent.press(chip('Passport'));
    await fireEvent.press(screen.getByTestId('more-details'));
    expect(screen.getByLabelText('Number').props.testID).toBe('field-number');
    expect(screen.queryByText(/required/)).toBeNull();
    await fireEvent.press(screen.getByTestId('types-more'));
    await fireEvent.changeText(screen.getByTestId('types-search'), 'car');
    await fireEvent.press(chip('Car'));
    expect(screen.queryByTestId(`field-detail-${fieldOf(car, 'Registration plate')}`)).toBeNull();
    expect(screen.queryByText(/required/)).toBeNull();
    // Save does not wait.
    await fireEvent.press(screen.getByTestId('capture-save'));
    await waitFor(() => expect(t.vault.state.documents).toHaveLength(1));
    expect(rec.metadata()[0]).toMatchObject({ type_key: car.key });
    expect(rec.metadata()[0]).not.toHaveProperty('extra');
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
    await add();
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
    await add();
    await fireEvent.press(await screen.findByRole('button', { name: 'Passport' }));
    await fireEvent.press(screen.getByTestId('capture-save'));
    expect(await screen.findByTestId('home-saved')).toHaveTextContent(
      /^Saved\. Add the expiry date whenever you want reminders\./,
    );
    await waitFor(() => expect(t.vault.state.documents).toHaveLength(2));

    // Skipped: it needs a name, and Home says so.
    pages();
    await add();
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
