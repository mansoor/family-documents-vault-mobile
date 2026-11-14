import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import SharingScreen from '../app/sharing';
import { DocumentDetail } from '../documents/detail';
import { audit } from '../test-support/a11y';
import { libraryDoc, unlocked } from '../test-support/lookup';
import { installed } from '../test-support/render';
import { resetRoutes } from '../test-support/router';
import { caps0519, capabilities, testVault, type TestVault } from '../test-support/vault';

jest.mock(
  'expo-router',
  () => jest.requireActual<typeof import('../test-support/router')>('../test-support/router').routerMock,
);

/** The phone's clipboard, as the native module keeps it on Android: Copy is offered only with it. */
const mockBoard = { text: null as string | null };
jest.mock('../identity/clipboard', () => {
  const actual = jest.requireActual<typeof import('../identity/clipboard')>('../identity/clipboard');
  const port = {
    copySensitive: (text: string) => {
      mockBoard.text = text;
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
const PASSWORD = 'correct horse battery staple';

beforeEach(() => {
  installed();
  resetRoutes();
  mockBoard.text = null;
});

/** A vault of 0.9.0-dev.39: links shown again, and — with its operator's mail server — emailed. */
function vault(opts: { mail?: boolean; emailable?: boolean } = {}): TestVault {
  const t = testVault([ORIGIN]);
  t.caps = capabilities({
    features: {
      ...caps0519().features,
      collections: true,
      notes: true,
      share_options: true,
      share_second_factor: true,
      collection_shares: true,
      share_reveal: true,
      ...(opts.mail === false ? {} : { share_link_email: true }),
    },
  });
  t.library.emailLinks = opts.emailable ?? true;
  return t;
}

/** A link made from a document's ⋯ Share, with a PIN: the sheet says "The link is made". */
async function made(t: TestVault) {
  libraryDoc(t, { id: 'passport', title: 'Passport' });
  await unlocked(t, <DocumentDetail id="passport" />);
  await fireEvent.press(await screen.findByTestId('document-more'));
  await fireEvent.press(await screen.findByTestId('document-share'));
  await fireEvent.press(await screen.findByTestId('share-protect-pin'));
  await fireEvent.press(screen.getByTestId('share-make'));
  await screen.findByTestId('share-send');
}

/** Send, Copy the link and Copy the PIN, as before: Email the link never takes their place. */
function copyAndSendStay(prefix: 'share' | 'sharing-shown') {
  expect(screen.getByTestId(`${prefix}-send`)).toHaveTextContent('Send the link…');
  expect(screen.getByTestId(`${prefix}-copy-link`)).toHaveTextContent('Copy the link');
  expect(screen.getByTestId(`${prefix}-copy-secret`)).toHaveTextContent('Copy the PIN');
}

describe('Email the link, after "The link is made" (0.9.0)', () => {
  it('beside Send and Copy: an address and a short message, sent, and where it went, masked', async () => {
    const t = vault();
    await made(t);
    copyAndSendStay('share');
    expect(screen.getByText('Send it another way than the link: a text if the link went by email.')).toBeTruthy();
    expect(screen.queryByTestId('share-email-to')).toBeNull();
    await fireEvent.press(screen.getByTestId('share-email-open'));

    const to = await screen.findByTestId('share-email-to');
    expect(to.props.keyboardType).toBe('email-address');
    expect(to.props.autoComplete).toBe('off');
    expect(screen.getByText(/No web addresses or website names/)).toBeTruthy();
    expect(audit()).toEqual([]);
    await fireEvent.changeText(to, ' jane.smith@example.com ');
    await fireEvent.changeText(screen.getByTestId('share-email-message'), '  Here is the passport.  \n\n\n\nSee you Friday. ');
    await fireEvent.press(screen.getByTestId('share-email-send'));

    expect(await screen.findByTestId('share-email-sent')).toHaveTextContent(
      'Sent to j•••@example.com. It can be emailed 2 more times today.',
    );
    expect(t.library.emailed).toEqual([
      { id: 'share-1', to: 'jane.smith@example.com', message: 'Here is the passport.\n\nSee you Friday.' },
    ]);
    // The form is put away; Copy is still there, and it can be emailed again.
    expect(screen.queryByTestId('share-email-to')).toBeNull();
    copyAndSendStay('share');
    expect(screen.getByTestId('share-email-open')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('share-copy-link'));
    expect(mockBoard.text).toBe('https://share.vault.test/s#tok-1');
  });

  it('the last one today: said so, and no more Email the link', async () => {
    const t = vault();
    await made(t);
    t.library.emailed.push({ id: 'share-1', to: 'a@example.com' }, { id: 'share-1', to: 'b@example.com' });
    await fireEvent.press(screen.getByTestId('share-email-open'));
    await fireEvent.changeText(await screen.findByTestId('share-email-to'), 'c@example.com');
    await fireEvent.press(screen.getByTestId('share-email-send'));
    expect(await screen.findByTestId('share-email-sent')).toHaveTextContent(
      'Sent to c•••@example.com. That is as many times as it can be emailed today.',
    );
    expect(screen.queryByTestId('share-email-open')).toBeNull();
    copyAndSendStay('share');
  });

  it('no message: none is sent; Cancel puts the form away and sends nothing', async () => {
    const t = vault();
    await made(t);
    await fireEvent.press(screen.getByTestId('share-email-open'));
    await fireEvent.changeText(await screen.findByTestId('share-email-to'), 'jo@example.org');
    await fireEvent.press(screen.getByTestId('share-email-cancel'));
    expect(screen.queryByTestId('share-email-to')).toBeNull();
    expect(t.library.emailed).toEqual([]);
    await fireEvent.press(screen.getByTestId('share-email-open'));
    expect(await screen.findByTestId('share-email-to')).toHaveProp('value', '');
    await fireEvent.changeText(screen.getByTestId('share-email-to'), 'jo@example.org');
    await fireEvent.press(screen.getByTestId('share-email-send'));
    await screen.findByTestId('share-email-sent');
    expect(t.library.emailed).toEqual([{ id: 'share-1', to: 'jo@example.org' }]);
  });
});

describe('the message rules, on the phone before anything is sent', () => {
  it('an address that is not one: said at Send, and nothing sent', async () => {
    const t = vault();
    await made(t);
    await fireEvent.press(screen.getByTestId('share-email-open'));
    await fireEvent.changeText(await screen.findByTestId('share-email-to'), 'jane at example');
    await fireEvent.press(screen.getByTestId('share-email-send'));
    expect(await screen.findByText('That is not an email address. Check it: name@example.com.')).toBeTruthy();
    expect(t.library.emailed).toEqual([]);
    // Put right, it goes.
    await fireEvent.changeText(screen.getByTestId('share-email-to'), 'jane@example.com');
    expect(screen.queryByText('That is not an email address. Check it: name@example.com.')).toBeNull();
    await fireEvent.press(screen.getByTestId('share-email-send'));
    await screen.findByTestId('share-email-sent');
  });

  it.each([
    ['a web address', 'Open https://evil.test/login', /Leave web addresses and website names out/],
    ['a website name', 'Try bit.ly/3xYz instead', /Leave web addresses and website names out/],
    ['too long', 'a'.repeat(301), /Keep the message to 300 characters or fewer/],
    ['too many lines', 'one\ntwo\nthree\nfour\nfive\nsix', /Keep the message to five lines or fewer/],
  ])('%s: said as it is typed, and Send waits', async (_what, typed, said) => {
    const t = vault();
    await made(t);
    await fireEvent.press(screen.getByTestId('share-email-open'));
    await fireEvent.changeText(await screen.findByTestId('share-email-to'), 'jane@example.com');
    await fireEvent.changeText(screen.getByTestId('share-email-message'), typed);
    expect(await screen.findByText(said)).toBeTruthy();
    expect(screen.getByTestId('share-email-send').props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );
    await fireEvent.press(screen.getByTestId('share-email-send'));
    expect(t.library.emailed).toEqual([]);
  });

  it('a full stop between sentences is a sentence, not a website', async () => {
    const t = vault();
    await made(t);
    await fireEvent.press(screen.getByTestId('share-email-open'));
    await fireEvent.changeText(await screen.findByTestId('share-email-to'), 'jane@example.com');
    await fireEvent.changeText(screen.getByTestId('share-email-message'), 'Thanks. See you soon');
    await fireEvent.press(screen.getByTestId('share-email-send'));
    await screen.findByTestId('share-email-sent');
    expect(t.library.emailed[0]?.message).toBe('Thanks. See you soon');
  });
});

describe('only where it can work', () => {
  it('no mail server: no Email the link; Send and Copy stay', async () => {
    const t = vault({ mail: false });
    await made(t);
    copyAndSendStay('share');
    expect(screen.queryByTestId('share-email-open')).toBeNull();
  });

  it('a link the vault cannot email: none; Send and Copy stay', async () => {
    const t = vault({ emailable: false });
    await made(t);
    copyAndSendStay('share');
    expect(screen.queryByTestId('share-email-open')).toBeNull();
  });

  it('in Sharing, somebody else’s link: no Show the link and no Email the link', async () => {
    const t = vault();
    libraryDoc(t, { id: 'passport', title: 'Passport' });
    t.library.shares.push({
      id: 'theirs',
      document_id: 'passport',
      document_title: 'Passport',
      recipient_label: null,
      created_by_name: 'Sara',
      created_at: '2026-11-10T10:00:00Z',
      expires_at: '2030-11-17T10:00:00Z',
      has_pin: false,
      open_count: 0,
      last_opened_at: null,
      state: 'active',
      summary: 'A link',
      revealable: false,
      emailable: false,
      emailed_to: null,
    } as never);
    await unlocked(t, <SharingScreen />);
    await screen.findByTestId('sharing-theirs');
    expect(screen.queryByTestId('sharing-show-theirs')).toBeNull();
    expect(screen.queryByTestId('sharing-shown-email-open')).toBeNull();
  });
});

describe('Email the link, in More → Sharing → Show the link', () => {
  it('a link you made: shown again after confirming it is you, then emailed, beside Copy', async () => {
    const t = vault();
    await made(t);
    await unlocked(t, <SharingScreen />);
    await fireEvent.press(await screen.findByTestId('sharing-show-share-1'));
    await fireEvent.changeText(await screen.findByTestId('step-up-password'), PASSWORD);
    await fireEvent.press(screen.getByTestId('step-up-go'));
    await screen.findByTestId('sharing-shown-link');
    copyAndSendStay('sharing-shown');
    await fireEvent.press(screen.getByTestId('sharing-shown-email-open'));
    await fireEvent.changeText(await screen.findByTestId('sharing-shown-email-to'), 'dr.patel@surgery.example');
    await fireEvent.press(screen.getByTestId('sharing-shown-email-send'));
    expect(await screen.findByTestId('sharing-shown-email-sent')).toHaveTextContent(
      'Sent to d•••@surgery.example. It can be emailed 2 more times today.',
    );
    expect(t.library.emailed).toEqual([{ id: 'share-1', to: 'dr.patel@surgery.example' }]);
    copyAndSendStay('sharing-shown');
  });

  it('a link emailed before says where, masked', async () => {
    const t = vault();
    await made(t);
    const share = t.library.shares[0];
    if (share) share.emailed_to = 'j•••@e•••.com';
    await unlocked(t, <SharingScreen />);
    await fireEvent.press(await screen.findByTestId('sharing-show-share-1'));
    await fireEvent.changeText(await screen.findByTestId('step-up-password'), PASSWORD);
    await fireEvent.press(screen.getByTestId('step-up-go'));
    expect(await screen.findByTestId('sharing-shown-email-before')).toHaveTextContent('Last emailed to j•••@e•••.com.');
  });
});

describe('confirm it’s you, when the vault asks (email_share)', () => {
  it('asked, then sent once confirmed', async () => {
    const t = vault();
    await made(t);
    t.library.emailStepUp = true;
    await fireEvent.press(screen.getByTestId('share-email-open'));
    await fireEvent.changeText(await screen.findByTestId('share-email-to'), 'jane@example.com');
    await fireEvent.press(screen.getByTestId('share-email-send'));
    await fireEvent.changeText(await screen.findByTestId('step-up-password'), PASSWORD);
    await fireEvent.press(screen.getByTestId('step-up-go'));
    expect(await screen.findByTestId('share-email-sent')).toHaveTextContent(/^Sent to j•••@example\.com\./);
    expect(t.library.emailed).toHaveLength(1);
  });

  it('cancelled: nothing sent, nothing wrong said, and the form still there', async () => {
    const t = vault();
    await made(t);
    t.library.emailStepUp = true;
    await fireEvent.press(screen.getByTestId('share-email-open'));
    await fireEvent.changeText(await screen.findByTestId('share-email-to'), 'jane@example.com');
    await fireEvent.press(screen.getByTestId('share-email-send'));
    await screen.findByTestId('step-up-password');
    await fireEvent.press(screen.getByTestId('step-up-cancel'));
    await waitFor(() => expect(screen.queryByTestId('step-up-password')).toBeNull());
    expect(t.library.emailed).toEqual([]);
    expect(screen.queryByTestId('share-email-problem')).toBeNull();
    expect(screen.getByTestId('share-email-to')).toHaveProp('value', 'jane@example.com');
  });
});

describe('what the vault refuses, in its own words', () => {
  it.each([
    [409, 'share_paused', 'That link is paused just now, so it would not open for them. Once it works again, you can email it.'],
    [410, 'share_ended', 'That link no longer opens, so there is nothing to send. Make a new one if you need to.'],
    [409, 'share_not_revealable', 'That link was made before the vault kept a copy, so the vault cannot email it. Send it yourself, or take it back and make a new one.'],
    [429, 'email_link_limit', 'This link has been emailed 3 times today, which is as many as the vault sends. Copy it and send it yourself, or try again tomorrow.'],
    [429, 'email_link_limit', 'You have emailed 20 links today, which is as many as the vault sends for one person. Copy the link and send it yourself, or try again tomorrow.'],
    [503, 'email_link_unavailable', 'Emailing a link needs the mail server of whoever runs this vault, and none is set up. Copy the link and send it yourself.'],
    [422, 'validation_failed', 'Leave web addresses and website names out of the message: the only link in the email is the vault’s.'],
  ])('%i %s', async (status, code, message) => {
    const t = vault();
    await made(t);
    t.library.emailRefusal = { status, code, message, ...(status === 429 ? { retryAfter: 3600 } : {}) };
    await fireEvent.press(screen.getByTestId('share-email-open'));
    await fireEvent.changeText(await screen.findByTestId('share-email-to'), 'jane@example.com');
    await fireEvent.press(screen.getByTestId('share-email-send'));
    expect(await screen.findByTestId('share-email-problem')).toHaveTextContent(message);
    expect(screen.queryByTestId('share-email-sent')).toBeNull();
    // Copy and Send stay, whatever the vault said.
    copyAndSendStay('share');
  });

  it('a refusal with no words of its own gets the phone’s', async () => {
    const t = vault();
    await made(t);
    t.library.emailRefusal = { status: 503, code: 'email_link_unavailable', message: '' };
    await fireEvent.press(screen.getByTestId('share-email-open'));
    await fireEvent.changeText(await screen.findByTestId('share-email-to'), 'jane@example.com');
    await fireEvent.press(screen.getByTestId('share-email-send'));
    expect(await screen.findByTestId('share-email-problem')).toHaveTextContent(
      'This vault cannot email links just now. Copy the link and send it yourself.',
    );
  });
});
