import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import Settings from '../app/settings';
import { MemoryEssentialsStore } from '../essentials/store';
import { ownerKey } from '../essentials/wipe';
import { readPrefs, writePrefs } from '../platform/prefs';
import { useVault } from '../state/vault';
import { audit } from '../test-support/a11y';
import { phoneParts, unlocked } from '../test-support/lookup';
import { FakePushNative } from '../test-support/push';
import { installed, knownVault, renderApp, respond, signedIn } from '../test-support/render';
import { resetRoutes } from '../test-support/router';
import { capabilities, testVault, VAPID } from '../test-support/vault';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-router', () => require('../test-support/router').routerMock);

/** A vault of 0.4.14 with push set up, or not, or a vault from before 0.4.14. */
function pushVault(push: 'on' | 'off' | 'before' = 'on') {
  const t = testVault();
  const caps = capabilities();
  const features = { ...caps.features, push: push === 'on' };
  t.caps = {
    ...caps,
    server_version: push === 'before' ? '0.4.13' : '0.4.14',
    features: push === 'before' ? features : { ...features, unified_push: push === 'on' },
  };
  return t;
}

const PHONE = 'https://ntfy.example.test/upPhone0001';

/** Settings on an Android phone with a distributor, signed in and unlocked. */
async function settingsOn(t: ReturnType<typeof testVault>, fake: FakePushNative) {
  return unlocked(t, <Settings />, {
    push: { native: fake, askPermission: async () => true },
    deps: { push: fake },
  });
}

async function turnedOn(t: ReturnType<typeof testVault>, fake: FakePushNative) {
  await settingsOn(t, fake);
  await fireEvent.press(await screen.findByTestId('push-turn-on'));
  await screen.findByText('On, through ntfy.');
}

describe('notifications on this phone (4.14)', () => {
  beforeEach(() => {
    installed();
    resetRoutes();
  });

  it("registers with the vault's VAPID key and posts kind unified_push", async () => {
    const t = pushVault();
    const fake = new FakePushNative();
    await settingsOn(t, fake);
    expect(await screen.findByTestId('push-turn-on')).toBeTruthy();
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByTestId('push-turn-on'));
    await screen.findByText('On, through ntfy.');
    expect(fake.saved).toBe('io.heckel.ntfy');
    expect(fake.registered).toEqual([VAPID]);
    expect(t.push.posted).toEqual([
      { kind: 'unified_push', endpoint: PHONE, keys: { p256dh: 'phone-p256dh', auth: 'phone-auth' } },
    ]);
    // The daily push as the vault keeps it, and a test to this phone.
    await waitFor(() => expect(screen.getByTestId('push-daily').props.value).toBe(true));
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByTestId('push-test'));
    await screen.findByText('Sent. It should arrive in a moment.');
    expect(t.push.tests).toEqual([t.push.devices[0]?.id]);
    await fireEvent(screen.getByTestId('push-daily'), 'valueChange', false);
    await waitFor(() => expect(t.push.prefs.daily_push).toBe(false));
  });

  it('asks which distributor when there are several', async () => {
    const t = pushVault();
    const fake = new FakePushNative();
    fake.installed = [
      { id: 'io.heckel.ntfy', name: 'ntfy' },
      { id: 'org.unifiedpush.distributor.nextpush', name: 'NextPush' },
    ];
    await settingsOn(t, fake);
    await fireEvent.press(await screen.findByTestId('push-turn-on'));
    await fireEvent.press(await screen.findByTestId('push-distributor-org.unifiedpush.distributor.nextpush'));
    await screen.findByText('On, through NextPush.');
    expect(fake.saved).toBe('org.unifiedpush.distributor.nextpush');
  });

  it('a new endpoint re-registers', async () => {
    const t = pushVault();
    const fake = new FakePushNative();
    await turnedOn(t, fake);
    await act(async () => fake.newEndpoint('https://ntfy.example.test/upPhone0002'));
    await waitFor(() =>
      expect(t.push.posted.map((p) => p.endpoint)).toEqual([PHONE, 'https://ntfy.example.test/upPhone0002']),
    );
    await screen.findByText('On, through ntfy.');
    // The same address again tells the vault nothing new.
    await act(async () => fake.newEndpoint('https://ntfy.example.test/upPhone0002'));
    expect(t.push.posted).toHaveLength(2);
  });

  it('sign-out unregisters before the session ends', async () => {
    const t = pushVault();
    const fake = new FakePushNative();
    await turnedOn(t, fake);
    // A tap not yet followed is not followed for whoever signs in next.
    fake.open = 'needs-attention';
    await fireEvent.press(screen.getByTestId('settings-sign-out'));
    await waitFor(() => expect(t.calls).toContain('POST https://vault.test/api/v1/auth/logout'));
    expect(fake.open).toBeNull();
    const removed = t.calls.indexOf('DELETE https://vault.test/api/v1/devices');
    expect(removed).toBeGreaterThan(-1);
    expect(removed).toBeLessThan(t.calls.indexOf('POST https://vault.test/api/v1/auth/logout'));
    expect(fake.unregistered).toBe(1);
    expect(t.push.devices).toEqual([]);
  });

  it('turning them off removes the device and unregisters', async () => {
    const t = pushVault();
    const fake = new FakePushNative();
    await turnedOn(t, fake);
    await fireEvent.press(screen.getByTestId('push-turn-off'));
    await screen.findByTestId('push-turn-on');
    expect(t.push.devices).toEqual([]);
    expect(fake.unregistered).toBe(1);
  });

  it('no distributor shows the install card', async () => {
    const t = pushVault();
    const fake = new FakePushNative();
    fake.installed = [];
    await settingsOn(t, fake);
    expect(await screen.findByTestId('push-install')).toHaveTextContent(
      'To get reminders on this phone, install a free notification app such as ntfy, then come back. The daily email still works either way.',
    );
    expect(screen.queryByTestId('push-turn-on')).toBeNull();
    expect(audit()).toEqual([]);
  });

  it('notifications not allowed says where to turn them on', async () => {
    const t = pushVault();
    const fake = new FakePushNative();
    // Refused when Android asked: the app may not notify.
    const refuse = async () => {
      fake.s = { ...fake.s, allowed: false };
      return false;
    };
    await unlocked(t, <Settings />, { push: { native: fake, askPermission: refuse }, deps: { push: fake } });
    await fireEvent.press(await screen.findByTestId('push-turn-on'));
    expect(await screen.findByTestId('push-permission-off')).toHaveTextContent(
      "Notifications are off for this app. You can turn them on in your phone's settings.",
    );
    expect(fake.registered).toEqual([]);
  });

  it('features.unified_push false hides the section', async () => {
    const t = pushVault('off');
    const fake = new FakePushNative();
    await settingsOn(t, fake);
    await waitFor(() => expect(screen.getByTestId('settings-version')).toHaveTextContent(/Vault 0\.4\.14/));
    expect(screen.queryByTestId('push-title')).toBeNull();
  });

  it('a vault from before 0.4.14 says updating it will fix that', async () => {
    const t = pushVault('before');
    const fake = new FakePushNative();
    await settingsOn(t, fake);
    expect(await screen.findByTestId('push-old-vault')).toHaveTextContent(
      "This vault can't send reminders to phones yet. Updating it will fix that.",
    );
  });

  it('an iPhone says reminders come by email', async () => {
    const t = pushVault();
    await unlocked(t, <Settings />, { push: { native: null } });
    expect(await screen.findByTestId('push-iphone')).toHaveTextContent('On iPhone, reminders come by email.');
  });

  it('a session the vault ends unregisters, so the next session gets its own address and keys', async () => {
    const t = pushVault();
    const fake = new FakePushNative();
    await turnedOn(t, fake);
    fake.open = 'needs-attention';
    await act(async () => fake.emit({ kind: 'message', type: 'session_ended' }));
    await waitFor(() => expect(fake.unregistered).toBe(1));
    // The connector forgets the distributor with its last registration; a tap not followed is dropped.
    expect(fake.saved).toBeNull();
    expect(fake.open).toBeNull();
  });

  it('the same person signing in again gets notifications back without asking', async () => {
    const t = pushVault();
    const fake = new FakePushNative();
    // Turned on before; this session has no registration, and no distributor is saved.
    writePrefs('push', { wantedBy: ownerKey('https://vault.test', 'fake-member'), registered: null });
    await settingsOn(t, fake);
    await screen.findByText('On, through ntfy.');
    expect(fake.saved).toBe('io.heckel.ntfy');
    expect(fake.registered).toEqual([VAPID]);
    expect(t.push.posted.map((p) => p.endpoint)).toEqual([PHONE]);
  });

  it("somebody else signing in does not get the last person's notifications", async () => {
    const t = pushVault();
    const fake = new FakePushNative();
    writePrefs('push', { wantedBy: ownerKey('https://vault.test', 'someone-else'), registered: null });
    await settingsOn(t, fake);
    expect(await screen.findByTestId('push-turn-on')).toBeTruthy();
    expect(fake.registered).toEqual([]);
    expect(readPrefs('push', null)).toEqual({ wantedBy: null, registered: null });
  });

  it('the vault refusing the device says so, and they can be turned off', async () => {
    const t = pushVault();
    const fake = new FakePushNative();
    const fetch = t.fetch;
    t.fetch = async (url, init) =>
      url.endsWith('/api/v1/devices') && init.method === 'POST'
        ? respond(422, { error: { code: 'validation_failed', message: 'Push addresses must start with https://.' } })
        : fetch(url, init);
    await settingsOn(t, fake);
    await fireEvent.press(await screen.findByTestId('push-turn-on'));
    expect(await screen.findByTestId('push-failed')).toHaveTextContent(
      "Notifications couldn't be set up: Push addresses must start with https://.",
    );
    await fireEvent.press(screen.getByTestId('push-turn-off'));
    await screen.findByTestId('push-turn-on');
    expect(fake.unregistered).toBe(1);
  });

  it('a session_ended with nobody signed in still removes the copies', async () => {
    const t = pushVault();
    const fake = new FakePushNative();
    fake.ended = true;
    const parts = phoneParts();
    parts.stores.set('everyday', new MemoryEssentialsStore());
    knownVault();
    await renderApp(<></>, {
      fetch: t.fetch,
      lock: parts.lock,
      essentials: parts.essentials,
      push: { native: fake },
      deps: { push: fake },
    });
    await waitFor(() => expect(parts.stores.size).toBe(0));
    await waitFor(() => expect(fake.ended).toBe(false));
  });

  it('the session_ended flag wipes before the first screen', async () => {
    const t = pushVault();
    const fake = new FakePushNative();
    fake.ended = true;
    const parts = phoneParts();
    parts.stores.set('everyday', new MemoryEssentialsStore());
    const seen: string[] = [];
    let said: string | null = null;
    function Probe() {
      const { phase, notice } = useVault();
      seen.push(phase);
      said = notice;
      return null;
    }
    await signedIn(t);
    await renderApp(<Probe />, {
      fetch: t.fetch,
      lock: parts.lock,
      essentials: parts.essentials,
      push: { native: fake },
      deps: { push: fake },
    });
    await waitFor(() => expect(seen).toContain('sign_in'));
    expect(seen).not.toContain('ready');
    expect(said).toBe('signed_out_here');
    expect(fake.ended).toBe(false);
    await waitFor(() => expect(parts.stores.size).toBe(0));
  });

  it('a session_ended for a lock says access is paused: the vault is asked why, once', async () => {
    const t = pushVault();
    const fake = new FakePushNative();
    const parts = phoneParts();
    parts.stores.set('everyday', new MemoryEssentialsStore());
    const seen: string[] = [];
    function Probe() {
      const { phase, notice } = useVault();
      seen.push(`${phase}|${notice ?? 'none'}`);
      return null;
    }
    await signedIn(t);
    await renderApp(<Probe />, {
      fetch: t.fetch,
      lock: parts.lock,
      essentials: parts.essentials,
      push: { native: fake },
      deps: { push: fake },
    });
    await waitFor(() => expect(seen).toContain('ready|none'));
    // An owner locks the sign-in: the vault ends the session (suspended) and pushes a word with no reason.
    t.vault.state.suspensions.set('fake-member', {
      reason: 'locked',
      since: new Date(Date.now() - 60_000).toISOString(),
      until: null,
      note: null,
      by: 'Mansoor',
    });
    await act(async () => fake.emit({ kind: 'message', type: 'session_ended' }));
    await waitFor(() => expect(seen.at(-1)).toBe('sign_in|paused'));
    await waitFor(() => expect(parts.stores.size).toBe(0));
  });

  it('a session_ended with the app open signs out at once', async () => {
    const t = pushVault();
    const fake = new FakePushNative();
    const parts = phoneParts();
    await unlocked(t, <Settings />, {
      parts,
      push: { native: fake, askPermission: async () => true },
      deps: { push: fake },
    });
    await screen.findByTestId('settings-sign-out');
    parts.stores.set('everyday', new MemoryEssentialsStore());
    await act(async () => fake.emit({ kind: 'message', type: 'session_ended' }));
    await waitFor(() => expect(screen.queryByTestId('settings-sign-out')).toBeNull());
    await waitFor(() => expect(parts.stores.size).toBe(0));
    // Nothing more to say to the vault: it ended the session itself.
    expect(t.calls.filter((c) => c.endsWith('/auth/logout'))).toEqual([]);
  });
});
