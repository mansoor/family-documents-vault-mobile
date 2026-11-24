import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { View } from 'react-native';
import EditScreen from '../app/edit/[id]';
import { DocumentDetail } from '../documents/detail';
import { EssentialPages } from '../essentials/pages';
import { KeptRows } from '../essentials/ui';
import { EssentialsLine } from '../home/glance';
import { MemoryEssentialsStore } from '../essentials/store';
import { CHECKED_KEY, isKeptNote, noteVersion } from '../essentials/sync';
import { OWNER_KEY } from '../essentials/wipe';
import { writePrefs } from '../platform/prefs';
import { emit } from '../state/events';
import { phoneParts, unlocked } from '../test-support/lookup';
import { installed } from '../test-support/render';
import { push, resetRoutes } from '../test-support/router';
import { caps0519, capabilities, testVault, type TestVault } from '../test-support/vault';

jest.mock(
  'expo-router',
  () => jest.requireActual<typeof import('../test-support/router')>('../test-support/router').routerMock,
);

const ORIGIN = 'https://vault.test';
const PASSWORD = 'correct horse battery staple';

beforeEach(() => {
  installed();
  resetRoutes();
});

/** A vault of 0.9.0-dev.87: notes that ask, Essential and Sensitive on a note. */
function vault(): TestVault {
  const t = testVault([ORIGIN]);
  t.caps = capabilities({
    features: { ...caps0519().features, notes: true, sensitive_documents: true, auto_lock: true },
  });
  return t;
}

/** A note as the client's fake keeps one. */
function note(t: TestVault, id: string, words: string, over: Record<string, unknown> = {}) {
  t.vault.state.documents.push({
    id,
    title: `Note ${id}`,
    type_key: 'note',
    owner_member_id: 'fake-member',
    visibility: 'household',
    identifier: null,
    issued_by: null,
    issued: null,
    expires: null,
    physical_location: null,
    tags: [],
    notes: words,
    notes_updated_at: '2026-11-01T10:00:00Z',
    extra: {},
    ...over,
  } as never);
}

const stored = (t: TestVault, id: string) =>
  t.vault.state.documents.find((d) => d.id === id) as unknown as Record<string, unknown>;

describe("notes that ask \"Confirm it's you\" (a vault of 0.9.0-dev.87)", () => {
  it('an Only me note asks before its words are shown, and once confirmed the editor asks nothing more', async () => {
    const t = vault();
    note(t, 'safe', 'The safe is behind the boiler.', { visibility: 'private' });
    await unlocked(t, <DocumentDetail id="safe" />, { before: () => t.vault.forgetConfirmation() });
    expect(await screen.findByTestId('step-up-sheet')).toBeTruthy();
    expect(screen.queryByText('The safe is behind the boiler.')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('step-up-password'), PASSWORD);
    await fireEvent.press(screen.getByTestId('step-up-go'));
    expect(await screen.findByText('The safe is behind the boiler.')).toBeTruthy();
    expect(t.library.stepUps).toEqual([PASSWORD]);
  });

  it('cancelled, the page says so and asks nothing by itself; its button asks again', async () => {
    const t = vault();
    note(t, 'gate', 'Gate code 4821', { is_essential: true });
    await unlocked(t, <DocumentDetail id="gate" />, { before: () => t.vault.forgetConfirmation() });
    await fireEvent.press(await screen.findByTestId('step-up-cancel'));
    expect(await screen.findByTestId('document-confirm-needed')).toHaveTextContent(
      /^This note asks you to confirm it's you before its words are shown\./,
    );
    expect(screen.queryByText('Gate code 4821')).toBeNull();
    expect(screen.queryByTestId('step-up-sheet')).toBeNull();
    await fireEvent.press(screen.getByTestId('document-confirm'));
    await fireEvent.changeText(await screen.findByTestId('step-up-password'), PASSWORD);
    await fireEvent.press(screen.getByTestId('step-up-go'));
    expect(await screen.findByText('Gate code 4821')).toBeTruthy();
    expect(screen.queryByTestId('document-confirm-needed')).toBeNull();
  });

  it('Sensitive alone never asks', async () => {
    const t = vault();
    note(t, 'bins', 'Bins go out on Tuesday.', { sensitive: true });
    await unlocked(t, <DocumentDetail id="bins" />, { before: () => t.vault.forgetConfirmation() });
    expect(await screen.findByText('Bins go out on Tuesday.')).toBeTruthy();
    expect(screen.queryByTestId('step-up-sheet')).toBeNull();
  });

  it('the editor of a note that asks opens only once confirmed; not confirmed, it says so with Try again', async () => {
    const t = vault();
    note(t, 'safe', 'Behind the boiler.', { visibility: 'private' });
    push({ pathname: '/edit/[id]', params: { id: 'safe' } });
    await unlocked(t, <EditScreen />, { before: () => t.vault.forgetConfirmation() });
    await fireEvent.press(await screen.findByTestId('step-up-cancel'));
    expect(await screen.findByTestId('load-failed')).toHaveTextContent(
      /^This note opens only once you confirm it's you\. Try again to confirm\./,
    );
    await fireEvent.press(screen.getByTestId('load-failed-retry'));
    await fireEvent.changeText(await screen.findByTestId('step-up-password'), PASSWORD);
    await fireEvent.press(screen.getByTestId('step-up-go'));
    expect(await screen.findByTestId('edit-note-words')).toBeTruthy();
  });

  it('a note made Essential keeps its words shown; turning it off asks first, then confirms it is you', async () => {
    const t = vault();
    note(t, 'wifi', 'The router is in the hall.');
    await unlocked(t, <DocumentDetail id="wifi" />);
    expect(await screen.findByText('The router is in the hall.')).toBeTruthy();
    await fireEvent(screen.getByTestId('document-essential'), 'valueChange', true);
    await waitFor(() => expect(t.library.essential.get('wifi')).toBe(true));
    expect(screen.getByText('The router is in the hall.')).toBeTruthy();
    // As the vault keeps it: an Essential note now, which asks.
    stored(t, 'wifi').is_essential = true;

    // Five minutes on: turning it off takes a check away, so it asks twice — whether, and who.
    t.vault.forgetConfirmation();
    await fireEvent(screen.getByTestId('document-essential'), 'valueChange', false);
    await fireEvent.press(await screen.findByTestId('essential-off-yes'));
    await fireEvent.changeText(await screen.findByTestId('step-up-password'), PASSWORD);
    await fireEvent.press(screen.getByTestId('step-up-go'));
    await waitFor(() => expect(t.library.essential.get('wifi')).toBe(false));
    expect(t.library.stepUps).toEqual([PASSWORD]);
  });

  // A note's Sensitive is switched in its editor since app 0.23.0, never on its page: visibility-notes-print.test.

  it('an Essential note is kept on the phone, words and all, and shown from there when not confirmed', async () => {
    const t = vault();
    note(t, 'gate', 'Gate code 4821', { is_essential: true });
    const parts = phoneParts();
    const kept = new MemoryEssentialsStore();
    await kept.setState(OWNER_KEY, 'https://vault.test|fake-member');
    parts.stores.set('everyday', kept);
    writePrefs('essentials', { enrolled: true, offered: true, kept: true, owner: 'https://vault.test|fake-member' });
    const granted = { granted_at: new Date().toISOString(), expires_at: '2099-01-01T00:00:00Z', include_private: false };
    await unlocked(t, <DocumentDetail id="gate" />, {
      parts,
      before: () => {
        for (const x of t.vault.state.sessions) x.offlineGrant = granted;
        t.vault.forgetConfirmation();
      },
    });
    await fireEvent.press(await screen.findByTestId('step-up-cancel'));
    // Kept by the sync, in the same encrypted store as the Essentials' pages, with no version of its own.
    await waitFor(async () => expect(await kept.document('gate')).not.toBeNull());
    expect(isKeptNote((await kept.document('gate'))?.version_id ?? '')).toBe(true);
    expect(await screen.findByText('Gate code 4821')).toBeTruthy();
    // Its words are shown: nothing says they wait.
    expect(screen.queryByTestId('document-confirm-needed')).toBeNull();

    // Made not Essential somewhere else: the next sync takes it off the phone.
    stored(t, 'gate').is_essential = false;
    await act(async () => emit('documentChanged', 'gate'));
    expect(screen.queryByTestId('step-up-sheet')).toBeNull();
    await waitFor(async () => expect(await kept.document('gate')).toBeNull(), { timeout: 8_000 });
  });

  it('a kept Essential note opens from On this phone with its words, asking the vault nothing', async () => {
    const t = vault();
    const parts = phoneParts();
    const kept = new MemoryEssentialsStore();
    const view = {
      id: 'gate',
      title: 'Gate',
      type_key: 'note',
      notes: 'The code is **4821**.',
      notes_updated_at: '2026-11-01T10:00:00Z',
      status: { value: 'valid', label: '' },
    };
    await kept.putDocument({ id: 'gate', version_id: noteVersion(view as never), view: JSON.stringify(view), pages: 0, kept_at: 1 });
    await kept.setState(OWNER_KEY, 'https://vault.test|fake-member');
    await kept.setState(CHECKED_KEY, JSON.stringify({ server_time: new Date().toISOString(), at: Date.now(), max_offline_days: 90 }));
    parts.stores.set('everyday', kept);
    writePrefs('essentials', { enrolled: true, offered: true, kept: true, owner: 'https://vault.test|fake-member' });
    // And the vault agrees: in its set, under a grant.
    note(t, 'gate', 'The code is **4821**.', { title: 'Gate', is_essential: true });
    const granted = { granted_at: new Date().toISOString(), expires_at: '2099-01-01T00:00:00Z', include_private: false };
    await unlocked(t, <EssentialPages id="gate" />, {
      parts,
      before: () => {
        for (const x of t.vault.state.sessions) x.offlineGrant = granted;
      },
    });
    expect(await screen.findByTestId('essential-note')).toHaveTextContent(/^GateThe code is 4821\./);
    expect(screen.queryByTestId('essential-no-preview')).toBeNull();
    expect(screen.queryByTestId('step-up-sheet')).toBeNull();
    // A note's opening has no version the vault knows: none is kept to tell it.
    expect(await kept.opens()).toEqual([]);
  });

  it('a save answered without the words (notes null, waiting to be confirmed) keeps them shown', async () => {
    const t = vault();
    note(t, 'wifi', 'The router is in the hall.');
    const real = t.vault.fetch;
    t.vault.fetch = async (url, init) => {
      const res = await real(url, init);
      if (init.method !== 'PATCH' || !url.endsWith('/api/v1/documents/wifi') || res.status !== 200) return res;
      const view = { ...((await res.json()) as object), notes: null, confirm_to_read: 'open_essential' };
      return { ...res, json: async () => view, text: async () => JSON.stringify(view) } as typeof res;
    };
    await unlocked(t, <DocumentDetail id="wifi" />);
    expect(await screen.findByText('The router is in the hall.')).toBeTruthy();
    await fireEvent(screen.getByTestId('document-essential'), 'valueChange', true);
    await waitFor(() => expect(t.library.essential.get('wifi')).toBe(true));
    expect(screen.getByText('The router is in the hall.')).toBeTruthy();
    expect(screen.queryByTestId('document-confirm-needed')).toBeNull();
  });

  it('a reload nobody asked for never asks, and keeps the words shown', async () => {
    const t = vault();
    note(t, 'safe', 'Behind the boiler.', { visibility: 'private' });
    await unlocked(t, <DocumentDetail id="safe" />);
    expect(await screen.findByText('Behind the boiler.')).toBeTruthy();
    // Five minutes on, something changes it here: looked at again, asking nothing.
    t.vault.forgetConfirmation();
    await act(async () => emit('documentChanged', 'safe'));
    await act(async () => new Promise((r) => setTimeout(r, 50)));
    expect(screen.queryByTestId('step-up-sheet')).toBeNull();
    expect(screen.getByText('Behind the boiler.')).toBeTruthy();
    expect(screen.queryByTestId('document-confirm-needed')).toBeNull();
  });

  it('a kept note is named by its title, or Untitled note, on Home and under On this phone: never its first words', async () => {
    const t = vault();
    note(t, 'gate', 'Gate code 4821', { title: null, is_essential: true, note_name: 'Gate code 4821' });
    const parts = phoneParts();
    const kept = new MemoryEssentialsStore();
    // As an older copy might have kept it: its first words in the view.
    await kept.putDocument({
      id: 'gate',
      version_id: 'note:2026-11-01T10:00:00Z',
      view: JSON.stringify({ id: 'gate', title: null, type_key: 'note', note_name: 'Gate code 4821', notes: 'Gate code 4821' }),
      pages: 0,
      kept_at: 1,
    });
    await kept.setState(OWNER_KEY, 'https://vault.test|fake-member');
    await kept.setState(CHECKED_KEY, JSON.stringify({ server_time: new Date().toISOString(), at: Date.now(), max_offline_days: 90 }));
    parts.stores.set('everyday', kept);
    writePrefs('essentials', { enrolled: true, offered: true, kept: true, owner: 'https://vault.test|fake-member' });
    await unlocked(
      t,
      <View>
        <EssentialsLine />
        <KeptRows />
      </View>,
      {
        parts,
        before: () => {
          const granted = { granted_at: new Date().toISOString(), expires_at: '2099-01-01T00:00:00Z', include_private: false };
          for (const x of t.vault.state.sessions) x.offlineGrant = granted;
        },
      },
    );
    expect(await screen.findByTestId('home-essential-gate')).toHaveTextContent('Untitled note');
    expect(screen.getByTestId('essential-gate')).toHaveTextContent(/^Untitled note/);
    expect(screen.queryByText(/4821/)).toBeNull();
  });

  it('an older vault offers neither on a note', async () => {
    const t = testVault([ORIGIN]);
    t.caps = capabilities({ features: { ...caps0519().features, notes: true, sensitive_documents: true } });
    note(t, 'old', 'Nothing asks here.');
    await unlocked(t, <DocumentDetail id="old" />);
    expect(await screen.findByText('Nothing asks here.')).toBeTruthy();
    expect(screen.queryByTestId('document-essential')).toBeNull();
    expect(screen.queryByTestId('note-sensitive')).toBeNull();
  });
});
