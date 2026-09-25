import type { DocumentView } from '@fdv/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { DocumentDetail } from '../documents/detail';
import { saveCopyIo } from '../documents/save-copy';
import { MemoryEssentialsStore } from '../essentials/store';
import { CHECKED_KEY } from '../essentials/sync';
import { OWNER_KEY } from '../essentials/wipe';
import { writePrefs } from '../platform/prefs';
import { audit } from '../test-support/a11y';
import { libraryDoc, phoneParts, unlocked } from '../test-support/lookup';
import { installed } from '../test-support/render';
import { resetRoutes, routes } from '../test-support/router';
import { nextEtag, testVault } from '../test-support/vault';

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

describe('a document', () => {
  it("a cached Essential opens without asking to confirm it's you", async () => {
    const t = testVault([ORIGIN]);
    libraryDoc(t, { id: 'passport', title: 'Passport', is_essential: true }, { sensitive: true });
    // Kept on this phone already.
    const parts = phoneParts();
    const kept = new MemoryEssentialsStore();
    await kept.putDocument({
      id: 'passport',
      version_id: 'passport-v1',
      view: JSON.stringify({
        id: 'passport',
        title: 'Passport',
        is_essential: true,
        status: { value: 'valid', label: '' },
      }),
      pages: 1,
      kept_at: 1,
    });
    await kept.putPage('passport-v1', 1, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
    await kept.setState(OWNER_KEY, 'https://vault.test|fake-member');
    await kept.setState(
      CHECKED_KEY,
      JSON.stringify({ server_time: '2026-09-25T00:00:00Z', at: Date.now(), max_offline_days: 90 }),
    );
    parts.stores.set('everyday', kept);
    writePrefs('essentials', { enrolled: true, offered: true, kept: true, owner: 'https://vault.test|fake-member' });
    // And the vault agrees: in its set, under a grant.
    t.vault.state.offlineEssentials.items = [
      {
        document: t.library.documents.get('passport') as DocumentView,
        version: {
          id: 'passport-v1',
          mime: 'application/pdf',
          page_count: 1,
          preview_pages: 1,
          preview_state: 'ready',
        },
        private: false,
      },
    ];
    const granted = {
      granted_at: new Date().toISOString(),
      expires_at: '2099-01-01T00:00:00Z',
      include_private: false,
    };
    await unlocked(t, <DocumentDetail id="passport" />, {
      parts,
      before: () => {
        for (const x of t.vault.state.sessions) x.offlineGrant = granted;
      },
    });
    expect(await screen.findByText('Passport')).toBeTruthy();
    // Show is its primary action, and it opens from the phone.
    await waitFor(() => expect(screen.getByTestId('document-show')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('document-show'));
    await waitFor(() => expect(routes().at(-1)).toEqual({ pathname: '/show/[id]', params: { id: 'passport' } }));
    expect(await screen.findByTestId('show-image')).toBeTruthy();
    expect(screen.queryByTestId('step-up-sheet')).toBeNull();
    expect(t.library.stepUps).toEqual([]);
  });

  it('an uncached Essential asks once, then shows its pages', async () => {
    const t = testVault([ORIGIN]);
    libraryDoc(t, { id: 'will', title: 'Will', is_essential: true }, { sensitive: true });
    await unlocked(t, <DocumentDetail id="will" />);
    await fireEvent.press(await screen.findByTestId('document-pages'));
    await waitFor(() =>
      expect(routes().at(-1)).toEqual({ pathname: '/essential/[id]', params: { id: 'will', online: '1' } }),
    );
    // The vault asks to confirm it is you, with its own words.
    expect(await screen.findByText('Please confirm it is you to see this document.')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('step-up-password'), 'not it');
    await fireEvent.press(screen.getByTestId('step-up-go'));
    expect(await screen.findByText("That password isn't right.")).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('step-up-password'), PASSWORD);
    await fireEvent.press(screen.getByTestId('step-up-go'));
    expect(await screen.findByTestId('essential-image')).toBeTruthy();
    // The next page does not ask again.
    await fireEvent.press(screen.getByTestId('essential-next'));
    await waitFor(() => expect(screen.getByTestId('essential-page')).toHaveTextContent('Page 2 of 2'));
    expect(await screen.findByTestId('essential-image')).toBeTruthy();
    expect(t.library.stepUps).toEqual([PASSWORD]);
  });

  it('Save a copy warns once and leaves no file behind', async () => {
    const t = testVault([ORIGIN]);
    libraryDoc(t, { id: 'bill', title: 'Council tax bill' });
    const files = new Set<string>();
    const shared: string[] = [];
    jest.spyOn(saveCopyIo, 'write').mockImplementation(async (name) => {
      const uri = `cache:/copies/${name}`;
      files.add(uri);
      return uri;
    });
    jest.spyOn(saveCopyIo, 'share').mockImplementation(async (uri) => void shared.push(uri));
    jest.spyOn(saveCopyIo, 'remove').mockImplementation(async (uri) => void files.delete(uri));
    await unlocked(t, <DocumentDetail id="bill" />);
    // Save a copy is the primary action of a document that is not an Essential.
    await fireEvent.press(await screen.findByTestId('document-save'));
    expect(await screen.findByTestId('document-save-warning')).toHaveTextContent(
      "The copy you save is outside the vault, where the vault can't protect it.",
    );
    await fireEvent.press(screen.getByTestId('document-save-anyway'));
    await waitFor(() => expect(shared).toEqual(['cache:/copies/bill.pdf']));
    expect(files.size).toBe(0);
    // Warned once: the next copy goes straight to the share sheet.
    await fireEvent.press(screen.getByTestId('document-save'));
    await waitFor(() => expect(shared).toHaveLength(2));
    expect(screen.queryByTestId('document-save-warning')).toBeNull();
    expect(files.size).toBe(0);
    jest.restoreAllMocks();
  });

  it('a 409 reloads the latest', async () => {
    const t = testVault([ORIGIN]);
    const doc = libraryDoc(t, { id: 'passport', title: 'Passport' });
    await unlocked(t, <DocumentDetail id="passport" />);
    await screen.findByText('Passport');
    // Somebody else changes it meanwhile.
    t.library.documents.set('passport', { ...doc, title: 'Passport (renewed)', etag: nextEtag() });
    await fireEvent(screen.getByTestId('document-essential'), 'valueChange', true);
    expect(await screen.findByText("Someone changed this while you were looking. Here's the latest.")).toBeTruthy();
    expect(await screen.findByText('Passport (renewed)')).toBeTruthy();
    // Nothing of theirs was overwritten.
    expect(t.library.documents.get('passport')?.is_essential).toBe(false);
  });

  it('can be used with a screen reader and a thumb', async () => {
    const t = testVault([ORIGIN]);
    libraryDoc(t, { id: 'passport', title: 'Passport', is_essential: true });
    await unlocked(t, <DocumentDetail id="passport" />);
    await screen.findByTestId('document-show');
    expect(audit()).toEqual([]);
  });
});
