import type { CabinetLayout, Capabilities, DocumentView } from '@fdv/shared';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import DocumentsScreen from '../app/(tabs)/documents';
import { CabinetBrowse } from '../cabinet/browse';
import { readLabel, shownLayout } from '../cabinet/model';
import { forgetCabinets } from '../cabinet/use-cabinet';
import { emit } from '../state/events';
import { ScanLabel } from '../cabinet/scan';
import { audit } from '../test-support/a11y';
import { DocumentDetail } from '../documents/detail';
import { libraryDoc, unlocked } from '../test-support/lookup';
import { installed, respond } from '../test-support/render';
import { push, resetRoutes, routes } from '../test-support/router';
import { capabilities, testVault, type TestVault } from '../test-support/vault';

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

/** A vault of 0.9.0-dev.51 (or as old as `upTo` says): the cabinet, dividers and pins, labels and places. */
function vault(upTo: 'dev51' | 'dev42' | 'none' = 'dev51'): TestVault {
  const t = testVault([ORIGIN]);
  const f: Capabilities['features'] = { ...capabilities().features, document_table: true };
  if (upTo !== 'none') f.cabinets = true;
  if (upTo === 'dev51') {
    f.cabinet_dividers = true;
    f.cabinet_pins = true;
    f.original_place = true;
  }
  t.caps = capabilities({ server_version: '0.9.0-dev.51', features: f });
  return t;
}

/** Study: Drawer 1 with Tax (P60s, by year) and a hidden folder; a hidden drawer; a hidden cabinet. */
const LAYOUT: CabinetLayout = {
  arranged_by: null,
  cabinets: [
    {
      id: 'c-study',
      name: 'Study',
      hidden: false,
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
    { id: 'c-hidden', name: 'Loft', hidden: true, drawers: [] },
  ],
};

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
