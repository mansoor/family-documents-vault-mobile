import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import People from '../app/people';
import { DocumentDetail } from '../documents/detail';
import { setSink } from '../log';
import { dayWords, exactWords } from '../state/family-time';
import { reply } from '../test-support/capture';
import Home from '../test-support/home';
import { libraryDoc, unlocked } from '../test-support/lookup';
import { installed, renderApp, signedIn } from '../test-support/render';
import { resetRoutes } from '../test-support/router';
import { testVault, type TestVault } from '../test-support/vault';

jest.mock(
  'expo-router',
  () => jest.requireActual<typeof import('../test-support/router')>('../test-support/router').routerMock,
);

const ORIGIN = 'https://vault.test';
/** 9 Nov 2026, 02:00 UTC: still the 8th, 6pm, in California. */
const LATE = '2026-11-09T02:00:00Z';

beforeEach(() => {
  installed();
  resetRoutes();
});

/** The test vault, with what the test says each matching GET answers instead. */
type Fetch = TestVault['fetch'];

function answering(
  t: TestVault,
  rules: { match: RegExp; answer: (url: string, init: Parameters<Fetch>[1]) => Promise<unknown> | unknown }[],
) {
  const fetch: TestVault['fetch'] = async (url, init) => {
    const rule = init.method === 'GET' ? rules.find((r) => r.match.test(url)) : undefined;
    if (rule) return (await rule.answer(url, init)) as Awaited<ReturnType<Fetch>>;
    return t.fetch(url, init);
  };
  return fetch;
}

const boom = () =>
  reply(500, { error: { code: 'internal_error', message: 'Something broke.', retriable: false } });

describe("the family's clock (P5)", () => {
  it('a time says which clock it is on where the phone reads otherwise; a day names none', () => {
    // The tests' phone keeps UTC.
    expect(exactWords(LATE, 'America/Los_Angeles')).toMatch(/8 Nov 2026.*6:00\s?pm PST$/i);
    expect(exactWords(LATE, 'UTC')).not.toMatch(/PST|UTC$/);
    expect(dayWords(LATE, 'America/Los_Angeles')).toBe('8 Nov 2026');
    expect(dayWords(LATE, 'UTC')).toBe('9 Nov 2026');
  });

  it("a document's history says when, on the family's clock, from the vault's profile", async () => {
    const t = testVault([ORIGIN]);
    t.vault.state.timezone = 'America/Los_Angeles';
    libraryDoc(t, { id: 'bill', title: 'Council tax bill' }, { uploaded_at: LATE, uploaded_by_name: 'Sam' });
    await unlocked(t, <DocumentDetail id="bill" />);
    await waitFor(() => expect(screen.getByTestId('version-1')).toHaveTextContent(/8 Nov 2026.*PST by Sam/));
  });
});

describe('loading, and a failure that is not the connection (P5)', () => {
  it('while Home loads, rows the shape of what is coming, said as loading', async () => {
    const t = testVault([ORIGIN]);
    await signedIn(t);
    const fetch = answering(t, [{ match: /\/api\/v1\/documents\?/, answer: () => new Promise(() => undefined) }]);
    await renderApp(<Home />, { fetch });
    const loading = await screen.findByTestId('loading');
    expect(loading.props.accessibilityRole).toBe('progressbar');
    expect(loading.props.accessibilityLabel).toBe('Loading');
  });

  it('Home says so with Try again, tells the log what kind, and loads on Try again', async () => {
    const t = testVault([ORIGIN]);
    await signedIn(t);
    const lines: { event: string; fields: Record<string, unknown> }[] = [];
    setSink((_level, event, fields) => lines.push({ event, fields }));
    let broken = true;
    const fetch = answering(t, [
      { match: /\/api\/v1\/documents\?/, answer: (url, init) => (broken ? boom() : t.fetch(url, init)) },
    ]);
    await renderApp(<Home />, { fetch });
    expect(await screen.findByTestId('load-failed')).toHaveTextContent(/^Something went wrong on your vault/);
    expect(screen.queryByTestId('loading')).toBeNull();
    expect(lines).toContainEqual({ event: 'home.load_failed', fields: { kind: 'internal_error' } });
    broken = false;
    await fireEvent.press(screen.getByTestId('load-failed-retry'));
    await waitFor(() => expect(screen.queryByTestId('load-failed')).toBeNull());
  });

  it('People says so too; no connection is the offline notice, not a failure', async () => {
    const t = testVault([ORIGIN]);
    await signedIn(t);
    const fetch = answering(t, [{ match: /\/api\/v1\/members/, answer: boom }]);
    const first = await renderApp(<People />, { fetch });
    expect(await screen.findByTestId('load-failed')).toBeTruthy();
    first.unmount();

    const offline = answering(t, [
      {
        match: /\/api\/v1\/members/,
        answer: () => {
          throw new TypeError('Network request failed');
        },
      },
    ]);
    await renderApp(<People />, { fetch: offline });
    await screen.findByTestId('people');
    await waitFor(() => expect(screen.queryByTestId('loading')).toBeNull());
    expect(screen.queryByTestId('load-failed')).toBeNull();
  });
});
