import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import Home from '../app/(tabs)/index';
import { emit } from '../state/events';
import { unlocked } from '../test-support/lookup';
import { installed } from '../test-support/render';
import { resetRoutes, routes } from '../test-support/router';
import { capabilities, caps0519, testVault, type TestVault } from '../test-support/vault';

jest.mock(
  'expo-router',
  () => jest.requireActual<typeof import('../test-support/router')>('../test-support/router').routerMock,
);

const ORIGIN = 'https://vault.test';

beforeEach(() => {
  installed();
  resetRoutes();
});

/** A vault of 0.5.32: identity details (5.26) and the owner-started reset (5.29). */
function newer(t: TestVault) {
  t.caps = capabilities({ server_version: '0.5.32', features: { ...capabilities().features, member_identity: true } });
}

describe('Home tells the person (5.31)', () => {
  it('the reset notice: who was given a link, what was added since, and I have seen this', async () => {
    const t = testVault([ORIGIN]);
    newer(t);
    t.vault.state.resetNotices.set('fake-member', {
      by: 'Mansoor',
      at: '2026-10-01T09:00:00Z',
      spent_at: '2026-10-01T09:30:00Z',
      passkeys_since: [
        { label: 'Pixel 9', added_at: '2026-10-02T10:00:00Z' },
        { label: null, added_at: '2026-10-02T11:00:00Z' },
      ],
      two_step_since: '2026-10-03T08:00:00Z',
      links_since: [{ title: 'Passport', made_at: '2026-10-03T09:00:00Z' }],
    });
    await unlocked(t, <Home />);
    const notice = await screen.findByTestId('home-reset-notice');
    expect(within(notice).getByText('An owner made a link to reset your password')).toBeTruthy();
    expect(notice).toHaveTextContent(
      /On 1 Oct 2026, Mansoor was given a one-time link to set a new password for your sign-in, to hand to you\./,
    );
    expect(notice).toHaveTextContent(/change it in the browser/);
    expect(within(notice).getAllByTestId('home-reset-added').map((n) => n.props.children)).toEqual([
      '• A passkey called “Pixel 9”, on 2 Oct 2026',
      '• A passkey, on 2 Oct 2026',
      '• Two-step sign-in, on 3 Oct 2026',
      '• A share link to “Passport”, made on 3 Oct 2026',
    ]);
    await fireEvent.press(within(notice).getByTestId('home-reset-seen'));
    await waitFor(() => expect(screen.queryByTestId('home-reset-notice')).toBeNull());
    expect(t.calls).toContain(`DELETE ${ORIGIN}/api/v1/me/reset-notice`);
    expect(t.vault.state.resetNotices.size).toBe(0);
  });

  it('a notice with nothing added since, from an owner whose sign-in is gone, says an owner', async () => {
    const t = testVault([ORIGIN]);
    newer(t);
    t.vault.state.resetNotices.set('fake-member', { by: null, at: '2026-10-01T09:00:00Z' });
    await unlocked(t, <Home />);
    const notice = await screen.findByTestId('home-reset-notice');
    expect(notice).toHaveTextContent(/On 1 Oct 2026, an owner was given a one-time link/);
    expect(within(notice).queryByTestId('home-reset-added')).toBeNull();
  });

  it('a wider audience for identity details waiting its notice: when, who, and the way to yours', async () => {
    const t = testVault([ORIGIN]);
    newer(t);
    t.vault.state.identityPending = {
      to: 'adults',
      requested_at: '2026-10-04T07:00:00Z',
      notice_until: '2099-10-07T07:00:00Z',
    };
    await unlocked(t, <Home />);
    const notice = await screen.findByTestId('home-widening');
    expect(notice).toHaveTextContent(/From 7 October at 07:00, all adults will see your shared identity details\./);
    expect(notice).toHaveTextContent(/Mark anything Only me in the browser before then\./);
    await fireEvent.press(within(notice).getByTestId('home-widening-look'));
    expect(routes().at(-1)).toEqual({ pathname: '/person/[id]', params: { id: 'fake-member' } });
  });

  it('a push that something about your details is changing makes Home look again', async () => {
    const t = testVault([ORIGIN]);
    newer(t);
    await unlocked(t, <Home />);
    await screen.findByTestId('home-calm');
    expect(screen.queryByTestId('home-widening')).toBeNull();
    t.vault.state.identityPending = {
      to: 'family',
      requested_at: '2026-10-04T07:00:00Z',
      notice_until: '2099-10-07T07:00:00Z',
    };
    await act(async () => emit('noticesChanged'));
    expect(await screen.findByTestId('home-widening')).toHaveTextContent(/everyone in the family but viewers/);
  });

  it('nothing new with an older vault: no notices, and nothing asked about identity', async () => {
    const t = testVault([ORIGIN]);
    // A vault of 0.5.19: no identity details; GET /me says nothing of a reset.
    t.caps = caps0519();
    await unlocked(t, <Home />);
    await screen.findByTestId('home-calm');
    expect(screen.queryByTestId('home-reset-notice')).toBeNull();
    expect(screen.queryByTestId('home-widening')).toBeNull();
    expect(t.calls.filter((c) => c.includes('identity'))).toEqual([]);
  });
});
