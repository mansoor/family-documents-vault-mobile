import type { IdentityFields } from '@fdv/shared';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { useState } from 'react';
import { AccessibilityInfo, Text } from 'react-native';
import PersonScreen from '../app/person/[id]';
import { MemoryEssentialsStore } from '../essentials/store';
import type { Tier } from '../essentials/open';
import { IdentityCard } from '../identity/card';
import { copyForAMinute, CLEAR_AFTER_MS, type ClipboardPort } from '../identity/clipboard';
import { setSink } from '../log';
import { writePrefs } from '../platform/prefs';
import { MemoryQueueStore } from '../queue/store';
import { reply } from '../test-support/capture';
import { libraryDoc, phoneParts, unlocked } from '../test-support/lookup';
import { installed, testCapture } from '../test-support/render';
import { back, push, resetRoutes, useTopRoute } from '../test-support/router';
import { Button } from '../ui';
import { capabilities, caps0519, testVault, type TestVault } from '../test-support/vault';

jest.mock(
  'expo-router',
  () => jest.requireActual<typeof import('../test-support/router')>('../test-support/router').routerMock,
);

/** The phone's clipboard, as the native module keeps it: what is on it, and how it was put there. */
const mockBoard = { text: null as string | null, sensitive: false, clearAfterMs: 0 };
jest.mock('../identity/clipboard', () => {
  const actual = jest.requireActual<typeof import('../identity/clipboard')>('../identity/clipboard');
  const port = {
    copySensitive: (text: string, clearAfterMs: number) => {
      mockBoard.text = text;
      mockBoard.sensitive = true;
      mockBoard.clearAfterMs = clearAfterMs;
      return true;
    },
    clearIfOurs: () => {
      mockBoard.text = null;
      return true;
    },
  };
  return { ...actual, nativeClipboard: () => port };
});

const ORIGIN = 'https://vault.test';
const NUMBER = 'PX9988776';
const NAME = 'Quillon';
const LOCKER = '4321-LOCK';
const SARA_NUMBER = 'SA1112223';
const SARA_PRIVATE = 'Sara keeps this to herself';
const AT = '2026-10-01T09:00:00Z';

/** A vault of 0.5.32 with identity details: the owner's own, and Sara's, an adult's. */
function withIdentity(t: TestVault, on = true) {
  t.caps = capabilities({
    server_version: '0.5.32',
    features: { ...capabilities().features, member_identity: on },
  });
  t.vault.state.members = [
    { id: 'fake-member', display_name: 'Fake Owner', role: 'owner', is_me: true },
    { id: 'member-sara', display_name: 'Sara', role: 'adult', is_me: false },
  ];
  const mine: IdentityFields = {
    given_name: NAME,
    family_name: 'Quixotic',
    ids: [{ id: 'p1', kind: 'passport', number: NUMBER, issuer: 'United Kingdom', expires_on: '2031-03-14' }],
  };
  t.vault.state.identities.set('fake-member', {
    shared: { fields: mine, version: 1, updated_at: AT },
    only_me: {
      fields: { custom: [{ id: 'c1', label: 'Locker code', value: LOCKER, hidden: true }] },
      version: 1,
      updated_at: AT,
    },
  });
  t.vault.state.identities.set('member-sara', {
    shared: { fields: { given_name: 'Sara', ids: [{ id: 's1', kind: 'passport', number: SARA_NUMBER }] }, version: 1, updated_at: AT },
    only_me: { fields: { notes: SARA_PRIVATE }, version: 1, updated_at: AT },
  });
}

/** Somebody's screen, from People. */
async function openPerson(t: TestVault, id: string, name: string, opts: Parameters<typeof unlocked>[2] = {}) {
  push({ pathname: '/person/[id]', params: { id, name } });
  return unlocked(t, <PersonScreen />, opts);
}

/** Every value a store or a log line could hold, written out: Maps and bytes included. */
function dump(x: unknown): string {
  return JSON.stringify(x, (_k, v: unknown) =>
    v instanceof Map
      ? [...v.entries()]
      : v instanceof Set
        ? [...v]
        : v instanceof Uint8Array
          ? Buffer.from(v).toString('latin1')
          : v,
  );
}

beforeEach(() => {
  installed();
  resetRoutes();
  mockBoard.text = null;
  mockBoard.sensitive = false;
  mockBoard.clearAfterMs = 0;
});

describe('the Identity card (5.31)', () => {
  it('masked until shown; Show asks for the password for your own numbers', async () => {
    const t = testVault([ORIGIN]);
    withIdentity(t);
    await openPerson(t, 'fake-member', 'Fake Owner');
    const card = await screen.findByTestId('identity-card');
    // What is not a number is shown; the number is not, nor anywhere on the screen.
    expect(within(card).getByText(NAME)).toBeTruthy();
    expect(within(card).getByText('Passport')).toBeTruthy();
    expect(within(card).getByText('Issued by United Kingdom')).toBeTruthy();
    expect(screen.getByTestId('identity-masked-ids.p1')).toHaveTextContent('••••••••');
    expect(screen.queryByText(NUMBER)).toBeNull();
    // Your own: any credential, so the password is offered.
    await fireEvent.press(screen.getByTestId('identity-show-ids.p1'));
    await screen.findByTestId('step-up-sheet');
    expect(screen.getByTestId('step-up-password')).toBeTruthy();
    expect(screen.queryByTestId('step-up-code-only')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('step-up-password'), 'correct horse battery staple');
    await fireEvent.press(screen.getByTestId('step-up-go'));
    expect(await screen.findByTestId('identity-value-ids.p1')).toHaveTextContent(NUMBER);
    // Hide puts the dots back.
    await fireEvent.press(screen.getByTestId('identity-show-ids.p1'));
    expect(screen.queryByText(NUMBER)).toBeNull();
    // Read only: changed in the browser.
    expect(screen.getByText('To add or change these details, use your vault in the browser.')).toBeTruthy();
  });

  it('reveal asks for the right step-up: another person’s numbers take a code, never the password', async () => {
    const t = testVault([ORIGIN]);
    withIdentity(t);
    t.vault.state.ownerTwoStep = true;
    t.factors.totp = true;
    await openPerson(t, 'member-sara', 'Sara');
    await screen.findByTestId('identity-card');
    await fireEvent.press(screen.getByTestId('identity-show-ids.s1'));
    await screen.findByTestId('step-up-sheet');
    // The vault takes no password for this (open_identity): none is offered, nor a way to one.
    expect(screen.getByTestId('step-up-code-only')).toBeTruthy();
    expect(screen.queryByTestId('step-up-password')).toBeNull();
    expect(screen.queryByTestId('step-up-switch')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('step-up-code'), '123 456');
    await fireEvent.press(screen.getByTestId('step-up-go'));
    expect(await screen.findByTestId('identity-value-ids.s1')).toHaveTextContent(SARA_NUMBER);
    expect(t.library.stepUps).toEqual(['123456']);
  });

  it('without two-step sign-in, another person’s numbers are refused in the vault’s words, said aloud, and nothing is asked', async () => {
    const t = testVault([ORIGIN]);
    withIdentity(t);
    await openPerson(t, 'member-sara', 'Sara');
    await screen.findByTestId('identity-card');
    const heard = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    await fireEvent.press(screen.getByTestId('identity-show-ids.s1'));
    const said = await screen.findByTestId('identity-two-step');
    expect(said).toHaveTextContent(/Turn on two-step sign-in to see another person's identity numbers\./);
    expect(said).toHaveTextContent(/in the browser, in Settings/);
    // A TalkBack user hears it: no sheet opens, so the button would otherwise seem dead.
    expect(heard.mock.calls.map(([words]) => words)).toContainEqual(
      expect.stringMatching(/^Turn on two-step sign-in to see another person's identity numbers\. You can turn it on/),
    );
    heard.mockRestore();
    expect(screen.queryByTestId('step-up-sheet')).toBeNull();
    expect(screen.queryByText(SARA_NUMBER)).toBeNull();
  });

  it('another person’s Only me fields are absent, even if an answer carried them; your own are marked Only me', async () => {
    const t = testVault([ORIGIN]);
    withIdentity(t);
    // A vault that wrongly sent Sara's Only me part: the phone still shows nobody else's.
    const fetch: TestVault['fetch'] = async (url, init) => {
      const res = await t.fetch(url, init);
      if (!url.endsWith('/api/v1/members/member-sara/identity') || init.method !== 'GET') return res;
      const view = (await res.json()) as Record<string, unknown>;
      const part = { fields: { notes: SARA_PRIVATE }, masked: [], filled: ['notes'], version: 1, updated_at: AT };
      return reply(200, { ...view, only_me: part, versions: { shared: 1, only_me: 1 } });
    };
    await openPerson({ ...t, fetch }, 'member-sara', 'Sara');
    const card = await screen.findByTestId('identity-card');
    expect(within(card).getByText('Sara')).toBeTruthy();
    expect(screen.queryByText(SARA_PRIVATE)).toBeNull();
    expect(within(card).queryByText('Only me')).toBeNull();
    expect(within(card).getByText('Seen by the owners.')).toBeTruthy();
  });

  it('a passkey and no authenticator app: told plainly where it can be done, not asked for a code it cannot give', async () => {
    const t = testVault([ORIGIN]);
    withIdentity(t);
    // The vault lets a passkey through to its step-up, and the phone has no passkeys.
    t.vault.state.ownerTwoStep = true;
    t.factors = { totp: false, passkey: true };
    await openPerson(t, 'member-sara', 'Sara');
    await screen.findByTestId('identity-card');
    await fireEvent.press(screen.getByTestId('identity-show-ids.s1'));
    await screen.findByTestId('step-up-sheet');
    expect(screen.getByTestId('step-up-no-code')).toHaveTextContent(
      "This needs a code from an authenticator app, and this phone can't use your passkey. Add an authenticator app in Settings in the browser, or do this in the browser with your passkey.",
    );
    expect(screen.queryByTestId('step-up-code')).toBeNull();
    expect(screen.queryByTestId('step-up-password')).toBeNull();
    expect(screen.queryByTestId('step-up-go')).toBeNull();
    await fireEvent.press(screen.getByTestId('step-up-cancel'));
    await waitFor(() => expect(screen.queryByTestId('step-up-sheet')).toBeNull());
    expect(screen.queryByText(SARA_NUMBER)).toBeNull();
    expect(t.library.stepUps).toEqual([]);
  });

  it('two IDs of the same kind are told apart: by who issued them, or else a number', async () => {
    const t = testVault([ORIGIN]);
    withIdentity(t);
    const twice: IdentityFields = {
      ids: [
        { id: 'p1', kind: 'passport', number: NUMBER, issuer: 'United Kingdom' },
        { id: 'p2', kind: 'passport', number: 'IE5554443', issuer: 'Ireland' },
        { id: 'd1', kind: 'driving_licence', number: 'DL1' },
        { id: 'd2', kind: 'driving_licence', number: 'DL2' },
      ],
    };
    t.vault.state.identities.set('fake-member', { shared: { fields: twice, version: 1, updated_at: AT } });
    await openPerson(t, 'fake-member', 'Fake Owner');
    await screen.findByTestId('identity-card');
    expect(screen.getByLabelText('Show passport number, issued by United Kingdom')).toBeTruthy();
    expect(screen.getByLabelText('Show passport number, issued by Ireland')).toBeTruthy();
    expect(screen.getByLabelText('Copy passport number, issued by Ireland')).toBeTruthy();
    expect(screen.getByLabelText('Show driving licence number 1')).toBeTruthy();
    expect(screen.getByLabelText('Show driving licence number 2')).toBeTruthy();
    expect(screen.getByText('Passport, issued by Ireland')).toBeTruthy();
    // And the copied line says which one went.
    await fireEvent.press(screen.getByTestId('identity-copy-ids.p2'));
    await fireEvent.changeText(await screen.findByTestId('step-up-password'), 'correct horse battery staple');
    await fireEvent.press(screen.getByTestId('step-up-go'));
    expect(await screen.findByTestId('identity-said')).toHaveTextContent(
      'Passport number, issued by Ireland copied. This phone clears it from the clipboard in a minute.',
    );
    expect(mockBoard.text).toBe('IE5554443');
  });

  it('your own Only me fields are shown to you, marked', async () => {
    const t = testVault([ORIGIN]);
    withIdentity(t);
    await openPerson(t, 'fake-member', 'Fake Owner');
    await screen.findByTestId('identity-card');
    expect(screen.getByTestId('identity-only-me-custom.c1')).toHaveTextContent('Only me');
    expect(screen.getByTestId('identity-masked-custom.c1')).toBeTruthy();
    expect(screen.getByText('Seen by you and the owners. What you mark Only me is yours alone.')).toBeTruthy();
  });

  it('screenshots are blocked while the card shows and allowed after', async () => {
    const t = testVault([ORIGIN]);
    withIdentity(t);
    const parts = phoneParts();
    // As expo-screen-capture keeps it: a set of names, shielded while it is not empty.
    const shielded = new Set<string>();
    parts.lock.screen = {
      prevent: async (name) => void shielded.add(name),
      allow: async (name) => void shielded.delete(name),
    };
    // Screenshots allowed in Settings: only what is never captured stays shielded.
    writePrefs('lock', { timeout: '1m', screenshots: true });
    // People, then a person's screen over it. (The shield is held while the
    // card is mounted: in the app's stack also under a document opened from
    // it, which the safer side keeps shielded. This router keeps only the
    // top screen, so the test leaves by Back.)
    function People() {
      const top = useTopRoute();
      return top?.pathname === '/person/[id]' ? <PersonScreen /> : <Text>People</Text>;
    }
    push({ pathname: '/person/[id]', params: { id: 'fake-member', name: 'Fake Owner' } });
    await unlocked(t, <People />, { parts });
    await screen.findByTestId('identity-card');
    await waitFor(() => expect([...shielded]).toEqual(['identity']));
    // Back, off the card: allowed again.
    await act(async () => back());
    await screen.findByText('People');
    await waitFor(() => expect([...shielded]).toEqual([]));
  });

  it('two cards at once: the one taken away never lifts the other’s shield', async () => {
    const t = testVault([ORIGIN]);
    withIdentity(t);
    const parts = phoneParts();
    const shielded = new Set<string>();
    parts.lock.screen = {
      prevent: async (name) => void shielded.add(name),
      allow: async (name) => void shielded.delete(name),
    };
    writePrefs('lock', { timeout: '1m', screenshots: true });
    // Two person screens on the stack (a double tap, say): each with its card.
    function Two() {
      const [both, setBoth] = useState(true);
      return (
        <>
          <IdentityCard memberId="fake-member" name="Fake Owner" />
          {both ? <IdentityCard memberId="member-sara" name="Sara" /> : null}
          <Button label="Back" testID="drop-top" onPress={() => setBoth(false)} />
        </>
      );
    }
    await unlocked(t, <Two />, { parts });
    await waitFor(() => expect(screen.getAllByTestId('identity-card')).toHaveLength(2));
    expect([...shielded]).toEqual(['identity']);
    await fireEvent.press(screen.getByTestId('drop-top'));
    await waitFor(() => expect(screen.getAllByTestId('identity-card')).toHaveLength(1));
    // The card still on the screen is still shielded.
    expect([...shielded]).toEqual(['identity']);
  });

  it('with a vault that keeps no identity details the card is not there, and nothing is asked', async () => {
    const t = testVault([ORIGIN]);
    withIdentity(t, false);
    // As a vault of 0.5.19 says it: no member_identity at all.
    t.caps = caps0519();
    await openPerson(t, 'fake-member', 'Fake Owner');
    await screen.findByTestId('person');
    await waitFor(() => expect(t.calls.some((c) => c.includes('/documents?'))).toBe(true));
    expect(screen.queryByTestId('identity-card')).toBeNull();
    expect(t.calls.filter((c) => c.includes('/identity'))).toEqual([]);
  });

  it('no identity with no connection: nothing is kept to show (A36)', async () => {
    const t = testVault([ORIGIN]);
    withIdentity(t);
    libraryDoc(t, { id: 'doc-1', title: 'Council tax' });
    await openPerson(t, 'fake-member', 'Fake Owner');
    await screen.findByTestId('identity-card');
    // Away (this router keeps only the top screen), and back with no
    // connection: the card says so and shows nothing of the record.
    push({ pathname: '/document/[id]', params: { id: 'doc-1' } });
    await screen.findAllByText('Council tax');
    expect(screen.queryByTestId('identity-card')).toBeNull();
    t.reachable.delete(ORIGIN);
    resetRoutes();
    push({ pathname: '/person/[id]', params: { id: 'fake-member', name: 'Fake Owner' } });
    expect(await screen.findByTestId('identity-unavailable')).toHaveTextContent(
      'Identity details need a connection. They are never kept on this phone.',
    );
    expect(screen.queryByText(NAME)).toBeNull();
    expect(screen.queryByTestId('identity-card')).toBeNull();
  });

  it('copy is sensitive and cleared after 60 s', async () => {
    const t = testVault([ORIGIN]);
    withIdentity(t);
    await openPerson(t, 'fake-member', 'Fake Owner');
    await screen.findByTestId('identity-card');
    const timers = jest.spyOn(globalThis, 'setTimeout');
    await fireEvent.press(screen.getByTestId('identity-copy-ids.p1'));
    await fireEvent.changeText(await screen.findByTestId('step-up-password'), 'correct horse battery staple');
    await fireEvent.press(screen.getByTestId('step-up-go'));
    expect(await screen.findByTestId('identity-said')).toHaveTextContent(
      'Passport number copied. This phone clears it from the clipboard in a minute.',
    );
    // On the clipboard marked sensitive, with the native clock set to a minute…
    expect(mockBoard).toEqual({ text: NUMBER, sensitive: true, clearAfterMs: 60_000 });
    // …and not on the screen: copying is not showing.
    expect(screen.queryByText(NUMBER)).toBeNull();
    // The app's own clock, a minute too: when it runs out the clipboard is empty.
    const at = timers.mock.calls.findIndex(([, ms]) => ms === CLEAR_AFTER_MS);
    expect(timers.mock.calls.filter(([, ms]) => ms === CLEAR_AFTER_MS)).toHaveLength(1);
    clearTimeout(timers.mock.results[at]?.value as ReturnType<typeof setTimeout>);
    (timers.mock.calls[at]?.[0] as () => void)();
    expect(mockBoard.text).toBeNull();
    timers.mockRestore();
  });

  it('a minute, on the app’s clock: not a moment before, and a second copy starts it again', () => {
    jest.useFakeTimers();
    try {
      const board: string[] = [];
      const port: ClipboardPort = {
        copySensitive: (text) => board.push(text) > 0,
        clearIfOurs: () => board.splice(0).length > 0,
      };
      expect(copyForAMinute(port, NUMBER)).toBe(true);
      jest.advanceTimersByTime(59_999);
      expect(board).toEqual([NUMBER]);
      jest.advanceTimersByTime(1);
      expect(board).toEqual([]);
      copyForAMinute(port, NUMBER);
      jest.advanceTimersByTime(30_000);
      copyForAMinute(port, SARA_NUMBER);
      jest.advanceTimersByTime(59_999);
      expect(board).toEqual([NUMBER, SARA_NUMBER]);
      jest.advanceTimersByTime(1);
      expect(board).toEqual([]);
      // A phone that would not copy it: said so, and no clock.
      const refusing: ClipboardPort = { copySensitive: () => false, clearIfOurs: () => false };
      expect(copyForAMinute(refusing, NUMBER)).toBe(false);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('identity values never reach a store or the log', async () => {
    const t = testVault([ORIGIN]);
    withIdentity(t);
    t.vault.state.ownerTwoStep = true;
    const lines: string[] = [];
    setSink((level, event, fields) => lines.push(`${level} ${event} ${dump(fields)}`));
    const consoled: string[] = [];
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
      jest.spyOn(console, level).mockImplementation((...args: unknown[]) => void consoled.push(dump(args))),
    );
    const stores = new Map<Tier, MemoryEssentialsStore>();
    const queue = new MemoryQueueStore();
    await openPerson(t, 'fake-member', 'Fake Owner', {
      parts: phoneParts(stores),
      capture: testCapture({ openStore: async () => queue }),
    });
    await screen.findByTestId('identity-card');
    const timers = jest.spyOn(globalThis, 'setTimeout');
    // Shown, and copied: every number this person may see.
    await fireEvent.press(screen.getByTestId('identity-show-ids.p1'));
    await fireEvent.changeText(await screen.findByTestId('step-up-password'), 'correct horse battery staple');
    await fireEvent.press(screen.getByTestId('step-up-go'));
    await screen.findByTestId('identity-value-ids.p1');
    await fireEvent.press(screen.getByTestId('identity-show-custom.c1'));
    expect(await screen.findByTestId('identity-value-custom.c1')).toHaveTextContent(LOCKER);
    await fireEvent.press(screen.getByTestId('identity-copy-custom.c1'));
    await screen.findByTestId('identity-said');
    spies.forEach((s) => s.mockRestore());
    // The minute's clock, stopped: nothing is left running after the test.
    timers.mock.calls.forEach(([, ms], i) => {
      if (ms === CLEAR_AFTER_MS) clearTimeout(timers.mock.results[i]?.value as ReturnType<typeof setTimeout>);
    });
    timers.mockRestore();

    const secureStore = (globalThis as unknown as { __secureStore: Map<string, string> }).__secureStore;
    const files = (globalThis as unknown as { __files: Map<string, string> }).__files;
    const kept = [dump(secureStore), dump(files), dump(queue), dump([...stores.values()]), ...lines, ...consoled].join('\n');
    // Something was written — the session, the prefs — and none of it is a detail.
    expect(secureStore.size + files.size).toBeGreaterThan(0);
    for (const value of [NUMBER, NAME, LOCKER, 'Quixotic', 'United Kingdom']) expect(kept).not.toContain(value);
  });
});
