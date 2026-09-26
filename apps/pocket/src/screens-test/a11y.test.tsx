import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import CaptureScreen from '../app/capture';
import Home, { add } from '../test-support/home';
import Connect from '../app/connect';
import Settings from '../app/settings';
import SignIn from '../app/sign-in';
import Timings from '../app/timings';
import { fixtureScanner } from '../capture/scanner';
import { writePrefs } from '../platform/prefs';
import { useCapture } from '../state/capture';
import { audit } from '../test-support/a11y';
import { jpeg, reply } from '../test-support/capture';
import { installed, knownVault, renderApp, signedIn, testCapture, withTwoStep } from '../test-support/render';
import { testVault } from '../test-support/vault';

jest.mock('expo-linking', () => ({ openURL: jest.fn(async () => true) }));
jest.mock('expo-router', () => ({
  Link: (p: { children: unknown }) => p.children,
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useNavigation: () => ({ addListener: () => () => undefined, dispatch: jest.fn() }),
}));

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

    t.caps = { ...t.caps, server_version: '0.4.10', setup_required: true };
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

  it('Capture: the card with everything open, then Home with the Saved line and a capture on its way', async () => {
    const t = testVault();
    await signedIn(t);
    const phone = testCapture({
      scanner: fixtureScanner([{ kind: 'pages', pages: [{ uri: 'cache:/scan/1.jpg' }, { uri: 'cache:/scan/2.jpg' }] }]),
    });
    phone.files.set('cache:/scan/1.jpg', jpeg('letter-with-exif.jpg'));
    phone.files.set('cache:/scan/2.jpg', jpeg('card.jpg'));
    // The vault is busy: the capture stays on its way.
    const busy: typeof t.fetch = async (url, init) =>
      url.endsWith('/api/v1/capture')
        ? reply(503, { error: { code: 'unavailable', message: 'Busy.', retriable: true } })
        : t.fetch(url, init);
    function Both() {
      const { pending } = useCapture();
      return pending ? <CaptureScreen /> : <Home />;
    }
    await renderApp(<Both />, { fetch: busy, capture: phone });
    await screen.findByTestId('home-calm');
    expect(audit()).toEqual([]);

    // The + menu, open.
    await fireEvent.press(screen.getByTestId('home-add'));
    await screen.findByTestId('add-menu');
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByTestId('add-cancel'));

    await add();
    await fireEvent.press(await screen.findByRole('button', { name: 'Passport' }));
    await fireEvent.press(screen.getByTestId('types-more'));
    await fireEvent.press(screen.getByTestId('more-details'));
    await screen.findByTestId('field-expires');
    expect(audit()).toEqual([]);

    await fireEvent.press(screen.getByTestId('capture-save'));
    await screen.findByTestId('home-saved');
    await screen.findByTestId('queue-state');
    expect(audit()).toEqual([]);
  });

  it('Timings', async () => {
    writePrefs('timings', [
      {
        at: '2026-09-25T10:00:00.000Z',
        kind: 'scan',
        pages: 2,
        marks: {
          tap: 0,
          scanner_shown: 40,
          pages_accepted: 8200,
          card_shown: 8500,
          save: 14100,
          queued: 14600,
          created: 16900,
        },
      },
    ]);
    await renderApp(<Timings />);
    await screen.findByText('Tap to Save: 14.1 s');
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
