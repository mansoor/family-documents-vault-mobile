import type { SearchHit } from '@fdv/shared';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import SearchScreen, { SEARCH_DEBOUNCE_MS } from '../app/(tabs)/search';
import { snippetParts } from '../documents/snippet';
import { audit } from '../test-support/a11y';
import { unlocked } from '../test-support/lookup';
import { installed } from '../test-support/render';
import { resetRoutes, routes } from '../test-support/router';
import { testVault } from '../test-support/vault';

jest.mock(
  'expo-router',
  () => jest.requireActual<typeof import('../test-support/router')>('../test-support/router').routerMock,
);

const ORIGIN = 'https://vault.test';

function hit(over: Partial<SearchHit> & { document_id: string }): SearchHit {
  return {
    title: 'Passport',
    type_key: 'passport',
    category: 'identity',
    owner_member_id: 'fake-member',
    status: { value: 'valid', label: '' },
    snippet: '',
    matched_in: 'content',
    ...over,
  } as SearchHit;
}

beforeEach(() => {
  installed();
  resetRoutes();
});

describe('Search', () => {
  it('<em> becomes bold spans, never markup', async () => {
    expect(snippetParts('Number <em>123</em> and <b>not</b> markup')).toEqual([
      { text: 'Number ', bold: false },
      { text: '123', bold: true },
      { text: ' and <b>not</b> markup', bold: false },
    ]);
    const t = testVault([ORIGIN]);
    t.library.search = () => ({
      items: [hit({ document_id: 'passport', snippet: 'Passport number <em>123456</em> — <script>x</script>' })],
      sealed: 0,
    });
    await unlocked(t, <SearchScreen />);
    await fireEvent.changeText(await screen.findByTestId('search-field'), '123456');
    const snippet = await screen.findByTestId('snippet-passport');
    // The match is a bold run; the rest is text, whatever it looks like.
    const bold = snippet.queryAll(
      (n) => typeof n.props.children === 'string' && StyleSheet.flatten(n.props.style)?.fontWeight === '700',
    );
    expect(bold.map((n) => n.props.children)).toEqual(['123456']);
    expect(snippet).toHaveTextContent('Passport number 123456 — <script>x</script>');
    // A result opens its document.
    await fireEvent.press(screen.getByTestId('doc-row-passport'));
    expect(routes().at(-1)).toEqual({ pathname: '/document/[id]', params: { id: 'passport' } });
  });

  it('asks the vault once typing pauses, not at every letter', async () => {
    expect(SEARCH_DEBOUNCE_MS).toBe(250);
    const t = testVault([ORIGIN]);
    t.library.search = () => ({ items: [], sealed: 0 });
    await unlocked(t, <SearchScreen />);
    const field = await screen.findByTestId('search-field');
    for (const q of ['p', 'pa', 'pas', 'pass']) await fireEvent.changeText(field, q);
    expect(await screen.findByTestId('search-nothing')).toHaveTextContent(
      'Nothing matched. Try a name, a number, or a word from inside the document.',
    );
    expect(t.library.searches).toEqual(['pass']);
  });

  it('looks in the person’s own sealed documents too, in a second pass', async () => {
    const t = testVault([ORIGIN]);
    t.library.search = () => ({ items: [hit({ document_id: 'passport' })], sealed: 2 });
    t.library.sealed = [hit({ document_id: 'diary', title: 'Diary', snippet: 'the <em>pass</em> code' })];
    await unlocked(t, <SearchScreen />);
    await fireEvent.changeText(await screen.findByTestId('search-field'), 'pass');
    expect(await screen.findByTestId('doc-row-diary')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('search-count')).toHaveTextContent('2 documents'));
  });

  it('without a connection, says so — and where the kept Essentials are', async () => {
    const t = testVault([ORIGIN]);
    await unlocked(t, <SearchScreen />);
    t.reachable.delete(ORIGIN);
    await fireEvent.changeText(await screen.findByTestId('search-field'), 'passport');
    expect(await screen.findByTestId('search-offline')).toHaveTextContent(
      'Search needs a connection. Your Essentials are under On this phone.',
    );
  });

  it('can be used with a screen reader and a thumb', async () => {
    const t = testVault([ORIGIN]);
    t.library.search = () => ({ items: [hit({ document_id: 'passport', snippet: '<em>pass</em>port' })], sealed: 0 });
    await unlocked(t, <SearchScreen />);
    await fireEvent.changeText(await screen.findByTestId('search-field'), 'pass');
    await screen.findByTestId('doc-row-passport');
    await act(async () => undefined);
    expect(audit()).toEqual([]);
  });
});
