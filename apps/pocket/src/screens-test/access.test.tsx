import type { FetchLike } from '@fdv/client';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import Home from '../app/(tabs)/index';
import Settings from '../app/settings';
import SignIn from '../app/sign-in';
import { MemoryEssentialsStore } from '../essentials/store';
import { MemoryQueueStore } from '../queue/store';
import { LockGate } from '../lock/gate';
import { useLock } from '../state/lock';
import { useVault } from '../state/vault';
import { audit } from '../test-support/a11y';
import { addGuest, endGuest, grant, GUEST, signedInAs } from '../test-support/guest';
import { phoneParts } from '../test-support/lookup';
import { FakePushNative } from '../test-support/push';
import { installed, knownVault, renderApp, respond, signedIn, testCapture } from '../test-support/render';
import { resetRoutes } from '../test-support/router';
import { capabilities, caps0519, testVault, type TestVault } from '../test-support/vault';

jest.mock(
  'expo-router',
  () => jest.requireActual<typeof import('../test-support/router')>('../test-support/router').routerMock,
);
jest.mock('expo-linking', () => ({ openURL: jest.fn(async () => true) }));

const ORIGIN = 'https://vault.test';
const ENDED = "Your access to this family's vault has ended. Ask them to renew it if you still need it.";
const SIGNED_OUT = "You've been signed out on this phone. Sign in again to carry on.";
/** What the phone keeps for a person's capture card, by vault and member. */
const CARD_GUEST = `card|${ORIGIN}|${GUEST.id}`;
const CARD_OWNER = `card|${ORIGIN}|fake-member`;

beforeEach(() => {
  installed();
  resetRoutes();
});

/** A vault of 0.5.37: limits (0.5.33) and guests (0.5.34). */
function vault(): TestVault {
  const t = testVault([ORIGIN]);
  t.caps = capabilities({
    server_version: '0.5.37',
    features: { ...caps0519().features, access_restrictions: true, guests: true },
  });
  return t;
}

/** The household's clock, as GET /profile tells anybody signed in (a guest too); or no answer at all. */
function withProfile(t: TestVault, timezone: string | null) {
  const base = t.fetch;
  t.fetch = async (url, init) => {
    if (!url.endsWith('/api/v1/profile')) return base(url, init);
    if (timezone === null) return respond(500, { error: { code: 'internal_error', message: 'No.' } });
    return respond(200, { household_name: 'The Test family', timezone });
  };
}

/** The app's own gates, as _layout has them: Home once signed in and unlocked, else Sign in. */
function App(props: { start?: 'home' | 'settings' }) {
  const { phase, withToken, signOut } = useVault();
  const { status } = useLock();
  return (
    <LockGate>
      {/* Something asks the vault, as any screen does. */}
      <Text testID="poke" onPress={() => void withToken((a, token) => a.me(token)).catch(() => undefined)}>
        poke
      </Text>
      <Text testID="sign-out" onPress={() => void signOut()}>
        sign out
      </Text>
      {phase === 'sign_in' ? (
        <SignIn />
      ) : phase !== 'ready' || status === 'checking' ? null : props.start === 'settings' ? (
        <Settings />
      ) : (
        <Home />
      )}
    </LockGate>
  );
}

/** Signed in as the guest, the app unlocked, with something kept on the phone. */
async function guestApp(
  t: TestVault,
  opts: { start?: 'home' | 'settings'; fetch?: FetchLike; queue?: MemoryQueueStore } = {},
) {
  const parts = phoneParts();
  parts.stores.set('everyday', new MemoryEssentialsStore());
  await signedIn(t);
  await signedInAs(t, GUEST.email, GUEST.password);
  const queue = opts.queue;
  await renderApp(<App {...(opts.start ? { start: opts.start } : {})} />, {
    fetch: opts.fetch ?? t.fetch,
    lock: parts.lock,
    essentials: parts.essentials,
    ...(queue ? { capture: testCapture({ openStore: async () => queue }) } : {}),
  });
  await fireEvent.press(await screen.findByTestId('lock-unlock'));
  return parts;
}

describe('what you may see (5.36)', () => {
  it('the restriction summary shows when the vault has one: on Home, and in Settings', async () => {
    const t = vault();
    // A viewer of the family an owner limited to passports.
    t.vault.state.role = 'viewer';
    t.vault.state.restrictions.set('fake-member', grant({ types: ['passport'] }));
    const said = 'You can see: Passport documents and your own.';
    await signedIn(t);
    await renderApp(<App />, { fetch: t.fetch });
    expect(await screen.findByTestId('home-access-summary')).toHaveTextContent(said);
    // Somebody of the family is told no end.
    expect(screen.queryByTestId('home-access-ends')).toBeNull();
    expect(audit()).toEqual([]);
    await screen.unmount();
    await renderApp(<App start="settings" />, { fetch: t.fetch });
    expect(await screen.findByTestId('settings-access-summary')).toHaveTextContent(said);
    expect(screen.getByText('What you can see')).toBeTruthy();
  });

  it("a guest's Home shows their end, on the family's clock", async () => {
    const t = vault();
    addGuest(t, '2026-12-04T23:59:00Z');
    t.vault.state.timezone = 'Europe/London';
    withProfile(t, 'America/New_York');
    await guestApp(t);
    expect(await screen.findByTestId('home-access-summary')).toHaveTextContent(
      'You can see: documents for Fake Owner.',
    );
    // 23:59 in London is 18:59 in New York: said on the family's clock, and named.
    expect(screen.getByTestId('home-access-ends')).toHaveTextContent(
      "Your access to this vault ends Friday 4 December 2026 at 18:59 (America/New_York, the family's clock).",
    );
    expect(audit()).toEqual([]);
  });

  it("a guest's Home says which clock when it cannot learn the family's: this phone's", async () => {
    const t = vault();
    addGuest(t, '2026-12-04T23:59:00Z');
    withProfile(t, null);
    await guestApp(t);
    expect(await screen.findByTestId('home-access-ends')).toHaveTextContent(
      "Your access to this vault ends Friday 4 December 2026 at 23:59 (UTC, this phone's clock).",
    );
  });

  it('access_ended gives its sentence when the vault ends the session, and the copies kept here go', async () => {
    const t = vault();
    addGuest(t, '2026-12-04T23:59:00Z');
    withProfile(t, 'UTC');
    const parts = await guestApp(t);
    await screen.findByTestId('home-access');
    // The day comes: every request of theirs is answered 401 session_ended, reason access_ended.
    endGuest(t);
    await fireEvent.press(screen.getByTestId('poke'));
    expect(await screen.findByTestId('sign-in-access-ended')).toHaveTextContent(ENDED);
    // Not the words for a session that simply went.
    expect(screen.queryByText(SIGNED_OUT)).toBeNull();
    // Gone, as for every end but an expiry.
    await waitFor(() => expect(parts.stores.size).toBe(0));
  });

  it('access_ended gives its sentence at sign-in too, once the password is right', async () => {
    const t = vault();
    addGuest(t, '2026-12-04T23:59:00Z');
    endGuest(t);
    knownVault();
    const parts = phoneParts();
    parts.stores.set('everyday', new MemoryEssentialsStore());
    await renderApp(<App />, { fetch: t.fetch, lock: parts.lock, essentials: parts.essentials });
    // A wrong password is still a wrong password.
    await fireEvent.changeText(await screen.findByTestId('sign-in-email'), GUEST.email);
    await fireEvent.changeText(screen.getByTestId('sign-in-password'), 'not it');
    await fireEvent.press(screen.getByTestId('sign-in-go'));
    expect(await screen.findByTestId('sign-in-refused')).toHaveTextContent(/don't match/);
    expect(screen.queryByTestId('sign-in-access-ended')).toBeNull();
    expect(parts.stores.size).toBe(1);
    // The right one: 403 access_ended, said in the phone's words, not the vault's.
    await fireEvent.changeText(screen.getByTestId('sign-in-password'), GUEST.password);
    await fireEvent.press(screen.getByTestId('sign-in-go'));
    expect(await screen.findByTestId('sign-in-access-ended')).toHaveTextContent(ENDED);
    expect(screen.queryByTestId('sign-in-refused')).toBeNull();
    await waitFor(() => expect(parts.stores.size).toBe(0));
    expect(audit()).toEqual([]);
  });

  it('a session_ended push for a guest whose access has ended says so once the vault answers why', async () => {
    const t = vault();
    addGuest(t, '2026-12-04T23:59:00Z');
    const fake = new FakePushNative();
    const parts = phoneParts();
    const seen: string[] = [];
    function Probe() {
      const { phase, notice } = useVault();
      seen.push(`${phase}|${notice ?? 'none'}`);
      return null;
    }
    await signedIn(t);
    await signedInAs(t, GUEST.email, GUEST.password);
    await renderApp(<Probe />, {
      fetch: t.fetch,
      lock: parts.lock,
      essentials: parts.essentials,
      push: { native: fake },
      deps: { push: fake },
    });
    await waitFor(() => expect(seen).toContain('ready|none'));
    endGuest(t);
    await act(async () => fake.emit({ kind: 'message', type: 'session_ended' }));
    await waitFor(() => expect(seen.at(-1)).toBe('sign_in|access_ended'));
  });

  it("a guest's phone fetches and keeps nothing of the family for the capture card", async () => {
    const t = vault();
    addGuest(t, '2026-12-04T23:59:00Z');
    withProfile(t, 'UTC');
    const queue = new MemoryQueueStore();
    await guestApp(t, { queue });
    await screen.findByTestId('home-access');
    await act(async () => undefined);
    // Neither the kinds nor the people were asked for, and nothing is kept.
    expect(t.calls.filter((c) => /\/api\/v1\/(document-types|members)(\?|$)/.test(c))).toEqual([]);
    expect(await queue.cached(CARD_GUEST)).toBeNull();
    expect(await queue.cached(`${CARD_GUEST}|kinds`)).toBeNull();
  });

  it("when a guest's access ends, what an older phone kept for their card goes, and only theirs", async () => {
    const t = vault();
    addGuest(t, '2026-12-04T23:59:00Z');
    withProfile(t, 'UTC');
    // As a phone before 0.2.3 kept it for a guest; and the owner's, who also signs in here.
    const queue = new MemoryQueueStore();
    await queue.cache(CARD_GUEST, {
      types: [],
      members: [{ id: 'fake-member', display_name: 'Fake Owner' }],
      filed: [],
    });
    await queue.cache(`${CARD_GUEST}|kinds`, { customTypes: true });
    await queue.cache(CARD_OWNER, { types: [], members: [], filed: [] });
    await guestApp(t, { queue });
    await screen.findByTestId('home-access');
    endGuest(t);
    await fireEvent.press(screen.getByTestId('poke'));
    await screen.findByTestId('sign-in-access-ended');
    await waitFor(async () => expect(await queue.cached(CARD_GUEST)).toBeNull());
    expect(await queue.cached(`${CARD_GUEST}|kinds`)).toBeNull();
    expect(await queue.cached(CARD_OWNER)).not.toBeNull();
  });

  it("a guest's sign-in refused for its end takes nothing kept for the one signed in before", async () => {
    const t = vault();
    addGuest(t, '2026-12-04T23:59:00Z');
    endGuest(t);
    const queue = new MemoryQueueStore();
    await signedIn(t);
    await renderApp(<App />, { fetch: t.fetch, capture: testCapture({ openStore: async () => queue }) });
    await waitFor(async () => expect(await queue.cached(CARD_OWNER)).not.toBeNull());
    // The owner signs out, keeping their card's choices; the guest tries the phone.
    await fireEvent.press(screen.getByTestId('sign-out'));
    await fireEvent.changeText(await screen.findByTestId('sign-in-email'), GUEST.email);
    await fireEvent.changeText(screen.getByTestId('sign-in-password'), GUEST.password);
    await fireEvent.press(screen.getByTestId('sign-in-go'));
    await screen.findByTestId('sign-in-access-ended');
    await act(async () => undefined);
    expect(await queue.cached(CARD_OWNER)).not.toBeNull();
  });

  it.each(['revoked', 'removed'])(
    "a session the vault ended as %s takes the card's kept choices with it; an expiry does not",
    async (reason) => {
      for (const why of [reason, 'expired']) {
        const t = vault();
        const queue = new MemoryQueueStore();
        await signedIn(t);
        await renderApp(<App />, { fetch: t.fetch, capture: testCapture({ openStore: async () => queue }) });
        // Somebody who files has the card's choices kept, for a scan made with no connection.
        await waitFor(async () => expect(await queue.cached(CARD_OWNER)).not.toBeNull());
        for (const x of t.vault.state.sessions) {
          x.revoked = true;
          x.endedBecause = why as never;
        }
        await fireEvent.press(screen.getByTestId('poke'));
        await screen.findByTestId('sign-in-email');
        await act(async () => undefined);
        if (why === 'expired') expect(await queue.cached(CARD_OWNER)).not.toBeNull();
        else await waitFor(async () => expect(await queue.cached(CARD_OWNER)).toBeNull());
        await screen.unmount();
      }
    },
  );

  it('nothing new appears on an older vault: a v0.5.32 /me says nothing of limits or an end', async () => {
    const t = testVault([ORIGIN]);
    // A vault of 0.5.32: collections, no limits, no guests.
    t.caps = capabilities({ server_version: '0.5.32', features: caps0519().features });
    t.vault.state.role = 'viewer';
    t.vault.state.restrictions.set('fake-member', grant({ types: ['passport'] }));
    // Its GET /me, as it was: no restriction, kind or end.
    const fetch: FetchLike = async (url, init) => {
      const res = await t.fetch(url, init);
      if (!url.endsWith('/api/v1/me') || !res.ok) return res;
      const { restriction: _r, kind: _k, access_expires_at: _a, ...me } = (await res.json()) as Record<string, unknown>;
      return respond(200, me);
    };
    await signedIn(t);
    await renderApp(<App />, { fetch });
    await screen.findByTestId('home-calm');
    await waitFor(() => expect(t.calls.some((c) => c.endsWith('/api/v1/me'))).toBe(true));
    expect(screen.queryByTestId('home-access')).toBeNull();
    expect(screen.queryByText(/You can see/)).toBeNull();
    await screen.unmount();
    await renderApp(<App start="settings" />, { fetch });
    await screen.findByTestId('settings-change-vault');
    await act(async () => undefined);
    expect(screen.queryByText('What you can see')).toBeNull();
  });
});
