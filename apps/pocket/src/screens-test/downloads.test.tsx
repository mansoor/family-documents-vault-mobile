import type { SearchHit } from '@fdv/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import DocumentsScreen from '../app/(tabs)/documents';
import CollectionScreen from '../app/collection/[id]';
import { attachmentName } from '../documents/download';
import { copySettings, DownloadFailed, markWarnedAboutCopies, saveCopyIo, statusOf } from '../documents/save-copy';
import { audit } from '../test-support/a11y';
import { libraryDoc, openSearch, unlocked } from '../test-support/lookup';
import { installed } from '../test-support/render';
import { push, resetRoutes } from '../test-support/router';
import { capabilities, json, testVault, type TestVault } from '../test-support/vault';

jest.mock(
  'expo-router',
  () => jest.requireActual<typeof import('../test-support/router')>('../test-support/router').routerMock,
);

const ORIGIN = 'https://vault.test';
const PASSWORD = 'correct horse battery staple';

let shared: { name: string; mime: string; bytes: number }[] = [];
let files: Set<string>;
let named: Map<string, { name: string; bytes: number }>;
/** Each address the phone streamed from, in order. */
let streamed: string[];

beforeEach(() => {
  installed();
  resetRoutes();
  copySettings.graceMs = 0;
  shared = [];
  streamed = [];
  files = new Set();
  named = new Map();
  jest.spyOn(saveCopyIo, 'write').mockImplementation(async (name, bytes) => {
    const uri = `cache:/copies/${name}`;
    files.add(uri);
    named.set(uri, { name, bytes: bytes.length });
    return uri;
  });
  jest.spyOn(saveCopyIo, 'share').mockImplementation(async (uri, mime) => {
    const f = named.get(uri);
    shared.push({ name: f?.name ?? uri, mime, bytes: f?.bytes ?? 0 });
  });
  jest.spyOn(saveCopyIo, 'remove').mockImplementation(async (uri) => void files.delete(uri));
});

afterEach(() => jest.restoreAllMocks());

/**
 * The phone's native download, as save-copy's `download` does it: the
 * ticket's address fetched from the vault (the fake's GET /downloads/{ticket})
 * straight into a file. `fail(n)` says what goes wrong with the n-th: the
 * ticket already used (`gone`), or the connection dropping part-way (`drop`).
 */
function streams(t: TestVault, fail: (n: number) => 'gone' | 'drop' | null = () => null) {
  jest.spyOn(saveCopyIo, 'download').mockImplementation(async (url, name) => {
    const n = streamed.length;
    streamed.push(url);
    const how = fail(n);
    if (how === 'drop') throw new DownloadFailed(null);
    if (how === 'gone') await t.fetch(url, { method: 'GET', headers: {} });
    const res = await t.fetch(url, { method: 'GET', headers: {} });
    if (!res.ok) throw new DownloadFailed(res.status);
    const uri = `cache:/copies/${name}`;
    files.add(uri);
    named.set(uri, { name, bytes: (await res.arrayBuffer()).byteLength });
    return uri;
  });
}

/** A vault of 0.9.0-dev.48 on: several documents as one ZIP. */
function vault(zips = true): TestVault {
  const t = testVault([ORIGIN]);
  t.caps = capabilities({
    server_version: '0.9.0',
    features: { ...capabilities().features, collections: true, zip_download: zips },
  });
  return t;
}

/** Papers the fake keeps, each with a file: listed with their newest version, as the vault lists them. */
function papers(t: TestVault) {
  const inner = t.fetch;
  t.fetch = async (url, init) => {
    const res = await inner(url, init);
    if (init.method !== 'GET' || !res.ok || !/\/api\/v1\/documents\?/.test(url)) return res;
    const body = (await res.json()) as { items: { id: string }[] };
    return json({ ...body, items: body.items.map((d) => ({ ...d, latest_version_id: `${d.id}-v1` })) });
  };
  for (const [id, title] of [
    ['passport', 'Passport'],
    ['visa', 'Visa'],
    ['will', 'Will'],
  ] as const) {
    t.vault.state.documents.push({ id, title, type_key: 'other' });
    t.vault.state.captures.set(`key-${id}`, {
      kind: 'capture',
      document_id: id,
      version_id: `${id}-v1`,
      version_no: 1,
      filename: `${id}.pdf`,
      mime: 'application/pdf',
      byte_size: 10,
      uploaded_at: '2026-11-01T00:00:00Z',
    });
  }
}

const hit = (document_id: string, title: string): SearchHit =>
  ({
    document_id,
    title,
    type_key: 'other',
    category: 'other',
    owner_member_id: 'fake-member',
    status: { value: 'valid', label: '' },
    snippet: '',
    matched_in: 'content',
  }) as SearchHit;

const ticketsAsked = (t: TestVault) => t.calls.filter((c) => c.startsWith(`POST ${ORIGIN}/api/v1/documents/download/ticket`));

describe('the ZIP’s name, and a native download’s failure', () => {
  it('reads filename*, then a plain filename, else none', () => {
    expect(attachmentName("attachment; filename*=UTF-8''Holiday%20papers%202026-11-17.zip")).toBe(
      'Holiday papers 2026-11-17.zip',
    );
    expect(attachmentName('attachment; filename="Family documents.zip"')).toBe('Family documents.zip');
    expect(attachmentName(null)).toBeNull();
  });

  it('a status the vault answered, or none for a connection that went', () => {
    expect(statusOf(new Error('Unable to download a file: response has status: 404'))).toBe(404);
    expect(statusOf(new Error('Unable to download a file: timeout'))).toBeNull();
  });
});

describe('Download from Documents (DL)', () => {
  it('Choose, tick two, Download: a ticket, streamed to a file (never read into the app), to the share sheet', async () => {
    const t = vault();
    papers(t);
    streams(t);
    await unlocked(t, <DocumentsScreen />);
    await screen.findByTestId('doc-row-passport');
    expect(screen.queryByTestId('documents-choose-bar')).toBeNull();
    await fireEvent.press(screen.getByTestId('documents-choose'));
    expect(await screen.findByTestId('documents-chosen-count')).toHaveTextContent('0 chosen');
    expect(screen.getByTestId('documents-download').props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );
    // A row is a box to tick now: it does not open the document, and its ⋯ waits.
    const row = screen.getByTestId('doc-row-passport');
    expect(row.props.accessibilityRole).toBe('checkbox');
    await fireEvent.press(row);
    await fireEvent.press(screen.getByTestId('doc-row-will'));
    expect(screen.getByTestId('doc-row-passport').props.accessibilityState).toEqual(
      expect.objectContaining({ checked: true }),
    );
    expect(screen.getByTestId('documents-chosen-count')).toHaveTextContent('2 chosen');
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByTestId('documents-download'));
    // The first copy out of the vault: said once.
    expect(await screen.findByTestId('download-warning')).toHaveTextContent(/outside the vault/);
    await fireEvent.press(screen.getByTestId('download-anyway'));
    await waitFor(() => expect(shared).toHaveLength(1));
    expect(shared[0]).toEqual(expect.objectContaining({ mime: 'application/zip' }));
    expect(shared[0]?.name).toMatch(/^Family documents \d{4}-\d{2}-\d{2}\.zip$/);
    expect(shared[0]?.bytes).toBeGreaterThan(0);
    expect(ticketsAsked(t)).toHaveLength(1);
    expect(streamed).toEqual([expect.stringMatching(new RegExp(`^${ORIGIN}/api/v1/downloads/`))]);
    // Never the ZIP through the app's memory: no POST /documents/download, nothing written from bytes.
    expect(t.calls.some((c) => c === `POST ${ORIGIN}/api/v1/documents/download`)).toBe(false);
    expect(saveCopyIo.write).not.toHaveBeenCalled();
    expect(files.size).toBe(0);
    expect(await screen.findByTestId('documents-download-said')).toHaveTextContent(/2 documents are ready, as one ZIP/);
    // Done choosing: the rows open documents again.
    expect(screen.queryByTestId('documents-choose-bar')).toBeNull();
    expect(screen.getByTestId('doc-row-passport').props.accessibilityRole).toBe('button');
  });

  it('a ticket used or run out is asked for once more; twice, it says so', async () => {
    const t = vault();
    papers(t);
    streams(t, (n) => (n === 0 ? 'gone' : null));
    markWarnedAboutCopies();
    await unlocked(t, <DocumentsScreen />);
    await fireEvent.press(await screen.findByTestId('documents-choose'));
    await fireEvent.press(await screen.findByTestId('doc-row-passport'));
    await fireEvent.press(screen.getByTestId('doc-row-visa'));
    await fireEvent.press(screen.getByTestId('documents-download'));
    await waitFor(() => expect(shared).toHaveLength(1));
    expect(ticketsAsked(t)).toHaveLength(2);
    expect(streamed).toHaveLength(2);

    const again = vault();
    papers(again);
    streams(again, () => 'gone');
    shared = [];
    streamed = [];
    await unlocked(again, <DocumentsScreen />);
    await fireEvent.press(await screen.findByTestId('documents-choose'));
    await fireEvent.press(await screen.findByTestId('doc-row-passport'));
    await fireEvent.press(screen.getByTestId('doc-row-visa'));
    await fireEvent.press(screen.getByTestId('documents-download'));
    expect(await screen.findByTestId('documents-download-said')).toHaveTextContent(
      'The download ran out before it could start. Try Download again.',
    );
    expect(ticketsAsked(again)).toHaveLength(2);
    expect(shared).toEqual([]);
    // Still chosen, to try again.
    expect(screen.getByTestId('documents-chosen-count')).toHaveTextContent('2 chosen');
  });

  it('the connection going part-way says so, and leaves nothing', async () => {
    const t = vault();
    papers(t);
    streams(t, () => 'drop');
    markWarnedAboutCopies();
    await unlocked(t, <DocumentsScreen />);
    await fireEvent.press(await screen.findByTestId('documents-choose'));
    await fireEvent.press(await screen.findByTestId('doc-row-passport'));
    await fireEvent.press(screen.getByTestId('doc-row-will'));
    await fireEvent.press(screen.getByTestId('documents-download'));
    expect(await screen.findByTestId('documents-download-said')).toHaveTextContent(
      'Downloading needs a connection to the vault.',
    );
    expect(shared).toEqual([]);
    expect(files.size).toBe(0);
  });

  it('a Sensitive one among them: confirms it is you first; cancelled, nothing is downloaded', async () => {
    const t = vault();
    papers(t);
    streams(t);
    t.library.zipSensitive.add('visa');
    markWarnedAboutCopies();
    await unlocked(t, <DocumentsScreen />);
    await fireEvent.press(await screen.findByTestId('documents-choose'));
    // Without the Sensitive one, nothing is asked.
    await fireEvent.press(await screen.findByTestId('doc-row-passport'));
    await fireEvent.press(screen.getByTestId('doc-row-will'));
    await fireEvent.press(screen.getByTestId('documents-download'));
    await waitFor(() => expect(shared).toHaveLength(1));
    expect(t.library.stepUps).toEqual([]);
    // With it: asked; cancelled, nothing; confirmed, the ZIP.
    await fireEvent.press(screen.getByTestId('documents-choose'));
    await fireEvent.press(screen.getByTestId('doc-row-passport'));
    await fireEvent.press(screen.getByTestId('doc-row-visa'));
    await fireEvent.press(screen.getByTestId('documents-download'));
    expect(await screen.findByTestId('step-up-sheet')).toHaveTextContent(/download a sensitive document/);
    await fireEvent.press(screen.getByTestId('step-up-cancel'));
    await waitFor(() => expect(screen.queryByTestId('step-up-password')).toBeNull());
    expect(shared).toHaveLength(1);
    expect(screen.getByTestId('documents-chosen-count')).toHaveTextContent('2 chosen');
    await fireEvent.press(screen.getByTestId('documents-download'));
    await fireEvent.changeText(await screen.findByTestId('step-up-password'), PASSWORD);
    await fireEvent.press(screen.getByTestId('step-up-go'));
    await waitFor(() => expect(shared).toHaveLength(2));
    expect(t.library.stepUps).toEqual([PASSWORD]);
  });

  it('one chosen with a file comes as itself, as Save a copy gives it; a second tap waits', async () => {
    const t = vault();
    papers(t);
    libraryDoc(t, { id: 'passport', title: 'Passport' });
    markWarnedAboutCopies();
    await unlocked(t, <DocumentsScreen />);
    await fireEvent.press(await screen.findByTestId('documents-choose'));
    await fireEvent.press(await screen.findByTestId('doc-row-passport'));
    const button = screen.getByTestId('documents-download');
    await fireEvent.press(button);
    await fireEvent.press(button);
    await waitFor(() => expect(shared).toEqual([{ name: 'passport.pdf', mime: 'application/pdf', bytes: 4 }]));
    expect(t.calls.filter((c) => c.includes('/documents/passport/versions'))).toHaveLength(1);
    expect(t.calls.some((c) => c.includes('/download'))).toBe(false);
    expect(await screen.findByTestId('documents-download-said')).toHaveTextContent(/^The document is ready/);
  });

  it('what a search leaves out is unticked, so nothing unseen is downloaded', async () => {
    const t = vault();
    papers(t);
    libraryDoc(t, { id: 'passport', title: 'Passport' });
    t.library.search = () => ({ items: [hit('passport', 'Passport')], sealed: 0 });
    markWarnedAboutCopies();
    await unlocked(t, <DocumentsScreen />);
    await fireEvent.press(await screen.findByTestId('documents-choose'));
    await fireEvent.press(await screen.findByTestId('doc-row-passport'));
    await fireEvent.press(screen.getByTestId('doc-row-will'));
    expect(screen.getByTestId('documents-chosen-count')).toHaveTextContent('2 chosen');
    await openSearch();
    await fireEvent.changeText(screen.getByTestId('search-field'), 'pass');
    await waitFor(() => expect(screen.getByTestId('documents-chosen-count')).toHaveTextContent('1 chosen'));
    expect(screen.queryByTestId('doc-row-will')).toBeNull();
    // The one left, as itself.
    await fireEvent.press(screen.getByTestId('documents-download'));
    await waitFor(() => expect(shared).toEqual([expect.objectContaining({ name: 'passport.pdf' })]));
  });

  it('one sealed search hit chosen comes as itself too', async () => {
    const t = vault();
    papers(t);
    libraryDoc(t, { id: 'passport', title: 'Passport' });
    t.library.search = () => ({ items: [], sealed: 1 });
    t.library.sealed = [hit('passport', 'Passport')];
    markWarnedAboutCopies();
    await unlocked(t, <DocumentsScreen />);
    await fireEvent.press(await screen.findByTestId('documents-choose'));
    await openSearch();
    await fireEvent.changeText(screen.getByTestId('search-field'), 'pass');
    await fireEvent.press(await screen.findByTestId('doc-row-passport'));
    expect(screen.getByTestId('documents-chosen-count')).toHaveTextContent('1 chosen');
    await fireEvent.press(screen.getByTestId('documents-download'));
    await waitFor(() => expect(shared).toEqual([expect.objectContaining({ name: 'passport.pdf', mime: 'application/pdf' })]));
    expect(t.calls.some((c) => c.includes('/download'))).toBe(false);
  });

  it('Cancel stops choosing; a vault without ZIPs offers no Choose', async () => {
    const t = vault();
    papers(t);
    await unlocked(t, <DocumentsScreen />);
    await fireEvent.press(await screen.findByTestId('documents-choose'));
    await fireEvent.press(await screen.findByTestId('doc-row-visa'));
    await fireEvent.press(screen.getByTestId('documents-choose-cancel'));
    expect(screen.queryByTestId('documents-choose-bar')).toBeNull();

    const older = vault(false);
    papers(older);
    await unlocked(older, <DocumentsScreen />);
    await screen.findByTestId('doc-row-visa');
    expect(screen.queryByTestId('documents-choose')).toBeNull();
  });
});

describe('Download on a collection (DL)', () => {
  function holiday(t: TestVault, items: string[]) {
    t.vault.state.collections.push({
      id: 'hol',
      name: 'Holiday',
      description: null,
      audience: 'everyone',
      owner_member_id: 'fake-member',
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-01T00:00:00Z',
      revision: 1,
      deleted: false,
      items: items.map((document_id, i) => ({ document_id, added_at: `2026-09-0${i + 1}T00:00:00Z`, added_by: 'fake-member' })),
    } as never);
  }

  it('the ⋯ downloads everything in it as one ZIP named for it, through its ticket', async () => {
    const t = vault();
    papers(t);
    streams(t);
    holiday(t, ['passport', 'visa']);
    markWarnedAboutCopies();
    push({ pathname: '/collection/[id]', params: { id: 'hol' } });
    await unlocked(t, <CollectionScreen />);
    await fireEvent.press(await screen.findByTestId('collection-more'));
    await fireEvent.press(await screen.findByTestId('collection-download'));
    await waitFor(() => expect(shared).toHaveLength(1));
    expect(shared[0]?.name).toMatch(/^Holiday \d{4}-\d{2}-\d{2}\.zip$/);
    expect(t.calls).toContain(`POST ${ORIGIN}/api/v1/collections/hol/download/ticket`);
    expect(saveCopyIo.write).not.toHaveBeenCalled();
    expect(await screen.findByTestId('collection-said')).toHaveTextContent(
      /^Everything you may download from “Holiday” is ready, as one ZIP/,
    );
  });

  it('a Sensitive one in it asks to confirm it is you first', async () => {
    const t = vault();
    papers(t);
    streams(t);
    holiday(t, ['passport']);
    t.library.zipSensitive.add('passport');
    markWarnedAboutCopies();
    push({ pathname: '/collection/[id]', params: { id: 'hol' } });
    await unlocked(t, <CollectionScreen />);
    await fireEvent.press(await screen.findByTestId('collection-more'));
    await fireEvent.press(await screen.findByTestId('collection-download'));
    await fireEvent.changeText(await screen.findByTestId('step-up-password'), PASSWORD);
    await fireEvent.press(screen.getByTestId('step-up-go'));
    await waitFor(() => expect(shared).toHaveLength(1));
  });

  it('an empty collection: no Download', async () => {
    const t = vault();
    holiday(t, []);
    push({ pathname: '/collection/[id]', params: { id: 'hol' } });
    await unlocked(t, <CollectionScreen />);
    await screen.findByTestId('collection-empty');
    expect(screen.queryByTestId('collection-download')).toBeNull();
  });
});
