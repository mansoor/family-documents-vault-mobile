import { TAP_MIN } from '@fdv/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import Home from '../app/index';
import Connect from '../app/connect';
import Settings from '../app/settings';
import SignIn from '../app/sign-in';
import { installed, knownVault, renderApp, signedIn, withTwoStep } from '../test-support/render';
import { testVault } from '../test-support/vault';

jest.mock('expo-linking', () => ({ openURL: jest.fn(async () => true) }));
jest.mock('expo-router', () => ({
  Link: (p: { children: unknown }) => p.children,
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

type Instance = NonNullable<typeof screen.root>;

function slop(hitSlop: unknown, a: 'top' | 'left', b: 'bottom' | 'right'): number {
  if (typeof hitSlop === 'number') return hitSlop * 2;
  const h = (hitSlop ?? {}) as Record<string, number | undefined>;
  return (h[a] ?? 0) + (h[b] ?? 0);
}

function label(i: Instance): string {
  return String(i.props.accessibilityLabel ?? i.props['aria-label'] ?? '').trim();
}

function describeIt(i: Instance): string {
  return `${i.type}${i.props.testID ? `#${i.props.testID}` : ''}${label(i) ? ` "${label(i)}"` : ''}`;
}

/**
 * Everything on the screen a finger can use: it says what it is, it has a
 * name a screen reader can read out, and it is at least 44 dp each way
 * once its hit slop is counted. Returns what falls short, in words.
 */
function audit(): string[] {
  const root = screen.root;
  if (!root) return ['nothing rendered'];
  const problems: string[] = [];

  const pressables = root.queryAll(
    (n) => n.props.accessible === true && typeof n.props.onClick === 'function' && typeof n.props.onChangeText !== 'function',
  );
  if (pressables.length === 0) problems.push('no pressables found: the audit is not looking at anything');
  for (const p of pressables) {
    if (!p.props.accessibilityRole && !p.props.role) problems.push(`${describeIt(p)} has no role`);
    if (!label(p)) problems.push(`${describeIt(p)} has no label`);
    const style = StyleSheet.flatten(p.props.style) ?? {};
    const tall = Number(style.height ?? style.minHeight ?? 0) + slop(p.props.hitSlop, 'top', 'bottom');
    if (tall < TAP_MIN) problems.push(`${describeIt(p)} is ${tall} dp tall with its hit slop`);
    const setWidth = style.width ?? style.minWidth;
    if (setWidth !== undefined) {
      const wide = Number(setWidth) + slop(p.props.hitSlop, 'left', 'right');
      if (wide < TAP_MIN) problems.push(`${describeIt(p)} is ${wide} dp wide with its hit slop`);
    }
  }

  for (const f of root.queryAll((n) => typeof n.props.onChangeText === 'function')) {
    if (!label(f)) problems.push(`${describeIt(f)} is a field with no label`);
  }
  for (const s of root.queryAll((n) => typeof n.props.onValueChange === 'function' || String(n.type).endsWith('Switch'))) {
    if (!label(s)) problems.push(`${describeIt(s)} is a switch with no label`);
  }
  return problems;
}

async function go(address: string) {
  await fireEvent.changeText(screen.getByTestId('connect-address'), address);
  await fireEvent.press(screen.getByTestId('connect-go'));
}

describe('every screen can be used with a screen reader and a thumb', () => {
  beforeEach(() => installed());

  it('Connect, and each thing it can say', async () => {
    const t = testVault(['https://vault.test', 'http://192.168.1.20:8099']);
    await renderApp(<Connect deps={{ fetch: t.fetch, network: async () => 'wifi' }} />);
    expect(audit()).toEqual([]);

    await go('192.168.1.20:8099');
    await screen.findByTestId('connect-approve-http');
    expect(audit()).toEqual([]);

    t.caps = { ...t.caps, server_version: '0.4.2' };
    await go('vault.test');
    await screen.findByText('Show how');
    expect(audit()).toEqual([]);

    t.caps = { ...t.caps, server_version: '0.4.7', setup_required: true };
    await go('vault.test');
    await screen.findByText('Open in browser');
    expect(audit()).toEqual([]);
  });

  it('Sign in, both steps', async () => {
    knownVault();
    const t = testVault();
    await renderApp(<SignIn />, { fetch: withTwoStep(t) });
    await screen.findByTestId('sign-in-email');
    expect(audit()).toEqual([]);

    await fireEvent.changeText(screen.getByTestId('sign-in-email'), 'owner@example.test');
    await fireEvent.changeText(screen.getByTestId('sign-in-password'), 'correct horse battery staple');
    await fireEvent.press(screen.getByTestId('sign-in-go'));
    await screen.findByTestId('sign-in-code');
    expect(audit()).toEqual([]);
  });

  it('Home', async () => {
    const t = testVault();
    await signedIn(t);
    await renderApp(<Home />, { fetch: t.fetch });
    await screen.findByTestId('home-calm');
    expect(audit()).toEqual([]);
  });

  it('Settings', async () => {
    const t = testVault();
    await signedIn(t);
    await renderApp(<Settings />, { fetch: t.fetch });
    await waitFor(() => expect(screen.getByTestId('settings-sign-out')).toBeTruthy());
    expect(audit()).toEqual([]);
  });
});
