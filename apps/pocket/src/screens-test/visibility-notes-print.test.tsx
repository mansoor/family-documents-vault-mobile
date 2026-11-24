import { SENSITIVE_MEANS, TEEN_KEEPS_SENSITIVE, type DocumentView } from '@fdv/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Print from 'expo-print';
import EditScreen from '../app/edit/[id]';
import NewNoteScreen from '../app/new-note';
import { DocumentDetail } from '../documents/detail';
import { sensitiveToSend } from '../documents/note-edit';
import { withSensitive } from '../print/document-print';
import { SecureTokenStore } from '../session/store';
import { libraryDoc, unlocked } from '../test-support/lookup';
import { installed } from '../test-support/render';
import { push, resetRoutes, routes } from '../test-support/router';
import { caps0519, capabilities, testVault, type TestVault } from '../test-support/vault';

jest.mock(
  'expo-router',
  () => jest.requireActual<typeof import('../test-support/router')>('../test-support/router').routerMock,
);

/**
 * The owner's requests of 24 Nov 2026, on the phone: "Who can see it" is
 * called Visibility, and the line that opens the choice no longer says what
 * it is now; a note's Sensitive is switched only while it is edited, saved
 * with its words; and anything Sensitive says, before it is printed, to keep
 * the printout safe — its heading saying Sensitive.
 */

const ORIGIN = 'https://vault.test';
const SAFE = 'This is marked Sensitive. Keep the printout somewhere safe and shred it when you no longer need it.';
const printed = Print.printAsync as jest.Mock;

beforeEach(() => {
  installed();
  resetRoutes();
  printed.mockClear();
});

/** What was given to print, the last time. */
const html = (): string => (printed.mock.calls.at(-1)?.[0] as { html: string }).html;

/** A vault of 0.9.0-dev.87 or later: notes that ask, and Sensitive. */
function vault(over: Record<string, unknown> = {}): TestVault {
  const t = testVault([ORIGIN]);
  t.caps = capabilities({
    server_version: '0.9.0-dev.96',
    features: { ...caps0519().features, notes: true, sensitive_documents: true, auto_lock: true, ...over },
  });
  return t;
}

/** A note, kept by the test vault's own library. */
function note(t: TestVault, id: string, over: Partial<DocumentView> = {}): DocumentView {
  const d = libraryDoc(t, {
    id,
    title: 'Spare keys',
    type_key: 'note',
    category: 'other',
    notes: 'In the blue tin.',
    notes_updated_at: '2026-10-30T09:14:00Z',
    versions: 0,
    latest_version_id: null,
    sensitive: null,
    sensitive_effective: false,
    ...over,
  } as Partial<DocumentView> & { id: string });
  t.library.versions.set(id, []);
  return d;
}

/** Every PATCH of a document, as sent. */
function patches(t: TestVault): Record<string, unknown>[] {
  const sent: Record<string, unknown>[] = [];
  const real = t.fetch;
  t.fetch = async (url, init) => {
    if (init?.method === 'PATCH' && /\/api\/v1\/documents\/[^/]+$/.test(String(url))) {
      sent.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    }
    return real(url, init);
  };
  return sent;
}

/** The phone keeps this role for whoever signed in (the fake signs everybody in as its owner). */
const asTeen = async () => {
  const store = new SecureTokenStore();
  const kept = await store.load();
  await store.save({ ...(kept as NonNullable<typeof kept>), role: 'teen' as never });
};

async function editNote(t: TestVault, id: string, opts: { before?: () => Promise<void> } = {}) {
  push({ pathname: '/document/[id]', params: { id } });
  push({ pathname: '/edit/[id]', params: { id } });
  await unlocked(t, <EditScreen />, opts.before ? { before: opts.before } : {});
  await screen.findByTestId('edit-note-words');
}

describe('Visibility', () => {
  it('the document’s line is called Visibility and opens the choice, saying nothing of what it is now', async () => {
    const t = vault();
    libraryDoc(t, { id: 'pass', title: 'Passport', visibility: 'adults' });
    await unlocked(t, <DocumentDetail id="pass" />);
    const line = await screen.findByTestId('document-visibility');
    expect(line).toHaveTextContent(/^Visibility›$/);
    expect(line.props.accessibilityLabel).toBe('Change visibility');
    // The line under its title says it.
    expect(screen.getByTestId('document-subline')).toHaveTextContent(/Adults only$/);
    expect(screen.queryByText(/Who can see/)).toBeNull();
    await fireEvent.press(line);
    expect(await screen.findByTestId('visibility-sheet')).toHaveTextContent(/^Visibility/);
    expect(screen.getByTestId('visibility-adults').props.accessibilityState).toMatchObject({ checked: true });
  });

  it('a note’s line too', async () => {
    const t = vault();
    note(t, 'keys', { visibility: 'private' });
    await unlocked(t, <DocumentDetail id="keys" />);
    await screen.findByText('In the blue tin.');
    expect(await screen.findByTestId('document-visibility')).toHaveTextContent(/^Visibility›$/);
    expect(screen.getByTestId('document-subline')).toHaveTextContent(/Only me$/);
  });

  it('a new note asks for its Visibility', async () => {
    const t = vault();
    await unlocked(t, <NewNoteScreen />);
    await screen.findByTestId('new-note-household');
    expect(screen.getByText('Visibility')).toBeTruthy();
    expect(screen.queryByText(/Who can see/)).toBeNull();
  });
});

describe('a note’s Sensitive, switched only while it is edited', () => {
  it('its page has Essential as a switch and no Sensitive switch; a sensitive one is said, not switched', async () => {
    const t = vault();
    note(t, 'meds', { sensitive: true, sensitive_effective: true });
    await unlocked(t, <DocumentDetail id="meds" />);
    await screen.findByText('In the blue tin.');
    expect(screen.getByTestId('document-essential')).toBeTruthy();
    expect(screen.queryByTestId('note-sensitive')).toBeNull();
    expect(screen.queryByTestId('note-sensitive-switch')).toBeNull();
    expect(screen.getByTestId('document-sensitive')).toHaveTextContent('Sensitive');
  });

  it('is saved with the words, in the one request, and only when switched', async () => {
    const t = vault();
    note(t, 'meds');
    const sent = patches(t);
    await editNote(t, 'meds');
    expect(screen.getByTestId('edit-note-sensitive')).toHaveTextContent(SENSITIVE_MEANS, { exact: false });
    const toggle = screen.getByTestId('edit-note-sensitive-switch');
    expect(toggle.props.value).toBe(false);
    await fireEvent(toggle, 'valueChange', true);
    await fireEvent.changeText(screen.getByTestId('edit-note-words'), 'Two tablets at night.');
    await fireEvent.press(screen.getByTestId('edit-save'));
    await waitFor(() => expect(routes()).toHaveLength(1));
    expect(sent).toEqual([{ notes: 'Two tablets at night.', sensitive: true }]);
    expect(t.library.documents.get('meds')).toMatchObject({ sensitive: true, notes: 'Two tablets at night.' });
  });

  it('left alone, Sensitive is not sent', async () => {
    const t = vault();
    note(t, 'meds', { sensitive: true, sensitive_effective: true });
    const sent = patches(t);
    await editNote(t, 'meds');
    expect(screen.getByTestId('edit-note-sensitive-switch').props.value).toBe(true);
    await fireEvent.changeText(screen.getByTestId('edit-note-words'), 'Two tablets.');
    await fireEvent.press(screen.getByTestId('edit-save'));
    await waitFor(() => expect(routes()).toHaveLength(1));
    expect(sent).toEqual([{ notes: 'Two tablets.' }]);
  });

  it('a teen may make their note sensitive; a sensitive one is held, and why', async () => {
    const t = vault();
    note(t, 'meds', { sensitive: true, sensitive_effective: true });
    await editNote(t, 'meds', { before: asTeen });
    expect(screen.getByTestId('edit-note-sensitive')).toHaveTextContent(TEEN_KEEPS_SENSITIVE, { exact: false });
    expect(screen.getByTestId('edit-note-sensitive-switch').props.disabled).toBe(true);
  });

  it('a teen’s own note made sensitive is saved so', async () => {
    const t = vault();
    note(t, 'diary');
    const sent = patches(t);
    await editNote(t, 'diary', { before: asTeen });
    const toggle = screen.getByTestId('edit-note-sensitive-switch');
    expect(toggle.props.disabled).toBe(false);
    await fireEvent(toggle, 'valueChange', true);
    await fireEvent.press(screen.getByTestId('edit-save'));
    await waitFor(() => expect(routes()).toHaveLength(1));
    expect(sent).toEqual([{ notes: 'In the blue tin.', sensitive: true }]);
  });

  it('made sensitive while links outside the family still give it: saved, then asked, then back', async () => {
    const t = vault();
    note(t, 'meds');
    t.library.stillShared.set('meds', 2);
    await editNote(t, 'meds');
    await fireEvent(screen.getByTestId('edit-note-sensitive-switch'), 'valueChange', true);
    await fireEvent.press(screen.getByTestId('edit-save'));
    expect(
      await screen.findByText('This paper is shared outside the family by 2 links. Keep them, or end them now?'),
    ).toBeTruthy();
    expect(t.library.documents.get('meds')?.sensitive).toBe(true);
    expect(routes()).toHaveLength(2);
    await fireEvent.press(screen.getByTestId('edit-still-shared-keep'));
    await waitFor(() => expect(routes()).toHaveLength(1));
    expect(t.library.stopped).toEqual([]);
  });

  /** Somebody else makes the note sensitive while it is being edited: a new etag, and Sensitive on. */
  function madeSensitiveElsewhere(t: TestVault, id: string) {
    const was = t.library.documents.get(id) as DocumentView;
    t.library.documents.set(id, { ...was, sensitive: true, sensitive_effective: true, etag: `${was.etag}-theirs` });
  }

  it('changed somewhere else (409) and read again: a switch left alone shows Sensitive as it is now, and sends nothing', async () => {
    const t = vault();
    note(t, 'meds');
    const sent = patches(t);
    await editNote(t, 'meds');
    expect(screen.getByTestId('edit-note-sensitive-switch').props.value).toBe(false);
    madeSensitiveElsewhere(t, 'meds');
    await fireEvent.changeText(screen.getByTestId('edit-note-words'), 'Two tablets.');
    await fireEvent.press(screen.getByTestId('edit-save'));
    expect(await screen.findByTestId('edit-problem')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('edit-note-sensitive-switch').props.value).toBe(true));
    await fireEvent.press(screen.getByTestId('edit-save'));
    await waitFor(() => expect(routes()).toHaveLength(1));
    // The first save was refused; the second never undoes their Sensitive.
    expect(sent.at(-1)).toEqual({ notes: 'Two tablets.' });
    expect(t.library.documents.get('meds')).toMatchObject({ sensitive: true, notes: 'Two tablets.' });
  });

  it('read again after a 409, a switch the person moved keeps their choice', async () => {
    const t = vault();
    note(t, 'meds', { sensitive: true, sensitive_effective: true });
    await editNote(t, 'meds');
    await fireEvent(screen.getByTestId('edit-note-sensitive-switch'), 'valueChange', false);
    // Their change: the words, not Sensitive.
    const was = t.library.documents.get('meds') as DocumentView;
    t.library.documents.set('meds', { ...was, notes: 'Theirs.', etag: `${was.etag}-theirs` });
    await fireEvent.press(screen.getByTestId('edit-save'));
    expect(await screen.findByTestId('edit-problem')).toBeTruthy();
    expect(screen.getByTestId('edit-note-sensitive-switch').props.value).toBe(false);
  });

  it('a teen’s note made sensitive meanwhile: read again, its switch is held', async () => {
    const t = vault();
    note(t, 'diary');
    await editNote(t, 'diary', { before: asTeen });
    expect(screen.getByTestId('edit-note-sensitive-switch').props.disabled).toBe(false);
    madeSensitiveElsewhere(t, 'diary');
    await fireEvent.press(screen.getByTestId('edit-save'));
    expect(await screen.findByTestId('edit-problem')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('edit-note-sensitive-switch').props.disabled).toBe(true));
    expect(screen.getByTestId('edit-note-sensitive-switch').props.value).toBe(true);
    expect(screen.getByTestId('edit-note-sensitive')).toHaveTextContent(TEEN_KEEPS_SENSITIVE, { exact: false });
  });

  it('a vault without notes that ask, or without Sensitive, offers no switch', async () => {
    const t = vault({ auto_lock: false });
    note(t, 'meds');
    await editNote(t, 'meds');
    expect(screen.queryByTestId('edit-note-sensitive')).toBeNull();
  });

  it('what a save sends: a switch moved, never one already so, never not sensitive by a teen', () => {
    const base = { offered: true, began: false, chosen: true, now: false, teen: false };
    expect(sensitiveToSend(base)).toBe(true);
    expect(sensitiveToSend({ ...base, offered: false })).toBeUndefined();
    expect(sensitiveToSend({ ...base, chosen: false })).toBeUndefined();
    // Somebody else made it so meanwhile: nothing to send.
    expect(sensitiveToSend({ ...base, now: true })).toBeUndefined();
    expect(sensitiveToSend({ ...base, began: true, chosen: false, now: true })).toBe(false);
    expect(sensitiveToSend({ ...base, began: true, chosen: false, now: true, teen: true })).toBeUndefined();
  });
});

describe('printing anything Sensitive', () => {
  async function openPrint() {
    await fireEvent.press(await screen.findByTestId('document-more'));
    await fireEvent.press(await screen.findByTestId('document-print'));
  }

  it('a sensitive note says first to keep the printout safe; Cancel prints nothing; Print prints, its heading saying Sensitive', async () => {
    const t = vault();
    note(t, 'meds', { sensitive: true, sensitive_effective: true, visibility: 'adults' });
    await unlocked(t, <DocumentDetail id="meds" />);
    await screen.findByText('In the blue tin.');
    await openPrint();
    expect(await screen.findByTestId('print-sensitive')).toHaveTextContent(SAFE);
    expect(screen.getByTestId('print-sensitive-question')).toHaveTextContent(/^Before you print/);
    await fireEvent.press(screen.getByTestId('print-sensitive-cancel'));
    await waitFor(() => expect(screen.queryByTestId('print-sensitive')).toBeNull());
    expect(printed).not.toHaveBeenCalled();

    await openPrint();
    await fireEvent.press(await screen.findByTestId('print-sensitive-go'));
    await waitFor(() => expect(printed).toHaveBeenCalledTimes(1));
    expect(html()).toContain('<p class="sub">Adults only · Sensitive</p>');
    expect(screen.queryByTestId('step-up-sheet')).toBeNull();
  });

  it('a note that isn’t sensitive prints straight away, saying nothing of it', async () => {
    const t = vault();
    note(t, 'keys');
    await unlocked(t, <DocumentDetail id="keys" />);
    await screen.findByText('In the blue tin.');
    await openPrint();
    await waitFor(() => expect(printed).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('print-sensitive')).toBeNull();
    expect(html()).toContain('<p class="sub">Everyone in the family</p>');
    expect(html()).not.toContain('Sensitive');
  });

  it('a sensitive document says it at the top of what to print; Cancel prints nothing; its heading says Sensitive', async () => {
    const t = vault();
    libraryDoc(t, { id: 'will', title: 'Will', sensitive: true, sensitive_effective: true } as Partial<DocumentView> & {
      id: string;
    });
    await unlocked(t, <DocumentDetail id="will" />);
    await openPrint();
    expect(await screen.findByTestId('print-sensitive')).toHaveTextContent(SAFE);
    await fireEvent.press(screen.getByTestId('print-cancel'));
    await waitFor(() => expect(screen.queryByTestId('print-question')).toBeNull());
    expect(printed).not.toHaveBeenCalled();

    await openPrint();
    // Its details alone: the heading still says Sensitive.
    await fireEvent(await screen.findByTestId('print-pages'), 'valueChange', false);
    await fireEvent.press(screen.getByTestId('print-go'));
    await waitFor(() => expect(printed).toHaveBeenCalledTimes(1));
    expect(html()).toMatch(/<p class="sub">[^<]*· Sensitive<\/p>/);
    expect(html()).toContain('<dt>Visibility</dt><dd>Everyone in the family</dd>');
  });

  it('a document that isn’t sensitive says nothing before printing', async () => {
    const t = vault();
    libraryDoc(t, { id: 'pass', title: 'Passport', sensitive: false, sensitive_effective: false } as Partial<DocumentView> & {
      id: string;
    });
    await unlocked(t, <DocumentDetail id="pass" />);
    await openPrint();
    await screen.findByTestId('print-question');
    expect(screen.queryByTestId('print-sensitive')).toBeNull();
  });

  it('Sensitive after the heading’s line, or alone', () => {
    expect(withSensitive('Me · Passport · Adults only', true)).toBe('Me · Passport · Adults only · Sensitive');
    expect(withSensitive(null, true)).toBe('Sensitive');
    expect(withSensitive('Me', false)).toBe('Me');
  });
});
