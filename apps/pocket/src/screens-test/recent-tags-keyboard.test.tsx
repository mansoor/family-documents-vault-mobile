import type { DocumentView, TagView } from '@fdv/shared';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { AccessibilityInfo } from 'react-native';
import Home from '../app/(tabs)/index';
import DocumentsScreen from '../app/(tabs)/documents';
import { DocumentDetail } from '../documents/detail';
import { readRecentTab, writeRecentTab } from '../home/recent';
import { emit } from '../state/events';
import { audit } from '../test-support/a11y';
import { libraryDoc, openSearch, unlocked } from '../test-support/lookup';
import { installed } from '../test-support/render';
import { resetRoutes, routes } from '../test-support/router';
import { caps0519, capabilities, json, testVault, type TestVault } from '../test-support/vault';
import { KEYBOARD_GAP } from '../ui/keyboard';

jest.mock(
  'expo-router',
  () => jest.requireActual<typeof import('../test-support/router')>('../test-support/router').routerMock,
);

/**
 * App 0.26.0: Home's Recent, its tabs Added and Opened (the vault's
 * 0.9.0-dev.102), opens told to the vault from a document's page; tags as
 * other apps offer them, and the Documents filter's tags read again (the
 * vault's 0.9.0-dev.103); and the keyboard never hiding what is typed.
 */

const ORIGIN = 'https://vault.test';
const ME = `${ORIGIN}|fake-member`;

beforeEach(() => {
  installed();
  resetRoutes();
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

/** What was said to a screen reader about the tags offered, in order. */
const said = (): string[] =>
  (AccessibilityInfo.announceForAccessibility as unknown as jest.Mock).mock.calls
    .map((c) => String(c[0]))
    .filter((w) => w.includes('offered above the field'));

interface Seen {
  t: TestVault;
  /** Every GET /tags, as asked. */
  tagAsks: string[];
  /** Every POST /me/recently-opened's document_id. */
  told: string[];
  /** Every GET /me/recently-opened, as asked. */
  openedAsks: string[];
}

/**
 * A vault of the build asked for: 0.9.0-dev.103 (Opened and recent tags),
 * dev.102 (Opened alone) or an older one (neither), with tags and filters.
 * `opened` is what GET /me/recently-opened answers; `tags` what GET /tags
 * answers, most recently used first.
 */
function vault(
  build: 'dev103' | 'dev102' | 'older',
  over: { opened?: DocumentView[]; tags?: TagView[]; openFails?: boolean } = {},
): Seen {
  const t = testVault([ORIGIN]);
  t.caps = capabilities({
    server_version: build === 'older' ? '0.9.0-dev.98' : build === 'dev102' ? '0.9.0-dev.102' : '0.9.0-dev.103',
    features: {
      ...caps0519().features,
      notes: true,
      notes_apart: true,
      tag_filters: true,
      document_filters: true,
      ...(build !== 'older' ? { recently_opened: true } : {}),
      ...(build === 'dev103' ? { recent_tags: true } : {}),
    },
  });
  const seen: Seen = { t, tagAsks: [], told: [], openedAsks: [] };
  const inner = t.fetch;
  t.fetch = async (url, init) => {
    const path = url.replace(ORIGIN, '');
    // Out of reach: as the vault's own fake answers, nothing at all.
    if (!t.reachable.has(ORIGIN)) return inner(url, init);
    if (path.startsWith('/api/v1/tags?') || path === '/api/v1/tags') {
      seen.tagAsks.push(path);
      const q = new URL(url).searchParams.get('q');
      const all = over.tags ?? [];
      return json({ items: q ? all.filter((x) => x.tag.startsWith(q.toLowerCase())) : all });
    }
    if (path.startsWith('/api/v1/me/recently-opened')) {
      if (init.method === 'POST') {
        seen.told.push(String((JSON.parse(String(init.body)) as { document_id: string }).document_id));
        if (over.openFails) {
          return { ok: false, status: 500, headers: { get: () => 'application/json' }, json: async () => ({ code: 'internal' }) } as never;
        }
        return { ok: true, status: 204, headers: { get: () => null }, json: async () => null, text: async () => '' } as never;
      }
      seen.openedAsks.push(path);
      return json({ items: over.opened ?? [] });
    }
    return inner(url, init);
  };
  return seen;
}

/** In the vault's lists too (Home's Added), as the client's fake keeps documents. */
function listed(t: TestVault, doc: DocumentView): DocumentView {
  t.vault.state.documents.push({
    id: doc.id,
    title: doc.title,
    type_key: doc.type_key,
    owner_member_id: doc.owner_member_id,
    visibility: doc.visibility,
    is_essential: doc.is_essential,
    identifier: null,
    issued_by: null,
    issued: null,
    expires: null,
    physical_location: null,
    tags: doc.tags ?? [],
    notes: null,
    extra: {},
  } as never);
  return doc;
}

const tag = (name: string, count = 1): TagView => ({ tag: name, count, label: null, value: null });

describe("Home's Recent: Added and Opened (0.9.0-dev.102)", () => {
  it('an older vault: Recently added as before, no tabs, nothing asked of opens', async () => {
    const s = vault('older');
    listed(s.t, libraryDoc(s.t, { id: 'bill', title: 'Water bill' }));
    await unlocked(s.t, <Home />);
    expect(await screen.findByTestId('home-recent-title')).toHaveTextContent('Recently added');
    expect(screen.queryByTestId('home-recent-tabs')).toBeNull();
    expect(await screen.findByTestId('doc-menu-bill')).toBeTruthy();
    expect(s.openedAsks).toEqual([]);
  });

  it('Recent with its tabs, Added first; Opened lists what was opened, and is remembered on the phone', async () => {
    const opened: DocumentView[] = [];
    const s = vault('dev102', { opened });
    listed(s.t, libraryDoc(s.t, { id: 'bill', title: 'Water bill' }));
    opened.push(libraryDoc(s.t, { id: 'passport', title: 'Passport' }));
    await unlocked(s.t, <Home />);
    expect(await screen.findByTestId('home-recent-title')).toHaveTextContent('Recent');
    const tabs = await screen.findByTestId('home-recent-tabs');
    expect(tabs.props.accessibilityRole).toBe('tablist');
    const added = within(tabs).getByTestId('home-recent-added');
    expect(added.props.accessibilityRole).toBe('tab');
    expect(added.props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
    expect(within(tabs).getByTestId('home-recent-opened').props.accessibilityState).toEqual(expect.objectContaining({ selected: false }));
    expect(await screen.findByTestId('doc-menu-bill')).toBeTruthy();
    // Added shows: nothing asked of what was opened.
    expect(s.openedAsks).toEqual([]);
    expect(audit()).toEqual([]);

    await fireEvent.press(within(tabs).getByTestId('home-recent-opened'));
    expect(await screen.findByTestId('doc-menu-passport')).toBeTruthy();
    expect(screen.queryByTestId('doc-menu-bill')).toBeNull();
    expect(screen.getByTestId('home-recent-opened').props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );
    expect(s.openedAsks).toEqual(['/api/v1/me/recently-opened?limit=5']);
    expect(readRecentTab(ME)).toBe('opened');
    // Its ⋯ is a Recently added row's: Print at its end.
    await fireEvent.press(screen.getByTestId('doc-menu-passport'));
    expect(await screen.findByTestId('row-sheet-print')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('row-sheet-cancel'));

    // A document opened elsewhere on the phone: Opened looks again.
    await act(async () => emit('documentOpened', 'bill'));
    await waitFor(() => expect(s.openedAsks.length).toBe(2));

    // Added again: its rows, and kept so.
    await fireEvent.press(screen.getByTestId('home-recent-added'));
    expect(await screen.findByTestId('doc-menu-bill')).toBeTruthy();
    expect(readRecentTab(ME)).toBe('added');
  });

  it('the tab chosen last is where Home starts; nothing opened yet is said', async () => {
    const s = vault('dev102', { opened: [] });
    listed(s.t, libraryDoc(s.t, { id: 'bill', title: 'Water bill' }));
    writeRecentTab(ME, 'opened');
    await unlocked(s.t, <Home />);
    expect(await screen.findByTestId('home-opened-none')).toHaveTextContent('Nothing opened yet.');
    expect(screen.getByTestId('home-recent-opened').props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );
    expect(screen.queryByTestId('doc-menu-bill')).toBeNull();
    expect(screen.queryByTestId('home-none')).toBeNull();
  });

  it('an older vault ignores a tab kept from a newer one', async () => {
    const s = vault('older');
    listed(s.t, libraryDoc(s.t, { id: 'bill', title: 'Water bill' }));
    writeRecentTab(ME, 'opened');
    await unlocked(s.t, <Home />);
    expect(await screen.findByTestId('doc-menu-bill')).toBeTruthy();
    expect(s.openedAsks).toEqual([]);
  });
});

describe("a document's page tells the vault it was opened (0.9.0-dev.102)", () => {
  it('once, as it is opened: never again for a reload or a change saved', async () => {
    const s = vault('dev102');
    libraryDoc(s.t, { id: 'passport', title: 'Passport' });
    await unlocked(s.t, <DocumentDetail id="passport" />);
    await waitFor(() => expect(s.told).toEqual(['passport']));
    await act(async () => emit('documentChanged', 'passport'));
    await act(async () => emit('documentChanged', 'passport'));
    // Reloaded, as before; told nothing more.
    await screen.findByTestId('document-edit');
    expect(s.told).toEqual(['passport']);
  });

  it('never a note, and never on an older vault', async () => {
    const s = vault('dev102');
    libraryDoc(s.t, { id: 'n1', title: 'Spare key', type_key: 'note', category: 'note', notes: 'Under the pot.' } as never);
    await unlocked(s.t, <DocumentDetail id="n1" />);
    await screen.findByTestId('document-edit');
    expect(s.told).toEqual([]);

    const older = vault('older');
    libraryDoc(older.t, { id: 'passport', title: 'Passport' });
    await unlocked(older.t, <DocumentDetail id="passport" />);
    await screen.findByTestId('document-edit');
    expect(older.told).toEqual([]);
  });

  it('a failure to tell it says nothing: the page is open all the same', async () => {
    const s = vault('dev102', { openFails: true });
    libraryDoc(s.t, { id: 'passport', title: 'Passport' });
    await unlocked(s.t, <DocumentDetail id="passport" />);
    await waitFor(() => expect(s.told).toEqual(['passport']));
    expect(await screen.findByTestId('document-edit')).toBeTruthy();
    expect(screen.queryByText(/went wrong|couldn.t/i)).toBeNull();
  });
});

async function openEdit(id: string) {
  await fireEvent.press(await screen.findByTestId('document-edit'));
  await waitFor(() => expect(routes().at(-1)).toEqual({ pathname: '/edit/[id]', params: { id } }));
}

describe('tags as other apps offer them (0.9.0-dev.103)', () => {
  const tags = [tag('passport', 2), tag('travel', 4), tag('renew'), tag('school'), tag('house'), tag('car'), tag('tax')];

  it('focused and empty: five recently used, never one it has; a tap adds it', async () => {
    const s = vault('dev103', { tags });
    libraryDoc(s.t, { id: 'passport', title: 'Passport', tags: ['travel'] });
    await unlocked(s.t, <DocumentDetail id="passport" />);
    await openEdit('passport');
    const field = await screen.findByTestId('edit-tag-new');
    // Nothing offered, nor asked, before the field has the focus.
    expect(screen.queryByTestId('edit-tag-offers')).toBeNull();
    expect(s.tagAsks).toEqual([]);
    await fireEvent(field, 'focus');
    const offers = await screen.findByTestId('edit-tag-offers');
    expect(within(offers).getByTestId('edit-tags-recent')).toHaveTextContent('Recently used');
    // Five more than the one it has, the one it has left out.
    expect(s.tagAsks).toEqual(['/api/v1/tags?limit=6&sort=recent']);
    expect(within(offers).queryByTestId('edit-tag-offer-travel')).toBeNull();
    const shown = within(offers)
      .getAllByRole('button')
      .map((b) => String(b.props.testID));
    expect(shown).toEqual([
      'edit-tag-offer-passport',
      'edit-tag-offer-renew',
      'edit-tag-offer-school',
      'edit-tag-offer-house',
      'edit-tag-offer-car',
    ]);
    expect(screen.getByTestId('edit-tag-offer-renew').props.accessibilityLabel).toBe('Add the tag renew');
    // Above the field: shown whenever it is, never under the keyboard and Save.
    const editor = screen.getByTestId('edit-tags');
    const order = within(editor)
      .getAllByTestId(/^(edit-tag-offers|edit-tag-new)$/)
      .map((n) => String(n.props.testID));
    expect(order).toEqual(['edit-tag-offers', 'edit-tag-new']);
    expect(within(offers).getByTestId('edit-tags-recent').props.accessibilityRole).toBe('header');
    expect(said()).toEqual(['Recently used tags are offered above the field.']);
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByTestId('edit-tag-offer-renew'));
    expect(screen.getByTestId('edit-tag-renew')).toBeTruthy();
    // Asked again with one more had; the one added is no longer offered.
    await waitFor(() => expect(s.tagAsks.at(-1)).toBe('/api/v1/tags?limit=7&sort=recent'));
    await waitFor(() => expect(screen.queryByTestId('edit-tag-offer-renew')).toBeNull());
  });

  it('typing: what fits, asked once the typing settles; a new word added with Add as before', async () => {
    const s = vault('dev103', { tags });
    libraryDoc(s.t, { id: 'passport', title: 'Passport', tags: ['travel'] });
    await unlocked(s.t, <DocumentDetail id="passport" />);
    await openEdit('passport');
    const field = await screen.findByTestId('edit-tag-new');
    await fireEvent(field, 'focus');
    await screen.findByTestId('edit-tags-recent');
    await fireEvent.changeText(field, 't');
    await fireEvent.changeText(field, 'ta');
    // Asked for what was typed last, once the typing settles, not for each letter.
    await waitFor(() => expect(s.tagAsks.filter((u) => u.includes('q='))).toEqual(['/api/v1/tags?q=ta&limit=50']));
    expect(screen.getByTestId('edit-tags-used')).toHaveTextContent('Tags already used');
    expect(screen.getByTestId('edit-tag-offer-tax')).toBeTruthy();
    expect(screen.queryByTestId('edit-tag-offer-travel')).toBeNull();
    // Said as they changed to those that fit; not again for another letter that still fits.
    expect(said().at(-1)).toBe('Tags already used that fit are offered above the field.');
    const before = said().length;
    await fireEvent.changeText(field, 'tax');
    await waitFor(() => expect(s.tagAsks.filter((u) => u.includes('q=')).length).toBe(2));
    expect(said().length).toBe(before);
    await fireEvent.changeText(field, 'garden');
    await fireEvent.press(screen.getByTestId('edit-tag-add'));
    expect(screen.getByTestId('edit-tag-garden')).toBeTruthy();
  });

  it('an older vault offers nothing until something is typed, then what fits', async () => {
    const s = vault('dev102', { tags });
    libraryDoc(s.t, { id: 'passport', title: 'Passport', tags: [] });
    await unlocked(s.t, <DocumentDetail id="passport" />);
    await openEdit('passport');
    const field = await screen.findByTestId('edit-tag-new');
    await fireEvent(field, 'focus');
    await act(async () => new Promise((r) => setTimeout(r, 300)));
    expect(screen.queryByTestId('edit-tag-offers')).toBeNull();
    expect(s.tagAsks).toEqual([]);
    await fireEvent.changeText(field, 'ho');
    expect(await screen.findByTestId('edit-tag-offer-house')).toBeTruthy();
    expect(s.tagAsks.every((u) => !u.includes('sort='))).toBe(true);
  });

  it('without the vault: no pills, and a tag is added as before', async () => {
    const s = vault('dev103', { tags });
    libraryDoc(s.t, { id: 'passport', title: 'Passport', tags: [] });
    await unlocked(s.t, <DocumentDetail id="passport" />);
    await openEdit('passport');
    const field = await screen.findByTestId('edit-tag-new');
    s.t.reachable.delete(ORIGIN);
    await fireEvent(field, 'focus');
    await act(async () => new Promise((r) => setTimeout(r, 300)));
    expect(screen.queryByTestId('edit-tag-offers')).toBeNull();
    await fireEvent.changeText(field, 'renew');
    await fireEvent.press(screen.getByTestId('edit-tag-add'));
    expect(screen.getByTestId('edit-tag-renew')).toBeTruthy();
  });
});

describe("the Documents filter's tags, read again (the owner's passport bug)", () => {
  /** Asked, and settled: what was asked so far, once nothing more comes. */
  async function settled(s: Seen): Promise<number> {
    await waitFor(() => expect(s.tagAsks.length).toBeGreaterThan(0));
    await act(async () => new Promise((r) => setTimeout(r, 200)));
    return s.tagAsks.length;
  }

  /** The tag chips the open filters show, in order. */
  const chips = () =>
    screen
      .getAllByTestId(/^filter-tag-(?!s-more)/)
      .map((c) => String(c.props.testID).replace('filter-tag-', ''));

  it('read again as the filters open, the newest first; a change here marks them, never asks at once', async () => {
    const list = [tag('school')];
    const s = vault('dev103', { tags: list });
    listed(s.t, libraryDoc(s.t, { id: 'bill', title: 'Water bill' }));
    await unlocked(s.t, <DocumentsScreen />);
    const first = await settled(s);
    expect(new Set(s.tagAsks)).toEqual(new Set(['/api/v1/tags?limit=1000&sort=recent']));
    // A tag added to two documents meanwhile: a change here asks nothing of the vault yet.
    list.unshift(tag('passport', 2));
    await act(async () => emit('documentChanged', 'bill'));
    await act(async () => new Promise((r) => setTimeout(r, 100)));
    expect(s.tagAsks.length).toBe(first);
    // Opened: asked again; the newest is offered, after those that were there (none moves under a finger).
    await openSearch();
    await fireEvent.press(await screen.findByTestId('documents-filters'));
    await waitFor(() => expect(s.tagAsks.length).toBe(first + 1));
    await waitFor(() => expect(chips()).toEqual(['school', 'passport']));
    // Closed and opened again: the newest first.
    await fireEvent.press(screen.getByTestId('filters-close'));
    await fireEvent.press(await screen.findByTestId('documents-filters'));
    await waitFor(() => expect(chips()).toEqual(['passport', 'school']));
  });

  it('an older vault: most used first, as before, and read again all the same', async () => {
    const s = vault('dev102', { tags: [tag('school')] });
    await unlocked(s.t, <DocumentsScreen />);
    const first = await settled(s);
    expect(new Set(s.tagAsks)).toEqual(new Set(['/api/v1/tags?limit=1000']));
    await openSearch();
    await fireEvent.press(await screen.findByTestId('documents-filters'));
    await waitFor(() => expect(s.tagAsks.length).toBe(first + 1));
  });
});

describe('the keyboard never hides what is typed (app-wide)', () => {
  it('Edit details keeps the field above Cancel and Save, not only above the keyboard', async () => {
    const s = vault('dev103');
    libraryDoc(s.t, { id: 'passport', title: 'Passport' });
    await unlocked(s.t, <DocumentDetail id="passport" />);
    await openEdit('passport');
    const page = await screen.findByTestId('edit');
    const bar = screen.getByTestId('edit-bar');
    expect(page.props.bottomOffset).toBe(KEYBOARD_GAP);
    await fireEvent(bar, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 80 } } });
    await waitFor(() => expect(screen.getByTestId('edit').props.bottomOffset).toBe(KEYBOARD_GAP + 80));
  });

  /** Every file of the app's own, with its text. */
  function sources(dir: string): { file: string; text: string }[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return name === 'screens-test' || name === 'test-support' ? [] : sources(path);
      return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [{ file: path, text: readFileSync(path, 'utf8') }] : [];
    });
  }

  it("no screen leans on React Native's own KeyboardAvoidingView, which does nothing edge to edge on Android", () => {
    const src = join(__dirname, '..');
    const leaning = sources(src)
      .filter(({ text }) => /import\s*\{[^}]*\bKeyboardAvoidingView\b[^}]*\}\s*from\s*'react-native'/.test(text))
      .map(({ file }) => file);
    expect(leaning).toEqual([]);
  });

  it('every page that scrolls a field is one that follows the keyboard', () => {
    const src = join(__dirname, '..');
    // A field in a page's own ScrollView (not a sheet's, which rises with the keyboard; not a list's
    // header, at the top): such a page scrolls with FormScroll.
    const pages = [
      'app/connect.tsx',
      'app/sign-in.tsx',
      'app/account.tsx',
      'app/settings.tsx',
      'app/capture.tsx',
      'sharing/ask.tsx',
      'update/gate.tsx',
      'ui/editor-frame.tsx',
    ];
    for (const page of pages) expect([page, readFileSync(join(src, page), 'utf8').includes('<FormScroll')]).toEqual([page, true]);
    const sheet = readFileSync(join(src, 'ui/sheet.tsx'), 'utf8');
    expect(sheet).toContain('<RisesWithKeyboard');
    expect(readFileSync(join(src, 'ui/side-sheet.tsx'), 'utf8')).toContain('<RisesWithKeyboard');
  });

  it('a sheet or a side panel with a field scrolls it with SheetScroll, never a plain ScrollView', () => {
    const src = join(__dirname, '..');
    // Every file that puts a Field (or a component of fields) in a scroll inside a Sheet or a SideSheet.
    const sheets = [
      'sharing/share-sheet.tsx',
      'sharing/change-link.tsx',
      'sharing/requests.tsx',
      'collections/collection-form.tsx',
      'emergency/clinician.tsx',
      'app/sharing.tsx',
      'documents/filter-panel.tsx',
      'activity/screen.tsx',
    ];
    for (const file of sheets) {
      const text = readFileSync(join(src, file), 'utf8');
      expect([file, text.includes('<SheetScroll')]).toEqual([file, true]);
    }
    // No sheet's own scroll is a plain one where it holds the email field or the panel's dates.
    for (const file of ['sharing/share-sheet.tsx', 'sharing/change-link.tsx', 'collections/collection-form.tsx', 'emergency/clinician.tsx', 'sharing/requests.tsx', 'documents/filter-panel.tsx']) {
      expect([file, /<ScrollView[\s>]/.test(readFileSync(join(src, file), 'utf8'))]).toEqual([file, false]);
    }
  });
});
