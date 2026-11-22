import type { SecurityHealthView } from '@fdv/shared';
import { fireEvent, screen } from '@testing-library/react-native';
import Settings from '../app/settings';
import { SecureTokenStore } from '../session/store';
import { audit } from '../test-support/a11y';
import { unlocked } from '../test-support/lookup';
import { installed, respond } from '../test-support/render';
import { resetRoutes, routes } from '../test-support/router';
import { capabilities, testVault, type TestVault } from '../test-support/vault';

jest.mock(
  'expo-router',
  () => jest.requireActual<typeof import('../test-support/router')>('../test-support/router').routerMock,
);

const ORIGIN = 'https://vault.test';

beforeEach(() => {
  installed();
  resetRoutes();
});

const HEALTH: SecurityHealthView = {
  hosted: false,
  backup: { state: 'fine', last_at: '2026-11-21T02:00:00Z' },
  offsite: null,
  restore_drill: { state: 'never', last_at: null },
  audit_chain: { state: 'fine', last_at: '2026-11-21T03:00:00Z' },
  failed_sign_ins: { state: 'many', count: 7 },
  token_reuse: { state: 'fine', count: 0 },
};

/** A vault with Security & health, answering the card as an owner's (and 403 to anybody else). */
function vault(over: { feature?: boolean } = {}): TestVault & { asked: number } {
  const t = Object.assign(testVault([ORIGIN]), { asked: 0 });
  t.caps = capabilities({ features: { ...capabilities().features, security_health: over.feature ?? true } });
  const real = t.vault.fetch;
  t.vault.fetch = async (url, init) => {
    if (new URL(url).pathname !== '/api/v1/household/health') return real(url, init);
    t.asked += 1;
    return respond(200, HEALTH);
  };
  return t;
}

describe('Security & health in Settings', () => {
  it('an owner sees each line in the vault’s words, how many need looking at, and Activity opens', async () => {
    const t = vault();
    await unlocked(t, <Settings />);
    expect(await screen.findByTestId('security-health-summary')).toHaveTextContent('One thing needs looking at.');
    expect(screen.getByTestId('health-backup')).toHaveTextContent(/^BackupsFine/);
    expect(screen.getByTestId('health-restore_drill')).toHaveTextContent(/When you can/);
    expect(screen.getByTestId('health-failed_sign_ins')).toHaveTextContent(/7 failed sign-ins in the last day\./);
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByTestId('health-failed_sign_ins-open'));
    expect(routes().at(-1)).toEqual({ pathname: '/activity', params: {} });
  });

  it('nobody but an owner is shown it, nor asks for it', async () => {
    const t = vault();
    await unlocked(t, <Settings />, {
      before: async () => {
        const store = new SecureTokenStore();
        const kept = await store.load();
        await store.save({ ...(kept as NonNullable<typeof kept>), role: 'adult' as never });
      },
    });
    await screen.findByTestId('settings-sign-out');
    expect(screen.queryByTestId('security-health')).toBeNull();
    expect(t.asked).toBe(0);
  });

  it('an older vault shows nothing of it', async () => {
    const t = vault({ feature: false });
    await unlocked(t, <Settings />);
    await screen.findByTestId('settings-sign-out');
    expect(screen.queryByTestId('security-health')).toBeNull();
    expect(t.asked).toBe(0);
  });
});
