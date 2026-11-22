import type { ActivityEvent, DocumentView } from '@fdv/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Print from 'expo-print';
import { Text } from 'react-native';
import { ActivityScreen } from '../activity/screen';
import { DocumentDetail } from '../documents/detail';
import { libraryDoc, unlocked } from '../test-support/lookup';
import { installed } from '../test-support/render';
import { push, resetRoutes } from '../test-support/router';
import { caps0519, capabilities, testVault, type TestVault } from '../test-support/vault';

jest.mock(
  'expo-router',
  () => jest.requireActual<typeof import('../test-support/router')>('../test-support/router').routerMock,
);

/**
 * Printing on the phone (0.21.0): a document — its pages and a sheet of its
 * details — a note, a collection's contents and the activity log, given to
 * the platform's print as one page with nothing of the app around it.
 */

const ORIGIN = 'https://vault.test';
const PASSWORD = 'correct horse battery staple';
const printed = Print.printAsync as jest.Mock;

beforeEach(() => {
  installed();
  resetRoutes();
  printed.mockClear();
});

/** What was given to print, the last time. */
const html = (): string => (printed.mock.calls.at(-1)?.[0] as { html: string }).html;

function vault(): TestVault {
  const t = testVault([ORIGIN]);
  t.caps = capabilities({
    server_version: '0.9.0-dev.87',
    features: { ...caps0519().features, notes: true, collections: true, document_activity: true },
  });
  t.vault.state.members.push({ id: 'pat', display_name: 'Pat', role: 'adult', is_me: false } as never);
  return t;
}

async function openPrint() {
  await fireEvent.press(await screen.findByTestId('document-more'));
  await fireEvent.press(await screen.findByTestId('document-print'));
}

describe('printing a document', () => {
  it('an Essential asks “Confirm it’s you” before its pages are read, then prints them and its details', async () => {
    const t = vault();
    libraryDoc(
      t,
      { id: 'will', title: 'Will', is_essential: true, physical_location: 'The safe', expires: { date: '2031-03-14', precision: 'day' } },
      { sensitive: true },
    );
    await unlocked(t, <DocumentDetail id="will" />);
    await openPrint();
    expect(await screen.findByTestId('print-question')).toBeTruthy();
    expect(screen.getByTestId('print-pages').props.value).toBe(true);
    expect(screen.getByTestId('print-details').props.value).toBe(true);
    await fireEvent.press(screen.getByTestId('print-go'));
    await fireEvent.changeText(await screen.findByTestId('step-up-password'), PASSWORD);
    await fireEvent.press(screen.getByTestId('step-up-go'));
    await waitFor(() => expect(printed).toHaveBeenCalledTimes(1));
    const page = html();
    expect(page).toContain('<h1>Will</h1>');
    expect(page.match(/<img src="data:image\/jpeg;base64,/g)).toHaveLength(2);
    expect(page).toContain('alt="Page 1 of 2"');
    expect(page).toContain('<dt>Expires</dt><dd>14 Mar 2031</dd>');
    expect(page).toContain('Printed from The Test family on');
    // Nothing of the app: no buttons, no links.
    expect(page).not.toMatch(/<button|<a /);
    expect(t.library.stepUps).toEqual([PASSWORD]);
    await waitFor(() => expect(screen.queryByTestId('print-question')).toBeNull());
  });

  it('not confirmed: nothing is printed, and it says so', async () => {
    const t = vault();
    libraryDoc(t, { id: 'will', title: 'Will', is_essential: true }, { sensitive: true });
    await unlocked(t, <DocumentDetail id="will" />);
    await openPrint();
    await fireEvent.press(await screen.findByTestId('print-go'));
    await fireEvent.press(await screen.findByTestId('step-up-cancel'));
    expect(await screen.findByTestId('document-notice')).toHaveTextContent("Nothing was printed: it wasn't confirmed to be you.");
    expect(printed).not.toHaveBeenCalled();
  });

  it('its details alone ask nothing, and read none of its pages', async () => {
    const t = vault();
    libraryDoc(t, { id: 'will', title: 'Will', is_essential: true }, { sensitive: true });
    await unlocked(t, <DocumentDetail id="will" />);
    await openPrint();
    await fireEvent(await screen.findByTestId('print-pages'), 'valueChange', false);
    await fireEvent.press(screen.getByTestId('print-go'));
    await waitFor(() => expect(printed).toHaveBeenCalledTimes(1));
    expect(html()).not.toContain('<img');
    expect(html()).toContain('<dt>Status</dt>');
    expect(screen.queryByTestId('step-up-sheet')).toBeNull();
    expect(t.library.stepUps).toEqual([]);
  });

  it('a note prints its title, who sees it, when it changed and its words, asking nothing', async () => {
    const t = vault();
    libraryDoc(t, {
      id: 'keys',
      title: 'Spare keys',
      type_key: 'note',
      category: 'other',
      visibility: 'adults',
      notes: 'In the **blue** tin.\n\n- [ ] Ask Pat',
      notes_updated_at: '2026-10-30T09:14:00Z',
      versions: 0,
      latest_version_id: null,
    });
    t.library.versions.set('keys', []);
    await unlocked(t, <DocumentDetail id="keys" />);
    await openPrint();
    await waitFor(() => expect(printed).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('print-question')).toBeNull();
    const page = html();
    expect(page).toContain('<h1>Spare keys</h1>');
    expect(page).toContain('<p class="sub">Adults only</p>');
    expect(page).toContain('In the <strong>blue</strong> tin.');
    expect(page).toContain('☐ Ask Pat');
  });
});

/** A paper as the client's fake keeps it, for a collection's lists. */
function listed(t: TestVault, doc: Partial<DocumentView> & { id: string; title: string }) {
  t.vault.state.documents.push({
    type_key: 'passport',
    owner_member_id: 'fake-member',
    visibility: 'household',
    identifier: null,
    issued_by: null,
    issued: null,
    expires: null,
    physical_location: null,
    tags: [],
    notes: null,
    extra: {},
    ...doc,
  } as never);
}

describe('printing a collection', () => {
  function holiday(t: TestVault) {
    listed(t, { id: 'passport', title: 'Passport', expires: { date: '2031-03-14', precision: 'day' } });
    listed(t, { id: 'bill', title: 'Water <bill>', owner_member_id: 'pat' });
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
      items: ['passport', 'bill'].map((document_id) => ({ document_id, added_at: '2026-09-02T00:00:00Z' })),
    } as never);
  }

  it('everything in it as a table, the columns nobody fills left out, with a box to tick when asked', async () => {
    const t = vault();
    holiday(t);
    push({ pathname: '/collection/[id]', params: { id: 'hol' } });
    await unlocked(t, <Text>Collections</Text>);
    await fireEvent.press(await screen.findByTestId('collection-more'));
    await fireEvent.press(await screen.findByTestId('collection-print'));
    expect(await screen.findByTestId('collection-print-question')).toBeTruthy();
    await fireEvent(screen.getByTestId('collection-print-tick'), 'valueChange', true);
    await fireEvent.press(screen.getByTestId('collection-print-go'));
    await waitFor(() => expect(printed).toHaveBeenCalledTimes(1));
    const page = html();
    expect(page).toContain('<h1>Holiday</h1>');
    expect(page).toContain('<th>Done</th><th>Name</th>');
    expect(page).toContain('<td>Passport</td>');
    expect(page).toContain('14 Mar 2031');
    expect(page).toContain('<td>Water &lt;bill&gt;</td>');
    expect(page).toContain('<td>Pat</td>');
    // Nobody is told where they are kept: no column for it.
    expect(page).not.toContain('Where it is kept');
    expect(page.match(/<td class="tick">☐<\/td>/g)).toHaveLength(2);
  });
});

describe('printing the activity log', () => {
  const event = (over: Partial<ActivityEvent> & { id: number; action: string; object_id: string }): ActivityEvent => ({
    at: `2026-11-${String(10 + over.id).padStart(2, '0')}T10:00:00Z`,
    actor: 'Fake Owner',
    actor_member_id: 'fake-member',
    actor_label: null,
    object_type: 'document',
    object_title: null,
    detail: {},
    ...over,
  });

  it('the lines its filters keep, and who they are about said at the top', async () => {
    const t = vault();
    listed(t, { id: 'passport', title: 'Passport' });
    libraryDoc(t, { id: 'passport', title: 'Passport' });
    t.vault.state.activity = [
      event({ id: 1, action: 'document.created', object_id: 'passport', object_title: 'Passport' }),
      event({ id: 2, action: 'document.downloaded', object_id: 'passport', object_title: 'Passport', actor: 'Pat', actor_member_id: 'pat' }),
    ];
    await unlocked(t, <ActivityScreen />);
    await screen.findByTestId('activity-lines');
    await fireEvent.press(screen.getByTestId('activity-filters'));
    await fireEvent.press(await screen.findByTestId('activity-who-pat'));
    await fireEvent.press(screen.getByTestId('activity-filters-done'));
    await fireEvent.press(screen.getByTestId('activity-print'));
    await waitFor(() => expect(printed).toHaveBeenCalledTimes(1));
    const page = html();
    expect(page).toContain('<p class="said">Who: Pat</p>');
    expect(page).toContain('Pat downloaded');
    expect(page).not.toContain('added');
    expect(page).toContain('<th>When</th><th>What happened</th>');
  });

  it('nothing filtered: everything it shows, said so', async () => {
    const t = vault();
    t.vault.state.activity = [event({ id: 1, action: 'document.created', object_id: 'passport', object_title: 'Passport' })];
    await unlocked(t, <ActivityScreen />);
    await fireEvent.press(await screen.findByTestId('activity-print'));
    await waitFor(() => expect(printed).toHaveBeenCalledTimes(1));
    expect(html()).toContain('Everything the activity log shows you.');
  });
});
