import { storedIssuerKey, type CabinetLayout, type Capabilities, type DocumentView, type FolderDivider } from '@fdv/shared';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { AppState, StyleSheet, type AppStateStatus } from 'react-native';
import DocumentsScreen from '../app/(tabs)/documents';
import UnfiledScreen from '../app/unfiled';
import { CabinetBrowse } from '../cabinet/browse';
import { CabinetLevel } from '../cabinet/level';
import { arrangedOf, cabinetMark, dividerGroups, drawerRows, readLabel, shownLayout } from '../cabinet/model';
import { forgetCabinets, issuerGroupsFor } from '../cabinet/use-cabinet';
import { emit } from '../state/events';
import { ScanLabel } from '../cabinet/scan';
import { audit } from '../test-support/a11y';
import { DocumentDetail } from '../documents/detail';
import { libraryDoc, unlocked } from '../test-support/lookup';
import { installed, respond } from '../test-support/render';
import { back, push, resetRoutes, routes } from '../test-support/router';
import { capabilities, testVault, type TestVault } from '../test-support/vault';
import { LARGE } from '../ui/text-scale';

jest.mock(
  'expo-router',
  () => jest.requireActual<typeof import('../test-support/router')>('../test-support/router').routerMock,
);

/** The camera, as far as the scan screen needs it: a permission, and a code "seen" when the test presses it. */
const mockCamera = {
  permission: { granted: true, canAskAgain: true, status: 'granted', expires: 'never' } as Record<string, unknown> | null,
  code: '',
  asked: 0,
  /** Whether the screen last let the camera look. */
  active: undefined as boolean | undefined,
};
jest.mock('expo-camera', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { Pressable } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    useCameraPermissions: () => [
      mockCamera.permission,
      async () => {
        mockCamera.asked += 1;
        return mockCamera.permission;
      },
    ],
    CameraView: (p: { testID: string; active?: boolean; onBarcodeScanned?: (r: { data: string; type: string }) => void }) => {
      mockCamera.active = p.active;
      return React.createElement(Pressable, {
        testID: p.testID,
        accessibilityRole: 'button',
        accessibilityLabel: 'camera',
        style: { width: 300, height: 300 },
        onPress: () => p.onBarcodeScanned?.({ data: mockCamera.code, type: 'qr' }),
      });
    },
  };
});

const ORIGIN = 'https://vault.test';
const ME = 'fake-member';

/** The phone moving the app to the back or the front, as the lock's tests do. */
let appState: ((s: AppStateStatus) => void)[] = [];
const goTo = (state: AppStateStatus) =>
  act(async () => {
    Object.defineProperty(AppState, 'currentState', { value: state, configurable: true });
    for (const l of [...appState]) l(state);
  });

beforeEach(() => {
  installed();
  resetRoutes();
  mockCamera.permission = { granted: true, canAskAgain: true, status: 'granted', expires: 'never' };
  mockCamera.code = '';
  mockCamera.asked = 0;
  mockCamera.active = undefined;
  // Each test's vault is new: nothing read for an earlier one is current.
  forgetCabinets();
  appState = [];
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, fn) => {
    const listener = fn as (s: AppStateStatus) => void;
    appState.push(listener);
    return { remove: () => void (appState = appState.filter((l) => l !== listener)) };
  });
});

/** GETs of the cabinet and of its counts, so far. */
const cabinetGets = (t: TestVault) => ({
  cabinet: t.calls.filter((c) => c === `GET ${ORIGIN}/api/v1/cabinet`).length,
  counts: t.calls.filter((c) => c === `GET ${ORIGIN}/api/v1/cabinet/counts`).length,
});

/**
 * A vault of 0.9.0-dev.51 (or as old as `upTo` says): the cabinet, dividers
 * and pins, labels and places; `dev91` adds levels (dev.90) and Who issued
 * it (dev.91).
 */
function vault(upTo: 'dev91' | 'dev51' | 'dev42' | 'none' = 'dev51'): TestVault {
  const t = testVault([ORIGIN]);
  const f: Capabilities['features'] = { ...capabilities().features, document_table: true };
  if (upTo !== 'none') f.cabinets = true;
  if (upTo === 'dev51' || upTo === 'dev91') {
    f.cabinet_dividers = true;
    f.cabinet_pins = true;
    f.original_place = true;
  }
  if (upTo === 'dev91') {
    f.cabinet_levels = true;
    f.cabinet_issuer = true;
  }
  t.caps = capabilities({ server_version: upTo === 'dev91' ? '0.9.0-dev.91' : '0.9.0-dev.51', features: f });
  return t;
}

/**
 * Study: Drawer 1 with Tax (P60s, by year) and a hidden folder; a hidden drawer; a hidden cabinet.
 * Drawn by levels, as the test vault keeps every cabinet since the vault's dev.94; a vault
 * before levels (dev.51, dev.42) is read without them, so its tests see the same cabinet.
 */
const LAYOUT: CabinetLayout = {
  levels: ['topic', 'person', 'year'],
  cabinets: [
    {
      id: 'c-study',
      name: 'Study',
      hidden: false,
      drawn: { value: 'study' },
      drawers: [
        {
          id: 'd-one',
          name: 'Drawer 1',
          hidden: false,
          folders: [
            { id: 'f-tax', name: 'Tax', hidden: false, filter: { type_key: 'p60' } },
            { id: 'f-hidden', name: 'Old', hidden: true, filter: {} },
          ],
        },
        { id: 'd-hidden', name: 'Hidden drawer', hidden: true, folders: [] },
      ],
    },
    { id: 'c-hidden', name: 'Loft', hidden: true, drawn: { value: 'loft' }, drawers: [] },
  ],
};

/**
 * GET /cabinet as a vault of dev.90 to dev.93 answers it: the layout as kept, a cabinet arranged
 * by hand beside the drawn ones. The test vault reads a layout as the vault has since dev.94
 * (every cabinet drawn by its levels), so it is asked only for the rest.
 */
function answeredAsKept(t: TestVault) {
  const real = t.fetch;
  t.fetch = async (url, init) =>
    url === `${ORIGIN}/api/v1/cabinet` && (init?.method === undefined || init.method === 'GET')
      ? respond(200, t.vault.state.cabinets?.[ME])
      : real(url, init);
}

function filed(t: TestVault) {
  t.vault.state.cabinets = { [ME]: { layout: LAYOUT, version: 1, updated_at: '2026-11-16T00:00:00Z' } };
  t.vault.state.documents.push(
    { id: 'p60-2025', title: 'P60 2025', type_key: 'p60', issued: { date: '2025-04-05', precision: 'day' } },
    { id: 'p60-2024', title: 'P60 2024', type_key: 'p60', issued: { date: '2024-04-05', precision: 'day' } },
    { id: 'letter', title: 'The house letter', type_key: 'other', issued: { date: '2023-01-01', precision: 'day' } },
  );
  t.vault.state.cabinetPins = {
    [ME]: [{ folder_id: 'f-tax', document_id: 'letter', pinned_at: '2026-11-16T00:00:00Z' }],
  };
}

describe('a folder label read (C5)', () => {
  const cabinets = shownLayout(LAYOUT);
  it('opens a label of this vault, said by its address or by a folder that is the person’s own', () => {
    expect(readLabel(`${ORIGIN}/folder/f-tax`, ORIGIN, cabinets)).toEqual({ kind: 'folder', id: 'f-tax' });
    // The address's case and a trailing slash are the same address.
    expect(readLabel('HTTPS://Vault.Test/folder/f-x/', ORIGIN, null)).toEqual({ kind: 'folder', id: 'f-x' });
    // Printed from the address the web was opened at, reached here by another: the folder says it is this vault.
    expect(readLabel('http://192.168.1.5:8080/folder/f-tax', ORIGIN, cabinets)).toEqual({
      kind: 'folder',
      id: 'f-tax',
      elsewhere: true,
    });
  });

  it('says another vault’s label is from another vault, and nothing else is a label', () => {
    expect(readLabel('https://other.example/folder/f-zz', ORIGIN, cabinets)).toEqual({
      kind: 'other_vault',
      host: 'other.example',
    });
    // A hidden folder is not shown, so it is no evidence either.
    expect(readLabel('https://other.example/folder/f-hidden', ORIGIN, cabinets).kind).toBe('other_vault');
    for (const code of ['hello', `${ORIGIN}/documents`, `${ORIGIN}/folder/`, `${ORIGIN}/folder/a b`, 'ftp://x/folder/a']) {
      expect(readLabel(code, ORIGIN, cabinets)).toEqual({ kind: 'not_label' });
    }
  });
});

describe('the cabinet on Documents (C5)', () => {
  it('an older vault shows the list as before: no List and Cabinet', async () => {
    const t = vault('none');
    await unlocked(t, <DocumentsScreen />);
    await screen.findByTestId('documents-count');
    expect(screen.queryByTestId('documents-view-cabinet')).toBeNull();
    expect(t.calls.some((c) => c.includes('/api/v1/cabinet'))).toBe(false);
  });

  it('browses cabinet, drawer and folder, the hidden left out; a folder’s pins, then its dividers', async () => {
    const t = vault();
    filed(t);
    await unlocked(t, <DocumentsScreen />);
    await fireEvent.press(await screen.findByTestId('documents-view-cabinet'));
    await screen.findByTestId('cabinet-c-study');
    expect(screen.getByText('1 drawer')).toBeTruthy();
    expect(screen.queryByTestId('cabinet-c-hidden')).toBeNull();
    // Arranged on the web, never here.
    expect(screen.getByTestId('cabinet-arrange')).toBeTruthy();
    expect(screen.getByTestId('cabinet-scan')).toBeTruthy();
    expect(audit()).toEqual([]);

    await fireEvent.press(screen.getByTestId('cabinet-c-study'));
    expect(routes().at(-1)).toEqual({ pathname: '/cabinet/[id]', params: { id: 'c-study' } });
    await screen.findByTestId('drawer-d-one');
    expect(screen.queryByTestId('drawer-d-hidden')).toBeNull();

    await fireEvent.press(screen.getByTestId('drawer-d-one'));
    await screen.findByTestId('folder-f-tax');
    expect(screen.queryByTestId('folder-f-hidden')).toBeNull();
    // The pinned letter and the two P60s: what the vault counts for the folder.
    await waitFor(() => expect(screen.getByText('3 documents')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('folder-f-tax'));
    expect(screen.getByTestId('folder-path').props.children).toBe('Study › Drawer 1');
    await screen.findByTestId('folder-pinned');
    expect(screen.getByTestId('doc-row-letter')).toBeTruthy();
    // Newest first, the first divider open already; the next opened when pressed.
    expect(screen.getByTestId('divider-year:2025').props.accessibilityState).toEqual({ expanded: true });
    await screen.findByTestId('doc-row-p60-2025');
    expect(screen.queryByTestId('doc-row-p60-2024')).toBeNull();
    await fireEvent.press(screen.getByTestId('divider-year:2024'));
    await screen.findByTestId('doc-row-p60-2024');
    expect(audit()).toEqual([]);

    await fireEvent.press(screen.getByTestId('doc-row-p60-2024'));
    expect(routes().at(-1)).toEqual({ pathname: '/document/[id]', params: { id: 'p60-2024' } });
  });

  it('says what it holds in all; those in no folder open as a list, and why folders add up to more', async () => {
    const t = vault();
    filed(t);
    // A paper no shown folder asks for.
    t.vault.state.documents.push({ id: 'stray', title: 'A stray receipt', type_key: 'receipt' } as never);
    await unlocked(t, <DocumentsScreen />);
    await fireEvent.press(await screen.findByTestId('documents-view-cabinet'));
    await screen.findByTestId('cabinet-c-study');
    // Each paper once: the two P60s, the letter and the stray.
    await waitFor(() => expect(screen.getByTestId('cabinet-arranged-by')).toHaveTextContent(/^4 documents/));
    expect(await screen.findByTestId('cabinet-unfiled')).toHaveTextContent('1 isn’t in any folder');
    expect(screen.queryByTestId('cabinet-in-several')).toBeNull();
    await fireEvent.press(screen.getByTestId('cabinet-unfiled'));
    expect(routes().at(-1)).toEqual({ pathname: '/unfiled', params: {} });
  });

  it('the documents in no folder, newest first, each opening as any document does', async () => {
    const t = vault();
    filed(t);
    t.vault.state.documents.push({ id: 'stray', title: 'A stray receipt', type_key: 'receipt' } as never);
    await unlocked(t, <UnfiledScreen />);
    expect(await screen.findByTestId('doc-row-stray')).toBeTruthy();
    expect(screen.queryByTestId('doc-row-p60-2025')).toBeNull();
    await fireEvent.press(screen.getByTestId('doc-row-stray'));
    expect(routes().at(-1)).toEqual({ pathname: '/document/[id]', params: { id: 'stray' } });
  });

  it('the documents in no folder come a page at a time: Show more brings the rest, each once', async () => {
    const t = vault();
    filed(t);
    for (let i = 0; i < 55; i += 1) {
      t.vault.state.documents.push({
        id: `stray-${i}`,
        title: `Stray ${i}`,
        type_key: 'receipt',
        created_at: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(),
      } as never);
    }
    await unlocked(t, <UnfiledScreen />);
    await screen.findByTestId('unfiled-more');
    // The newest first: the first page's top row, and the oldest only after Show more.
    expect(screen.getByTestId('doc-row-stray-54')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('unfiled-more'));
    await waitFor(() => expect(screen.queryByTestId('unfiled-more')).toBeNull());
    const asked = t.calls.filter((c) => c.includes('/api/v1/cabinet/unfiled'));
    expect(asked[1]).toContain('cursor=50');
    expect(t.calls.filter((c) => c.includes('/api/v1/cabinet/unfiled'))).toHaveLength(2);
  });

  it('remembers Cabinet on this phone, and the magnifier goes back to the list with the search open', async () => {
    const t = vault();
    filed(t);
    await unlocked(t, <DocumentsScreen />);
    await fireEvent.press(await screen.findByTestId('documents-view-cabinet'));
    await screen.findByTestId('cabinet-c-study');
    await fireEvent.press(screen.getByTestId('documents-search'));
    await screen.findByTestId('search-field');
    expect(screen.getByTestId('documents-view-list').props.accessibilityState).toEqual({
      selected: true,
      disabled: false,
    });
  });

  it('one change asks the vault once, however many screens show the cabinet', async () => {
    const t = vault();
    filed(t);
    await unlocked(
      t,
      <>
        <CabinetBrowse header={null} />
        <CabinetBrowse header={null} />
        <CabinetBrowse header={null} />
      </>,
    );
    await waitFor(() => expect(screen.getAllByTestId('cabinet-c-study')).toHaveLength(3));
    expect(cabinetGets(t)).toEqual({ cabinet: 1, counts: 1 });
    await act(async () => emit('documentChanged', 'p60-2025'));
    await waitFor(() => expect(cabinetGets(t)).toEqual({ cabinet: 2, counts: 2 }));
    await act(async () => new Promise((r) => setTimeout(r, 50)));
    expect(cabinetGets(t)).toEqual({ cabinet: 2, counts: 2 });
  });

  it('says so when nothing is arranged yet', async () => {
    const t = vault();
    await unlocked(t, <DocumentsScreen />);
    await fireEvent.press(await screen.findByTestId('documents-view-cabinet'));
    expect((await screen.findByTestId('cabinet-empty')).props.children).toBe(
      'Your cabinet is empty. Arrange it on the web, and it shows here.',
    );
  });
});

describe('a folder (C5)', () => {
  it('one that is not the person’s — taken out, hidden, or somebody else’s label — says so', async () => {
    const t = vault();
    filed(t);
    push({ pathname: '/folder/[id]', params: { id: 'f-hidden' } });
    await unlocked(t, <DocumentsScreen />);
    await screen.findByTestId('folder-gone');
  });

  it('on a vault before dividers (dev.42), asks the list the folder’s question, newest first', async () => {
    const t = vault('dev42');
    filed(t);
    push({ pathname: '/folder/[id]', params: { id: 'f-tax' } });
    await unlocked(t, <DocumentsScreen />);
    await screen.findByTestId('doc-row-p60-2025');
    expect(screen.getByTestId('doc-row-p60-2024')).toBeTruthy();
    // No folder route, no dividers, no pins asked of a vault that has none.
    expect(t.calls.some((c) => c.includes('/cabinet/folders/'))).toBe(false);
    const asked = t.calls.find((c) => c.includes('/api/v1/documents?') && c.includes('type_key=p60'));
    expect(asked).toContain('sort=dated');
  });
});

describe('a folder whose question the list refuses (C5)', () => {
  it('on a vault before dividers, a 422 says so, with no Try again', async () => {
    const t = vault('dev42');
    filed(t);
    const real = t.fetch;
    t.fetch = async (url, init) =>
      url.includes('/api/v1/documents?') && url.includes('type_key=p60')
        ? respond(422, { error: { code: 'validation_failed', message: 'Not a filter you may use.', retriable: false } })
        : real(url, init);
    push({ pathname: '/folder/[id]', params: { id: 'f-tax' } });
    await unlocked(t, <DocumentsScreen />);
    expect((await screen.findByTestId('folder-refused')).props.children).toBeTruthy();
    expect(screen.getByText("This folder asks for something you can't see any more. Change it on the web.")).toBeTruthy();
    expect(screen.queryByTestId('load-failed-retry')).toBeNull();
  });
});

describe('scanning a folder label (C5)', () => {
  async function scan(t: TestVault, code: string) {
    mockCamera.code = code;
    await fireEvent.press(await screen.findByTestId('scan-camera'));
  }

  it('opens this vault’s folder in place of the scanner', async () => {
    const t = vault();
    filed(t);
    await unlocked(t, <ScanLabel />);
    await scan(t, `${ORIGIN}/folder/f-tax`);
    expect(routes().at(-1)).toEqual({ pathname: '/folder/[id]', params: { id: 'f-tax' } });
  });

  it('says plainly that another vault’s label is from another vault, and what is no label; Scan another', async () => {
    const t = vault();
    filed(t);
    await unlocked(t, <ScanLabel />);
    await scan(t, 'https://elsewhere.example/folder/f-zz');
    await screen.findByTestId('scan-said');
    expect(audit()).toEqual([]);
    expect(screen.getByText('This label is from another vault (elsewhere.example). It opens only there.')).toBeTruthy();
    expect(routes()).toEqual([]);
    // Nothing is asked of the other address.
    expect(t.calls.some((c) => c.includes('elsewhere.example'))).toBe(false);
    await fireEvent.press(screen.getByTestId('scan-again'));
    await scan(t, 'WIFI:S:home;;');
    await screen.findByText("That code isn't a folder label.");
  });

  it('a label printed from another address of this vault opens the folder, and says so there', async () => {
    const t = vault();
    filed(t);
    await unlocked(t, <ScanLabel />);
    await waitFor(() => expect(cabinetGets(t).cabinet).toBe(1));
    await act(async () => new Promise((r) => setTimeout(r, 20)));
    await scan(t, 'http://192.168.1.5:8080/folder/f-tax');
    expect(routes().at(-1)).toEqual({ pathname: '/folder/[id]', params: { id: 'f-tax', from: 'elsewhere' } });
    await screen.findByTestId('folder-elsewhere');
  });

  it('looks only while the app is open: behind the cover a code opens nothing', async () => {
    const t = vault();
    filed(t);
    await unlocked(t, <ScanLabel />);
    await screen.findByTestId('scan-camera');
    expect(mockCamera.active).toBe(true);
    await goTo('background');
    await screen.findByTestId('lock-cover');
    expect(mockCamera.active).toBe(false);
    mockCamera.code = `${ORIGIN}/folder/f-tax`;
    await fireEvent.press(screen.getByTestId('scan-camera'));
    expect(routes()).toEqual([]);
  });

  it('asks for the camera first, and says where to turn it on when it is off', async () => {
    const t = vault();
    mockCamera.permission = { granted: false, canAskAgain: true, status: 'undetermined', expires: 'never' };
    const first = await unlocked(t, <ScanLabel />);
    await fireEvent.press(await screen.findByTestId('scan-camera-allow'));
    expect(mockCamera.asked).toBe(1);
    first.app.unmount();
    mockCamera.permission = { granted: false, canAskAgain: false, status: 'denied', expires: 'never' };
    await unlocked(t, <ScanLabel />);
    await screen.findByTestId('scan-camera-off');
  });
});

describe('where the original is, on a document’s page (C5)', () => {
  function placed(t: TestVault, over: Partial<DocumentView> = {}) {
    libraryDoc(t, {
      id: 'p60',
      title: 'P60 2025',
      physical_location: 'behind the blue divider',
      original_place: { path: ['Study', 'Drawer 1', 'Tax'], folder_id: 'f-tax' },
      ...over,
    });
  }

  it('says the place, then the words written for it, and opens the person’s own folder', async () => {
    const t = vault();
    placed(t);
    await unlocked(t, <DocumentDetail id="p60" />);
    const words = await screen.findByTestId('document-original-words');
    expect(words.props.children).toBe('Study › Drawer 1 › Tax · behind the blue divider ›');
    await fireEvent.press(screen.getByTestId('document-original'));
    expect(routes().at(-1)).toEqual({ pathname: '/folder/[id]', params: { id: 'f-tax' } });
  });

  it('somebody else’s folder is said, not opened; an older vault says nothing of it', async () => {
    const t = vault();
    placed(t, { original_place: { path: ['Hall', 'Top', 'Bills'], folder_id: null } });
    const first = await unlocked(t, <DocumentDetail id="p60" />);
    expect((await screen.findByTestId('document-original-words')).props.children).toBe(
      'Hall › Top › Bills · behind the blue divider',
    );
    first.app.unmount();
    const older = vault('dev42');
    placed(older);
    await unlocked(older, <DocumentDetail id="p60" />);
    await screen.findByTestId('document-visibility');
    expect(screen.queryByTestId('document-original')).toBeNull();
  });
});

/**
 * Drawn by Topic › Person › Year › Kind (dev.90): Financial of one drawer
 * (Me) of two folders; Tax its own arrangement (Year › Person), a drawer of
 * one folder and one of two; Loft arranged by hand beside them.
 */
const LEVELLED: CabinetLayout = {
  levels: ['topic', 'person', 'year', 'kind'],
  cabinets: [
    {
      id: 'c-fin',
      name: 'Financial',
      hidden: false,
      drawn: { value: 'financial' },
      drawers: [
        {
          id: 'd-me',
          name: 'Me',
          hidden: false,
          folders: [
            {
              id: 'f-2025',
              name: '2025',
              hidden: false,
              filter: { type_key: 'p60', dated_from: '2025-01-01', dated_to: '2025-12-31' },
              dividers: { levels: ['kind'], ranges: [] },
            },
            {
              id: 'f-2024',
              name: '2024',
              hidden: false,
              filter: { type_key: 'p60', dated_from: '2024-01-01', dated_to: '2024-12-31' },
              dividers: { levels: ['kind'], ranges: [] },
            },
          ],
        },
        { id: 'd-gone', name: 'Hidden', hidden: true, folders: [] },
      ],
    },
    {
      id: 'c-tax',
      name: 'Tax',
      hidden: false,
      drawn: { value: 'tax', levels: ['year', 'person'] },
      drawers: [
        {
          id: 'd-2024',
          name: '2024',
          hidden: false,
          folders: [{ id: 'f-me-2024', name: 'Me', hidden: false, filter: { type_key: 'p60' } }],
        },
        {
          id: 'd-2025',
          name: '2025',
          hidden: false,
          folders: [
            { id: 'f-me-2025', name: 'Me', hidden: false, filter: { type_key: 'p60' } },
            { id: 'f-sara-2025', name: 'Sara', hidden: false, filter: { type_key: 'p60' } },
          ],
        },
      ],
    },
    {
      id: 'c-loft',
      name: 'Loft',
      hidden: false,
      drawers: [
        { id: 'd-a', name: 'A', hidden: false, folders: [] },
        { id: 'd-b', name: 'B', hidden: false, folders: [] },
      ],
    },
  ],
};

/** P60s from two employers and one with none given: a folder of them by Who issued it, then year. */
const ISSUED = [
  { id: 'acme-2025', title: 'Acme 2025', type_key: 'p60', issued_by: 'Acme Payroll', issued: { date: '2025-04-05', precision: 'day' } },
  { id: 'acme-2024', title: 'Acme 2024', type_key: 'p60', issued_by: 'Acme Payroll', issued: { date: '2024-04-05', precision: 'day' } },
  { id: 'bolt-2025', title: 'Bolt 2025', type_key: 'p60', issued_by: 'Bolt Works', issued: { date: '2025-04-05', precision: 'day' } },
  { id: 'none-2023', title: 'Nobody 2023', type_key: 'p60', issued: { date: '2023-04-05', precision: 'day' } },
];
const ACME = storedIssuerKey('Acme Payroll') as string;
const BOLT = storedIssuerKey('Bolt Works') as string;

/** A layout of one cabinet, one drawer and the folders given: a folder of P60s by Who issued it, then year. */
function issuerFolders(
  t: TestVault,
  folders: CabinetLayout['cabinets'][number]['drawers'][number]['folders'],
  papers: readonly object[] = ISSUED,
) {
  const layout: CabinetLayout = {
    levels: ['topic', 'person', 'year', 'issuer', 'kind'],
    cabinets: [
      {
        id: 'c-work',
        name: 'Employment',
        hidden: false,
        drawn: { value: 'employment' },
        drawers: [{ id: 'd-me', name: 'Me', hidden: false, folders }],
      },
    ],
  };
  t.vault.state.cabinets = { [ME]: { layout, version: 1, updated_at: '2026-11-22T00:00:00Z' } };
  t.vault.state.documents.push(...(papers as never[]));
}

/** A piece of the screen, as the queries give it. */
type ReactTestInstance = ReturnType<typeof screen.getByTestId>;

/** A P60 issued on `day` by `by`. */
const p60 = (id: string, by: string | null, day: string) => ({
  id,
  title: id,
  type_key: 'p60',
  ...(by ? { issued_by: by } : {}),
  issued: { date: day, precision: 'day' },
});

/** A folder of P60s divided by Who issued it, then year. */
const BY_ISSUER = [
  { id: 'f-p60', name: 'P60s', hidden: false, filter: { type_key: 'p60' }, dividers: { levels: ['issuer', 'year'], ranges: [] } },
] as CabinetLayout['cabinets'][number]['drawers'][number]['folders'];

/** The size a piece of text is drawn at, and whether it may be cut short. */
const drawn = (n: ReactTestInstance) => {
  const style = StyleSheet.flatten(n.props.style) ?? {};
  return { size: Number(style.fontSize ?? 0), cut: n.props.numberOfLines !== undefined || n.props.adjustsFontSizeToFit === true };
};

describe('what the phone makes of cabinet levels (dev.90)', () => {
  const on = { levels: true };
  const off = { levels: false };

  it('says what a layout is arranged by: its levels, by hand, or an older vault’s way as its levels', () => {
    expect(arrangedOf(LEVELLED, on)).toEqual(['topic', 'person', 'year', 'kind']);
    expect(arrangedOf({ levels: null, cabinets: [] }, on)).toBe('hand');
    // A level this app doesn't know (a newer vault's): said neutrally, never as by hand, never left out.
    expect(arrangedOf({ levels: ['topic', 'colour'], cabinets: [] } as unknown as CabinetLayout, on)).toBe('web');
    expect(arrangedOf({ levels: [], cabinets: [] } as unknown as CabinetLayout, on)).toBe('web');
    expect(arrangedOf(null, on)).toBeNull();
    // An older vault's three ways (arranged_by, deprecated), read as their levels; anything else, nothing.
    const older = (way: unknown) => ({ arranged_by: way, cabinets: [] }) as unknown as CabinetLayout;
    expect(arrangedOf(older('person_kind'), off)).toEqual(['person', 'kind']);
    expect(arrangedOf(older('category_year_person'), off)).toEqual(['topic', 'year', 'person']);
    expect(arrangedOf(older(null), off)).toBeNull();
    expect(arrangedOf(older('toString'), off)).toBeNull();
  });

  it('marks a cabinet with its own arrangement, or arranged by hand beside drawn ones; never on an older vault', () => {
    const [fin, tax, loft] = LEVELLED.cabinets;
    const by = arrangedOf(LEVELLED, on);
    expect([fin, tax, loft].map((c) => c && cabinetMark(c, by, on))).toEqual([null, 'own', 'hand']);
    // A layout wholly by hand marks none of its cabinets: the bar says it.
    expect(loft && cabinetMark(loft, 'hand', on)).toBeNull();
    expect(tax && cabinetMark(tax, by, off)).toBeNull();
  });

  it('passes over a cabinet’s only drawer and a drawer’s only folder; an older vault shows every level', () => {
    const [fin, tax] = shownLayout(LEVELLED);
    expect(fin && drawerRows(fin, on)).toMatchObject({ kind: 'only', drawer: { id: 'd-me' } });
    const rows = tax && drawerRows(tax, on);
    expect(rows?.kind === 'drawers' && rows.rows.map((r) => [r.drawer.id, r.folder?.id ?? null])).toEqual([
      ['d-2024', 'f-me-2024'],
      ['d-2025', null],
    ]);
    const before = fin && drawerRows(fin, off);
    expect(before?.kind === 'drawers' && before.rows.map((r) => [r.drawer.id, r.folder])).toEqual([['d-me', null]]);
  });

  it('groups divider leaves by their first step; one step, Everything else and the one list stand alone', () => {
    const leaf = (key: string, count: number, steps: [string, string][]): FolderDivider => ({
      key,
      kind: 'group',
      name: steps.map(([, n]) => n).join(' · '),
      from: null,
      to: null,
      count,
      path: steps.map(([k, name]) => ({ level: k.startsWith('year') ? 'year' : 'kind', key: k, name })),
    });
    const groups = dividerGroups([
      leaf('kind:bank/year:2025', 3, [['kind:bank', 'Bank statement'], ['year:2025', '2025']]),
      leaf('kind:bank/year:2024', 2, [['kind:bank', 'Bank statement'], ['year:2024', '2024']]),
      leaf('kind:payslip', 4, [['kind:payslip', 'Payslip']]),
      { key: 'rest', kind: 'group', name: 'Everything else', from: null, to: null, count: 7, path: [] },
    ]);
    expect(groups.map((g) => [g.key, g.name, g.grouped, g.count, g.leaves.map((l) => l.label)])).toEqual([
      ['kind:bank', 'Bank statement', true, 5, ['2025', '2024']],
      ['kind:payslip', 'Payslip', false, 4, ['Payslip']],
      ['rest', 'Everything else', false, 7, ['Everything else']],
    ]);
    // An older vault's dividers have no path: each its own, as before.
    const all: FolderDivider = { key: 'all', kind: 'all', name: '', from: null, to: null, count: 2 };
    expect(dividerGroups([all]).map((g) => [g.key, g.grouped])).toEqual([['all', false]]);
  });
});

describe('browsing a cabinet arranged by levels (dev.90)', () => {
  function levelled(t: TestVault) {
    t.vault.state.cabinets = { [ME]: { layout: LEVELLED, version: 1, updated_at: '2026-11-22T00:00:00Z' } };
  }

  it('says its levels, a cabinet of one drawer its folders, and marks own and hand-made cabinets', async () => {
    const t = vault('dev91');
    levelled(t);
    // Loft, arranged by hand, as a vault before dev.94 still answers it.
    answeredAsKept(t);
    await unlocked(t, <DocumentsScreen />);
    await fireEvent.press(await screen.findByTestId('documents-view-cabinet'));
    await screen.findByTestId('cabinet-c-fin');
    await waitFor(() =>
      expect(screen.getByTestId('cabinet-arranged-by')).toHaveTextContent(/Arranged by Topic › Person › Year › Kind$/),
    );
    expect(screen.getByTestId('cabinet-c-fin')).toHaveTextContent('Financial2 folders');
    expect(screen.getByTestId('cabinet-c-tax')).toHaveTextContent('Tax2 drawers · Own arrangement');
    expect(screen.getByTestId('cabinet-c-loft')).toHaveTextContent('Loft2 drawers · Arranged by hand');
    // Still arranged on the web, never here.
    expect(screen.getByTestId('cabinet-arrange')).toBeTruthy();
    expect(audit()).toEqual([]);
  });

  it('a cabinet of one drawer opens on its folders, and Back from a folder comes straight back to it', async () => {
    const t = vault('dev91');
    levelled(t);
    push({ pathname: '/cabinet/[id]', params: { id: 'c-fin' } });
    await unlocked(t, <CabinetLevel level="cabinet" />);
    expect((await screen.findByTestId('cabinet-only-drawer')).props.children).toBe('In the Me drawer.');
    expect(screen.queryByTestId('drawer-d-me')).toBeNull();
    expect(screen.queryByTestId('cabinet-mark')).toBeNull();
    expect(audit()).toEqual([]);
    await fireEvent.press(await screen.findByTestId('folder-f-2025'));
    // The folder is pushed from the cabinet: no drawer screen between them to go Back through.
    expect(routes().at(-1)).toEqual({ pathname: '/folder/[id]', params: { id: 'f-2025' } });
    expect(routes().some((r) => r.pathname === '/drawer/[id]')).toBe(false);
  });

  it('a drawer of one folder is one row that opens the folder; one of more opens as a drawer', async () => {
    const t = vault('dev91');
    levelled(t);
    push({ pathname: '/cabinet/[id]', params: { id: 'c-tax' } });
    await unlocked(t, <CabinetLevel level="cabinet" />);
    expect((await screen.findByTestId('cabinet-mark')).props.children).toBe('Own arrangement');
    const alone = await screen.findByTestId('folder-f-me-2024');
    expect(alone).toHaveTextContent(/^2024 › Me/);
    expect(alone.props.accessibilityLabel).toMatch(/^Me, in the 2024 drawer/);
    expect(screen.getByTestId('drawer-d-2025')).toHaveTextContent('20252 folders');
    expect(audit()).toEqual([]);
    await fireEvent.press(alone);
    expect(routes().at(-1)).toEqual({ pathname: '/folder/[id]', params: { id: 'f-me-2024' } });
    // Back comes straight to the cabinet.
    await act(async () => back());
    await fireEvent.press(await screen.findByTestId('drawer-d-2025'));
    expect(routes().at(-1)).toEqual({ pathname: '/drawer/[id]', params: { id: 'd-2025' } });
  });

  it('the folder’s path still names every level, the drawer passed over too', async () => {
    const t = vault('dev91');
    levelled(t);
    push({ pathname: '/folder/[id]', params: { id: 'f-2025' } });
    await unlocked(t, <DocumentsScreen />);
    expect((await screen.findByTestId('folder-path')).props.children).toBe('Financial › Me');
  });

  it('an older vault shows its way as levels, and every drawer and folder as before', async () => {
    const t = vault('dev51');
    // Its way by name; the levels are only for the test vault, which keeps every cabinet drawn by them
    // since dev.94 — a vault before levels is read without them.
    const older = { arranged_by: 'person_kind', levels: LEVELLED.levels, cabinets: LEVELLED.cabinets } as unknown as CabinetLayout;
    t.vault.state.cabinets = { [ME]: { layout: older, version: 1, updated_at: '2026-11-22T00:00:00Z' } };
    const first = await unlocked(t, <CabinetBrowse header={null} />);
    await screen.findByTestId('cabinet-c-fin');
    await waitFor(() => expect(screen.getByTestId('cabinet-arranged-by')).toHaveTextContent(/ · Arranged by Person › Kind$/));
    expect(screen.getByTestId('cabinet-c-fin')).toHaveTextContent('Financial1 drawer');
    expect(screen.getByTestId('cabinet-c-tax')).toHaveTextContent('Tax2 drawers');
    first.app.unmount();
    push({ pathname: '/cabinet/[id]', params: { id: 'c-fin' } });
    await unlocked(t, <CabinetLevel level="cabinet" />);
    await screen.findByTestId('drawer-d-me');
    expect(screen.queryByTestId('cabinet-only-drawer')).toBeNull();
  });
});

describe('a folder divided by two levels, Who issued it first (dev.90, dev.91)', () => {
  it('groups the leaves under their issuer’s tab, the first open; a lone step and No issuer given stand alone', async () => {
    const t = vault('dev91');
    issuerFolders(t, [
      { id: 'f-p60', name: 'P60s', hidden: false, filter: { type_key: 'p60' }, dividers: { levels: ['issuer', 'year'], ranges: [] } },
    ]);
    push({ pathname: '/folder/[id]', params: { id: 'f-p60' } });
    await unlocked(t, <DocumentsScreen />);
    const acme = await screen.findByTestId(`divider-group-issuer:${ACME}`);
    expect(acme).toHaveTextContent('Acme Payroll2');
    expect(acme.props.accessibilityState).toEqual({ expanded: true });
    // Inside it, its years, named by their own step; the newest open already.
    const newest = screen.getByTestId(`divider-issuer:${ACME}/year:2025`);
    expect(newest).toHaveTextContent('20251');
    expect(newest.props.accessibilityLabel).toBe('Acme Payroll · 2025, 1 document');
    await screen.findByTestId('doc-row-acme-2025');
    await fireEvent.press(screen.getByTestId(`divider-issuer:${ACME}/year:2024`));
    await screen.findByTestId('doc-row-acme-2024');
    // Bolt has one year: that step passed over, a divider of its own; none given, last.
    expect(screen.getByTestId(`divider-issuer:${BOLT}`)).toHaveTextContent('Bolt Works1');
    expect(screen.getByTestId('divider-issuer:')).toHaveTextContent('No issuer given1');
    expect(screen.queryByTestId(`divider-group-issuer:${BOLT}`)).toBeNull();
    await fireEvent.press(screen.getByTestId('divider-issuer:'));
    await screen.findByTestId('doc-row-none-2023');
    // Closed, its leaves go with it.
    await fireEvent.press(acme);
    expect(screen.queryByTestId(`divider-issuer:${ACME}/year:2025`)).toBeNull();
    expect(audit()).toEqual([]);
  });

  it('a folder with only one value at each step is one plain list', async () => {
    const t = vault('dev91');
    issuerFolders(t, [
      {
        id: 'f-acme',
        name: 'Acme',
        hidden: false,
        filter: { type_key: 'p60', issuer: ACME, dated_from: '2025-01-01', dated_to: '2025-12-31' },
        dividers: { levels: ['issuer', 'year'], ranges: [] },
      },
    ]);
    push({ pathname: '/folder/[id]', params: { id: 'f-acme' } });
    await unlocked(t, <DocumentsScreen />);
    await screen.findByTestId('doc-row-acme-2025');
    expect(screen.queryByTestId(/^divider-/)).toBeNull();
  });

  it('says who issued what a folder holds by the household’s names, and No issuer given', async () => {
    const t = vault('dev91');
    issuerFolders(t, [
      { id: 'f-acme', name: 'Acme', hidden: false, filter: { type_key: 'p60', issuer: ACME } },
      { id: 'f-none', name: 'None given', hidden: false, filter: { issuer: '_none', member_id: 'household' } },
    ]);
    push({ pathname: '/folder/[id]', params: { id: 'f-acme' } });
    const first = await unlocked(t, <DocumentsScreen />);
    await waitFor(() => expect(screen.getByTestId('folder-question')).toHaveTextContent(/from Acme Payroll\.$/));
    expect(t.calls.some((c) => c.includes('/api/v1/issuers/groups'))).toBe(true);
    first.app.unmount();
    resetRoutes();
    push({ pathname: '/folder/[id]', params: { id: 'f-none' } });
    await unlocked(t, <DocumentsScreen />);
    await waitFor(() =>
      expect(screen.getByTestId('folder-question')).toHaveTextContent('Papers with no issuer given, for The household.'),
    );
  });

  it('an older vault is never asked for the household’s issuers, and its dividers are each their own', async () => {
    const t = vault('dev51');
    issuerFolders(t, [
      { id: 'f-p60', name: 'P60s', hidden: false, filter: { type_key: 'p60' }, dividers: { levels: ['issuer', 'year'], ranges: [] } },
    ]);
    push({ pathname: '/folder/[id]', params: { id: 'f-p60' } });
    await unlocked(t, <DocumentsScreen />);
    // The flat list an older app is sent, as it was: "Acme Payroll · 2025", each a divider of its own.
    expect(await screen.findByTestId(`divider-issuer:${ACME}/year:2025`)).toHaveTextContent('Acme Payroll · 20251');
    expect(screen.queryByTestId(`divider-group-issuer:${ACME}`)).toBeNull();
    await screen.findByTestId('folder-question');
    expect(t.calls.some((c) => c.includes('/api/v1/issuers/groups'))).toBe(false);
  });
});

describe('the household’s issuers, asked once (dev.91)', () => {
  it('is asked only for a folder that names an issuer, then shared by every folder after it', async () => {
    const t = vault('dev91');
    const BOLT_FOLDER = { id: 'f-bolt', name: 'Bolt', hidden: false, filter: { type_key: 'p60', issuer: BOLT } };
    issuerFolders(t, [
      ...BY_ISSUER,
      { id: 'f-acme', name: 'Acme', hidden: false, filter: { type_key: 'p60', issuer: ACME } },
      BOLT_FOLDER,
      { id: 'f-none', name: 'None given', hidden: false, filter: { issuer: '_none' } },
    ]);
    const asked = () => t.calls.filter((c) => c.includes('/api/v1/issuers/groups')).length;
    // Divided by issuer, but asking for none: the vault names its own dividers, so nothing is asked.
    push({ pathname: '/folder/[id]', params: { id: 'f-p60' } });
    await unlocked(t, <DocumentsScreen />);
    await screen.findByTestId('folder-question');
    await act(async () => push({ pathname: '/folder/[id]', params: { id: 'f-none' } }));
    await waitFor(() => expect(screen.getByTestId('folder-question')).toHaveTextContent('Papers with no issuer given.'));
    expect(asked()).toBe(0);
    await act(async () => push({ pathname: '/folder/[id]', params: { id: 'f-acme' } }));
    await waitFor(() => expect(screen.getByTestId('folder-question')).toHaveTextContent('p60 from Acme Payroll.'));
    await act(async () => push({ pathname: '/folder/[id]', params: { id: 'f-bolt' } }));
    await waitFor(() => expect(screen.getByTestId('folder-question')).toHaveTextContent('p60 from Bolt Works.'));
    expect(asked()).toBe(1);
  });

  it('one asking for this vault and person, forgotten as the session ends or a document changes; a failure is not kept', async () => {
    const groups = { items: [], same_as: [], may_change: false };
    const ask = jest.fn(async () => groups);
    await issuerGroupsFor('v|me', ask);
    await issuerGroupsFor('v|me', ask);
    expect(ask).toHaveBeenCalledTimes(1);
    await issuerGroupsFor('v|sara', ask);
    expect(ask).toHaveBeenCalledTimes(2);
    await act(async () => emit('documentChanged', 'p60'));
    await issuerGroupsFor('v|me', ask);
    expect(ask).toHaveBeenCalledTimes(3);
    await act(async () => emit('sessionEnded', 'expired'));
    await issuerGroupsFor('v|me', ask);
    expect(ask).toHaveBeenCalledTimes(4);
    forgetCabinets();
    const failing = jest.fn(async () => {
      throw new Error('offline');
    });
    expect(await issuerGroupsFor('v|me', failing)).toBeNull();
    expect(await issuerGroupsFor('v|me', ask)).toBe(groups);
  });
});

describe('a folder’s dividers past a hundred, and a long one (dev.90)', () => {
  it('Everything else comes last with the smallest, counted, and opens with divider=rest', async () => {
    const t = vault('dev91');
    const papers = [
      p60('acme-25a', 'Acme Payroll', '2025-04-05'),
      p60('acme-25b', 'Acme Payroll', '2025-05-05'),
      p60('acme-24a', 'Acme Payroll', '2024-04-05'),
      p60('acme-24b', 'Acme Payroll', '2024-05-05'),
      ...Array.from({ length: 100 }, (_, i) => p60(`small-${i}`, `Issuer ${String(i).padStart(3, '0')}`, '2023-04-05')),
    ];
    issuerFolders(t, BY_ISSUER, papers);
    push({ pathname: '/folder/[id]', params: { id: 'f-p60' } });
    await unlocked(t, <DocumentsScreen />);
    const rest = await screen.findByTestId('divider-rest');
    // 102 leaves: the two of Acme kept under their tab, 97 of the rest, and three behind Everything else.
    expect(rest).toHaveTextContent('Everything else3');
    expect(screen.getByTestId(`divider-group-issuer:${ACME}`)).toHaveTextContent('Acme Payroll4');
    const tabs = screen.getAllByTestId(/^divider-(group-)?(issuer|rest)/).filter((n) => !/\/year:/.test(String(n.props.testID)));
    expect(tabs.at(-1)?.props.testID).toBe('divider-rest');
    expect(tabs).toHaveLength(99);
    await fireEvent.press(rest);
    await screen.findByTestId('doc-row-small-99');
    expect(screen.getByTestId('doc-row-small-97')).toBeTruthy();
    expect(t.calls.some((c) => c.includes('/cabinet/folders/f-p60/documents?divider=rest'))).toBe(true);
  });

  it('Show more inside a leaf under a tab asks for its own key, a page at a time', async () => {
    const t = vault('dev91');
    const papers = [
      ...Array.from({ length: 55 }, (_, i) =>
        p60(`acme-25-${i}`, 'Acme Payroll', `2025-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`),
      ),
      p60('acme-24', 'Acme Payroll', '2024-04-05'),
      p60('bolt-25', 'Bolt Works', '2025-04-05'),
    ];
    issuerFolders(t, BY_ISSUER, papers);
    push({ pathname: '/folder/[id]', params: { id: 'f-p60' } });
    await unlocked(t, <DocumentsScreen />);
    const key = `issuer:${ACME}/year:2025`;
    await fireEvent.press(await screen.findByTestId(`folder-more-${key}`));
    await waitFor(() => expect(screen.queryByTestId(`folder-more-${key}`)).toBeNull());
    const asked = t.calls.filter((c) => c.includes('/cabinet/folders/f-p60/documents?'));
    expect(asked).toHaveLength(2);
    expect(asked[0]).toContain(`divider=${encodeURIComponent(key)}`);
    expect(asked[1]).toContain(`divider=${encodeURIComponent(key)}`);
    expect(asked[1]).toContain('cursor=50');
    expect(screen.getAllByTestId(/^doc-row-acme-25-/)).toHaveLength(55);
  });
});

describe('a cabinet’s one drawer, as it changes (dev.89)', () => {
  it('a drawer whose folders are all hidden says so, its name still said', async () => {
    const t = vault('dev91');
    const layout: CabinetLayout = {
      levels: ['person', 'kind'],
      cabinets: [
        {
          id: 'c-mine',
          name: 'My cabinet',
          hidden: false,
          drawn: { value: null },
          drawers: [
            { id: 'd-me', name: 'Me', hidden: false, folders: [{ id: 'f-x', name: 'P60', hidden: true, filter: {} }] },
            { id: 'd-gone', name: 'Sara', hidden: true, folders: [] },
          ],
        },
      ],
    };
    t.vault.state.cabinets = { [ME]: { layout, version: 1, updated_at: '2026-11-22T00:00:00Z' } };
    push({ pathname: '/cabinet/[id]', params: { id: 'c-mine' } });
    await unlocked(t, <CabinetLevel level="cabinet" />);
    expect((await screen.findByTestId('cabinet-only-drawer')).props.children).toBe('In the Me drawer.');
    expect(screen.getByTestId('drawer-no-folders').props.children).toBe('Every folder in this drawer is hidden.');
    expect(screen.queryByTestId('folder-f-x')).toBeNull();
  });

  it('a cabinet read again with a second drawer shows its drawers, where it was', async () => {
    const t = vault('dev91');
    const one = structuredClone(LEVELLED);
    t.vault.state.cabinets = { [ME]: { layout: one, version: 1, updated_at: '2026-11-22T00:00:00Z' } };
    push({ pathname: '/cabinet/[id]', params: { id: 'c-fin' } });
    await unlocked(t, <CabinetLevel level="cabinet" />);
    await screen.findByTestId('cabinet-only-drawer');
    const two = structuredClone(LEVELLED);
    two.cabinets[0]?.drawers.push({
      id: 'd-sara',
      name: 'Sara',
      hidden: false,
      folders: [
        { id: 'f-sara-25', name: '2025', hidden: false, filter: { type_key: 'p60' } },
        { id: 'f-sara-24', name: '2024', hidden: false, filter: { type_key: 'p60' } },
      ],
    });
    t.vault.state.cabinets = { [ME]: { layout: two, version: 2, updated_at: '2026-11-22T01:00:00Z' } };
    // A paper saved brings the second drawer: the cabinet is read again, and shown as drawers.
    await act(async () => emit('documentChanged', 'p60'));
    await screen.findByTestId('drawer-d-sara');
    expect(screen.getByTestId('drawer-d-me')).toHaveTextContent('Me2 folders');
    expect(screen.queryByTestId('cabinet-only-drawer')).toBeNull();
    expect(screen.queryByTestId('folder-f-2025')).toBeNull();
    expect(routes()).toEqual([{ pathname: '/cabinet/[id]', params: { id: 'c-fin' } }]);
  });
});

describe('Large text, in the cabinet (dev.89, dev.90)', () => {
  /** The words given, on the screen as `open` leaves it, with and without Large text. */
  async function both(t: TestVault, route: string, id: string, find: () => Promise<ReactTestInstance[]>) {
    const out: ReturnType<typeof drawn>[][] = [];
    for (const large of [false, true]) {
      resetRoutes();
      forgetCabinets();
      push({ pathname: route, params: { id } });
      const r = await unlocked(t, route === '/folder/[id]' ? <DocumentsScreen /> : <CabinetLevel level="cabinet" />, { large });
      out.push((await find()).map(drawn));
      r.app.unmount();
    }
    const [normal, large] = out;
    expect(normal?.length).toBeGreaterThan(0);
    large?.forEach((l, i) => {
      const n = normal?.[i];
      expect(n?.size).toBeGreaterThan(0);
      expect(l.size).toBeCloseTo((n?.size ?? 0) * LARGE, 5);
      expect(l.cut).toBe(false);
    });
  }

  it('a drawer’s one-folder row, "2024 › Me", and a cabinet’s mark grow, never cut short', async () => {
    const t = vault('dev91');
    t.vault.state.cabinets = { [ME]: { layout: LEVELLED, version: 1, updated_at: '2026-11-22T00:00:00Z' } };
    await both(t, '/cabinet/[id]', 'c-tax', async () => {
      const row = await screen.findByTestId('folder-f-me-2024');
      return [within(row).getByText('2024 › Me'), screen.getByTestId('cabinet-mark')];
    });
  });

  it('"In the … drawer." grows, never cut short', async () => {
    const t = vault('dev91');
    t.vault.state.cabinets = { [ME]: { layout: LEVELLED, version: 1, updated_at: '2026-11-22T00:00:00Z' } };
    await both(t, '/cabinet/[id]', 'c-fin', async () => [await screen.findByTestId('cabinet-only-drawer')]);
  });

  it('a group’s tab and a leaf inside it grow, never cut short', async () => {
    const t = vault('dev91');
    issuerFolders(t, BY_ISSUER);
    await both(t, '/folder/[id]', 'f-p60', async () => {
      const tab = await screen.findByTestId(`divider-group-issuer:${ACME}`);
      const leaf = screen.getByTestId(`divider-issuer:${ACME}/year:2025`);
      return [within(tab).getByText('Acme Payroll'), within(leaf).getByText('2025')];
    });
  });
});
