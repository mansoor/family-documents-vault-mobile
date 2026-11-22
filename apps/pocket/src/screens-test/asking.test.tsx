import type { UploadRequestView } from '@fdv/shared';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import SharingScreen from '../app/sharing';
import { SecureTokenStore } from '../session/store';
import { ASK_START, readAsk, readRequestChange, startRequestChange } from '../sharing/ask-model';
import { audit } from '../test-support/a11y';
import { unlocked } from '../test-support/lookup';
import { installed } from '../test-support/render';
import { push, resetRoutes, routes } from '../test-support/router';
import { caps0519, capabilities, testVault, type TestVault } from '../test-support/vault';

jest.mock(
  'expo-router',
  () => jest.requireActual<typeof import('../test-support/router')>('../test-support/router').routerMock,
);

/**
 * Asking for documents on the phone (app 0.18.0): a new request made on the
 * phone's own form, and one changed, as the web's AskForDocuments does
 * them. The client's fake vault makes and changes requests as the vault
 * does; it asks nobody to confirm it is them, so the step-up's test has the
 * test library ask first (`changeStepUp`, as for a link).
 */

const ORIGIN = 'https://vault.test';
const PASSWORD = 'correct horse battery staple';
const ZONE = 'Europe/London';

beforeEach(() => {
  installed();
  resetRoutes();
});

/** A vault of 0.9.0-dev.65: requests made, shown again, changed and emailed. */
function vault(over: Record<string, boolean> = {}): TestVault {
  const t = testVault([ORIGIN]);
  t.caps = capabilities({
    server_version: '0.9.0-dev.65',
    features: {
      ...caps0519().features,
      upload_requests: true,
      share_reveal: true,
      link_changes: true,
      upload_request_email: true,
      ended_sharing: true,
      ...over,
    },
  });
  t.vault.state.members.push({ id: 'sam', display_name: 'Sam', role: 'adult', is_me: false } as never);
  return t;
}

/** A request to send documents, as GET /upload-requests lists it. */
function request(over: Partial<UploadRequestView> & { id: string }): UploadRequestView {
  return {
    title: 'Tax papers 2025',
    message: null,
    items: [{ id: 'i1', label: 'P60' }],
    recipient_label: 'the accountant',
    recipient_email: null,
    requested_by_name: 'Fake Owner',
    mine: true,
    created_at: new Date(Date.now() - 864e5).toISOString(),
    expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
    protection: ['password'],
    max_visits: 3,
    visits_used: 1,
    max_files: 10,
    files_used: 0,
    max_total_bytes: 200 * 1024 * 1024,
    bytes_used: 0,
    accept_types: 'standard',
    review_by: 'me',
    suggested_member_id: null,
    suggested_type_key: null,
    close_after_submit: false,
    state: 'active',
    paused_reason: null,
    closed_reason: null,
    files_received: 0,
    version: 2,
    ...over,
  } as UploadRequestView;
}

/** As another role, whom the phone keeps as signed in so. */
const as = (t: TestVault, role: 'adult' | 'teen') => async () => {
  t.vault.state.role = role;
  const store = new SecureTokenStore();
  const kept = await store.load();
  await store.save({ ...(kept as NonNullable<typeof kept>), role: role as never });
};

describe('a request’s form, read as the web reads it', () => {
  const now = new Date('2026-11-16T10:00:00Z');
  const ctx = { timezone: ZONE, maxDays: 90, emailCode: false, now };

  it('a title is needed; then all of it is sent, the web’s defaults with it', () => {
    expect(readAsk(ASK_START, ctx)).toEqual(expect.objectContaining({ titleProblem: 'title', body: null, problem: 'title' }));
    const read = readAsk({ ...ASK_START, title: ' Tax 2025 ', items: [' P60 ', '', 'P45'], label: 'Jane', person: 'sam' }, ctx);
    expect(read.body).toEqual({
      title: 'Tax 2025',
      items: ['P60', 'P45'],
      recipient_label: 'Jane',
      expires_at: '2026-11-23T10:00:00.000Z',
      max_files: 10,
      max_total_bytes: 200 * 1024 * 1024,
      accept_types: 'standard',
      review_by: 'me',
      suggested_member_id: 'sam',
    });
  });

  it('a password made up or typed (exactly as typed, 8 to 64); visits, files and room within their bounds', () => {
    const base = { ...ASK_START, title: 'Tax' };
    expect(readAsk({ ...base, withPassword: true }, ctx).body).toEqual(expect.objectContaining({ with_password: true }));
    expect(readAsk({ ...base, withPassword: true, passwordMode: 'typed', password: ' short ' }, ctx).problem).toBe('password');
    expect(readAsk({ ...base, withPassword: true, passwordMode: 'typed', password: 'long enough' }, ctx).body?.password).toBe(
      'long enough',
    );
    expect(readAsk({ ...base, withPassword: true, passwordMode: 'typed', password: 'x'.repeat(65) }, ctx).problem).toBe(
      'passwordLong',
    );
    expect(readAsk({ ...base, limitVisits: true, visits: '0' }, ctx).problem).toBe('visits');
    expect(readAsk({ ...base, limitVisits: true, visits: '2' }, ctx).body?.max_visits).toBe(2);
    expect(readAsk({ ...base, maxFiles: '11' }, ctx).problem).toBe('files');
    expect(readAsk({ ...base, maxMegabytes: '201' }, ctx).problem).toBe('size');
    expect(readAsk({ ...base, maxMegabytes: '5', accept: 'office', closeAfter: true, thisDeviceOnly: true }, ctx).body).toEqual(
      expect.objectContaining({ max_total_bytes: 5 * 1024 * 1024, accept_types: 'office', close_after_submit: true, this_device_only: true }),
    );
  });

  it('an emailed code only where the vault sends one, to an address that is one', () => {
    const base = { ...ASK_START, title: 'Tax', withCode: true, email: 'jane@' };
    expect(readAsk(base, ctx).body).not.toHaveProperty('email_code');
    expect(readAsk(base, { ...ctx, emailCode: true }).problem).toBe('address');
    expect(readAsk({ ...base, email: 'jane@example.com' }, { ...ctx, emailCode: true }).body).toEqual(
      expect.objectContaining({ email_code: true, recipient_email: 'jane@example.com' }),
    );
  });

  it('an end past the longest a request lasts, said of a request', () => {
    const read = readAsk({ ...ASK_START, title: 'Tax', end: 'other', day: '1 Mar 2027', time: '17:00' }, ctx);
    expect(read.endProblem).toBe('A request can last 90 days at most.');
  });

  it('changed: only what is changed; its end within its latest; its password only by whoever asked', () => {
    const r = request({
      id: 'r',
      created_at: '2026-11-10T10:00:00Z',
      expires_at: '2026-11-20T17:00:00Z',
      latest_end: '2027-02-08T10:00:00Z',
    });
    const as0 = startRequestChange(r, ZONE);
    expect(readRequestChange(r, as0, { timezone: ZONE, now })).toEqual(expect.objectContaining({ nothing: true, problem: null }));
    expect(readRequestChange(r, { ...as0, label: 'Jane', visits: '5', maxMegabytes: '50' }, { timezone: ZONE, now }).body).toEqual({
      recipient_label: 'Jane',
      max_visits: 5,
      max_total_bytes: 50 * 1024 * 1024,
    });
    const late = readRequestChange(r, { ...as0, changeEnd: 'other', day: '1 Mar 2027', time: '17:00' }, { timezone: ZONE, now });
    expect(late).toEqual(expect.objectContaining({ endProblem: 'latest', body: {} }));
    const same = readRequestChange(r, { ...as0, changeEnd: 'other', day: '20 Nov 2026', time: '17:00' }, { timezone: ZONE, now });
    expect(same.nothing).toBe(true);
    expect(readRequestChange(r, { ...as0, secret: 'none' }, { timezone: ZONE, now }).body).toEqual({ secret: 'none' });
    const theirs = { ...r, mine: false };
    expect(readRequestChange(theirs, { ...startRequestChange(theirs, ZONE), secret: 'none' }, { timezone: ZONE, now }).nothing).toBe(true);
    expect(readRequestChange(r, { ...as0, title: ' ' }, { timezone: ZONE, now }).problem).toBe('title');
  });
});

describe('Ask for documents, on the phone (RQ)', () => {
  it('from Sharing: the form, then the link and its password shown once, with what it will do', async () => {
    const t = vault();
    await unlocked(t, <SharingScreen />);
    await fireEvent.press(await screen.findByTestId('requests-ask'));
    expect(routes().at(-1)).toEqual({ pathname: '/ask', params: {} });
    await screen.findByTestId('ask-person-sam');
    expect(audit()).toEqual([]);
    // Nothing named yet: what needs putting right is said, and nothing is made.
    await fireEvent.press(screen.getByTestId('ask-make'));
    expect(await screen.findByTestId('ask-put-right')).toHaveTextContent('Something above needs putting right first.');
    expect(screen.getByText('Say what you are asking for.')).toBeTruthy();
    expect(t.vault.state.uploadRequests).toHaveLength(0);

    await fireEvent.changeText(screen.getByTestId('ask-title'), 'Tax papers 2025');
    await fireEvent.changeText(screen.getByTestId('ask-item-0'), 'P60');
    await fireEvent.press(screen.getByTestId('ask-item-add'));
    await fireEvent.changeText(screen.getByTestId('ask-item-1'), 'P45');
    await fireEvent.changeText(screen.getByTestId('ask-label'), 'Jane, accountant');
    await fireEvent.press(screen.getByTestId('ask-person-sam'));
    expect(screen.getByTestId('ask-review-words')).toHaveTextContent(/You will be told it is probably Sam’s\.$/);
    await fireEvent(screen.getByTestId('ask-with-password'), 'valueChange', true);
    await fireEvent(screen.getByTestId('ask-limit-visits'), 'valueChange', true);
    await fireEvent.changeText(screen.getByTestId('ask-visits'), '2');
    await fireEvent.press(screen.getByTestId('ask-accept-office'));
    await fireEvent.press(screen.getByTestId('ask-make'));

    expect(await screen.findByTestId('ask-made')).toHaveTextContent(/The link for Jane, accountant“Tax papers 2025”/);
    expect(screen.getByTestId('ask-made-link')).toHaveTextContent(/^https:\/\/vault\.test\/drop#drop-token-/);
    expect(screen.getByTestId('ask-made-password-words')).toHaveTextContent('abcd-efgh-jkmn');
    const terms = screen.getByTestId('ask-made-terms');
    expect(terms).toHaveTextContent(/It asks for P60, P45\./);
    expect(terms).toHaveTextContent(/They can send 10 files, 200 MB in all: PDFs, photos, and Word or Excel files\./);
    expect(terms).toHaveTextContent(/It can be opened twice\./);
    expect(screen.getByTestId('ask-made-again-later')).toBeTruthy();
    expect(audit()).toEqual([]);
    expect(t.vault.state.uploadRequests[0]).toEqual(
      expect.objectContaining({
        title: 'Tax papers 2025',
        items: [expect.objectContaining({ label: 'P60' }), expect.objectContaining({ label: 'P45' })],
        recipient_label: 'Jane, accountant',
        max_visits: 2,
        accept_types: 'office',
        suggested_member_id: 'sam',
        protection: ['password'],
      }),
    );
    await fireEvent.press(screen.getByTestId('ask-made-done'));
    // Back in Sharing, which has read the requests again.
    expect(await screen.findByTestId(`request-${t.vault.state.uploadRequests[0]?.id}`)).toHaveTextContent(/“Tax papers 2025”/);
  });

  it('an emailed code is not offered where the vault cannot send one, and says why', async () => {
    const t = vault();
    resetRoutes();
    await unlocked(t, <SharingScreen />);
    await fireEvent.press(await screen.findByTestId('requests-ask'));
    expect(await screen.findByTestId('ask-code-unavailable')).toHaveTextContent(/^Not available here\. Emailing a code needs/);
    await waitFor(() => expect(screen.getByTestId('ask-with-code').props.disabled).toBe(true));
  });

  it('a teen is offered none, as on the web', async () => {
    const t = vault();
    await unlocked(t, <SharingScreen />, { before: as(t, 'teen') });
    await screen.findByTestId('sharing');
    expect(screen.queryByTestId('requests-ask')).toBeNull();
  });
});

describe('Change a request, on the phone (LK)', () => {
  it('the form it was made with, filled in; only what changed is saved, with its version; then said in Sharing', async () => {
    const t = vault();
    t.vault.state.uploadRequests.push(request({ id: 'r1' }));
    await unlocked(t, <SharingScreen />);
    const change = await screen.findByTestId('request-change-r1');
    expect(change.props.accessibilityLabel).toBe('Change the request “Tax papers 2025”');
    await fireEvent.press(change);
    expect(routes().at(-1)).toEqual({ pathname: '/ask/[id]', params: { id: 'r1' } });
    expect((await screen.findByTestId('ask-title')).props.value).toBe('Tax papers 2025');
    expect(screen.getByTestId('ask-label').props.value).toBe('the accountant');
    expect(screen.getByTestId('ask-visits').props.value).toBe('3');
    expect(screen.getByTestId('ask-items-fixed')).toHaveTextContent(/P60/);
    expect(screen.getByTestId('ask-fixed-words')).toHaveTextContent(/^Only you look at what comes in\. The things to send/);
    expect(screen.getByTestId('ask-nothing')).toHaveTextContent('Nothing is changed yet.');
    expect(audit()).toEqual([]);
    await fireEvent.changeText(screen.getByTestId('ask-label'), 'Jane');
    await fireEvent.changeText(screen.getByTestId('ask-visits'), '5');
    await fireEvent.press(screen.getByTestId('ask-save'));
    expect(await screen.findByTestId('sharing-said')).toHaveTextContent('The request “Tax papers 2025” is changed.');
    expect(t.vault.state.uploadRequests[0]).toEqual(expect.objectContaining({ recipient_label: 'Jane', max_visits: 5, version: 3 }));
    expect(t.calls).toContain(`PATCH ${ORIGIN}/api/v1/upload-requests/r1`);
  });

  it('a new password the vault made up is shown once, with Copy', async () => {
    const t = vault();
    t.vault.state.uploadRequests.push(request({ id: 'r1' }));
    t.vault.state.uploadRequestCopies = { r1: { token: 'drop-tok', password: 'plum-heron-27' } };
    await unlocked(t, <SharingScreen />);
    await fireEvent.press(await screen.findByTestId('request-change-r1'));
    await fireEvent.press(await screen.findByTestId('ask-secret-password'));
    expect(screen.getByTestId('ask-old-stops')).toHaveTextContent(/old password stops working at once/);
    await fireEvent.press(screen.getByTestId('ask-save'));
    expect(await screen.findByTestId('ask-new-password-words')).toHaveTextContent(/^fake-/);
    expect(screen.getByTestId('ask-new-password')).toHaveTextContent(/You can see it again with Show the link\./);
    await fireEvent.press(screen.getByTestId('ask-new-password-done'));
    expect(await screen.findByTestId('sharing-said')).toHaveTextContent('The request “Tax papers 2025” is changed.');
  });

  it('a request’s PIN (where the vault makes one): asked for when made, shown once with Copy, never with a password', async () => {
    const t = vault({ upload_request_pin: true });
    await unlocked(t, <SharingScreen />);
    await fireEvent.press(await screen.findByTestId('requests-ask'));
    await fireEvent.changeText(await screen.findByTestId('ask-title'), 'Tax papers 2025');
    await fireEvent(screen.getByTestId('ask-with-password'), 'valueChange', true);
    await fireEvent(screen.getByTestId('ask-with-pin'), 'valueChange', true);
    // A PIN takes the password away.
    expect(screen.getByTestId('ask-with-password').props.value).toBe(false);
    await fireEvent.press(screen.getByTestId('ask-make'));
    expect(await screen.findByTestId('ask-made-pin-words')).toHaveTextContent(/^\d{4}$/);
    expect(screen.queryByTestId('ask-made-password')).toBeNull();
    expect(screen.getByTestId('ask-made-terms')).toHaveTextContent(/They will be asked for the PIN\./);
    expect(t.vault.state.uploadRequests[0]?.protection).toEqual(['pin']);
  });

  it('a request’s PIN changed: a new one shown once, said as a PIN', async () => {
    const t = vault({ upload_request_pin: true });
    t.vault.state.uploadRequests.push(request({ id: 'r1', protection: ['pin'] }));
    await unlocked(t, <SharingScreen />);
    await fireEvent.press(await screen.findByTestId('request-change-r1'));
    expect(await screen.findByTestId('ask-secret-keep')).toHaveTextContent('Keep its PIN');
    await fireEvent.press(screen.getByTestId('ask-secret-pin'));
    expect(screen.getByTestId('ask-old-stops')).toHaveTextContent(/old PIN stops working at once/);
    await fireEvent.press(screen.getByTestId('ask-save'));
    expect(await screen.findByTestId('ask-new-password-words')).toHaveTextContent(/^\d{4}$/);
    expect(screen.getByTestId('ask-new-password')).toHaveTextContent(/^The new PIN/);
    expect(t.vault.state.uploadRequests[0]?.protection).toEqual(['pin']);
  });

  it('letting it do more confirms it is you first', async () => {
    const t = vault();
    t.vault.state.uploadRequests.push(request({ id: 'r1' }));
    // The test library asks first, as the vault does; the client's fake then makes the change.
    t.library.changeStepUp = true;
    await unlocked(t, <SharingScreen />);
    await fireEvent.press(await screen.findByTestId('request-change-r1'));
    await fireEvent(await screen.findByTestId('ask-limit-visits'), 'valueChange', false);
    await fireEvent.press(screen.getByTestId('ask-save'));
    await fireEvent.changeText(await screen.findByTestId('step-up-password'), PASSWORD);
    await fireEvent.press(screen.getByTestId('step-up-go'));
    expect(await screen.findByTestId('sharing-said')).toHaveTextContent('The request “Tax papers 2025” is changed.');
    expect(t.vault.state.uploadRequests[0]?.max_visits).toBeNull();
    expect(t.library.stepUps).toEqual([PASSWORD]);
  });

  it('an owner on somebody else’s: its password stays theirs; its code and one browser are said as fixed', async () => {
    const t = vault();
    t.vault.state.uploadRequests.push(
      request({
        id: 'r2',
        mine: false,
        requested_by_name: 'Sam',
        protection: ['password', 'email_code', 'this_device'],
        recipient_email: 'jane@example.com',
        review_by: 'me',
      }),
    );
    await unlocked(t, <SharingScreen />);
    await fireEvent.press(await screen.findByTestId('request-change-r2'));
    expect(await screen.findByTestId('ask-not-maker')).toHaveTextContent(/^It asks for a password\. Only whoever asked can change/);
    expect(screen.queryByTestId('ask-secret-none')).toBeNull();
    expect(screen.getByTestId('ask-change')).toHaveTextContent(/It emails a code to j•••@e•••\.com when it is opened/);
    expect(screen.getByTestId('ask-change')).toHaveTextContent(/It opens only in the first browser that opened it/);
    expect(screen.getByTestId('ask-fixed-words')).toHaveTextContent(/^Only whoever asked looks at what comes in\./);
    await fireEvent.press(screen.getByTestId('ask-cancel'));
    expect(await screen.findByTestId('sharing')).toBeTruthy();
    expect(t.vault.state.uploadRequests[0]?.version).toBe(2);
  });

  it('changed meanwhile (409): said, and the form starts again from it as it is now; nothing of the other change undone', async () => {
    const t = vault();
    t.vault.state.uploadRequests.push(request({ id: 'r1' }));
    await unlocked(t, <SharingScreen />);
    await fireEvent.press(await screen.findByTestId('request-change-r1'));
    await fireEvent.changeText(await screen.findByTestId('ask-label'), 'Jane');
    // Somebody changes it while the form is open.
    Object.assign(t.vault.state.uploadRequests[0] as object, { version: 3, max_files: 5 });
    await fireEvent.press(screen.getByTestId('ask-save'));
    expect(await screen.findByTestId('ask-problem')).toHaveTextContent(/changed somewhere else/);
    await waitFor(() => expect(screen.getByTestId('ask-max-files').props.value).toBe('5'));
    expect(screen.getByTestId('ask-label').props.value).toBe('the accountant');
    expect(t.vault.state.uploadRequests[0]?.recipient_label).toBe('the accountant');
    await fireEvent.changeText(screen.getByTestId('ask-label'), 'Jane');
    await fireEvent.press(screen.getByTestId('ask-save'));
    expect(await screen.findByTestId('sharing-said')).toHaveTextContent('The request “Tax papers 2025” is changed.');
    expect(t.vault.state.uploadRequests[0]).toEqual(expect.objectContaining({ recipient_label: 'Jane', max_files: 5, version: 4 }));
  });

  it('one that has ended can’t be changed: said, with Ask for documents instead', async () => {
    const t = vault();
    t.vault.state.uploadRequests.push(request({ id: 'r1', state: 'revoked' }));
    await unlocked(t, <SharingScreen />);
    await screen.findByTestId('request-r1');
    expect(screen.queryByTestId('request-change-r1')).toBeNull();
    // Opened by its address all the same.
    await act(async () => push({ pathname: '/ask/[id]', params: { id: 'r1' } }));
    // Said to an owner, who may change anybody's, as the only reason there is.
    expect(await screen.findByTestId('ask-cannot-change')).toHaveTextContent(
      'That request has ended, so it can’t be changed. Make a new one if you need to.',
    );
    await fireEvent.press(screen.getByTestId('ask-instead'));
    expect(routes().at(-1)).toEqual({ pathname: '/ask', params: {} });
  });

  it('ended while the form was open (410): said, and it can’t be changed any more', async () => {
    const t = vault();
    t.vault.state.uploadRequests.push(request({ id: 'r1' }));
    await unlocked(t, <SharingScreen />);
    await fireEvent.press(await screen.findByTestId('request-change-r1'));
    await fireEvent.changeText(await screen.findByTestId('ask-label'), 'Jane');
    // Ended somewhere else meanwhile.
    Object.assign(t.vault.state.uploadRequests[0] as object, { state: 'revoked' });
    await fireEvent.press(screen.getByTestId('ask-save'));
    expect(await screen.findByTestId('ask-cannot-change')).toBeTruthy();
    expect(screen.getByTestId('ask-problem')).toHaveTextContent(/^That request no longer works, so it can’t be changed\./);
    expect(t.vault.state.uploadRequests[0]?.recipient_label).toBe('the accountant');
  });

  it('a typed password too long is said under it; the end’s problem is announced only once Save is pressed', async () => {
    const t = vault();
    t.vault.state.uploadRequests.push(request({ id: 'r1' }));
    await unlocked(t, <SharingScreen />);
    await fireEvent.press(await screen.findByTestId('request-change-r1'));
    await fireEvent.press(await screen.findByTestId('ask-end-other'));
    await fireEvent.changeText(screen.getByTestId('ask-day'), 'soon');
    expect(screen.getByTestId('ask-end-problem').props.accessibilityRole).not.toBe('alert');
    await fireEvent.press(screen.getByTestId('ask-secret-password'));
    await fireEvent.press(screen.getByTestId('ask-password-typed'));
    expect(screen.getByTestId('ask-password').props.maxLength).toBe(64);
    await fireEvent.changeText(screen.getByTestId('ask-password'), 'y'.repeat(65));
    expect(screen.getByText('At most 64 characters.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('ask-save'));
    expect(await screen.findByTestId('ask-put-right')).toBeTruthy();
    expect(screen.getByTestId('ask-end-problem').props.accessibilityRole).toBe('alert');
    expect(t.vault.state.uploadRequests[0]?.version).toBe(2);
  });

  it('an adult changes their own; a vault before LK offers no Change', async () => {
    const t = vault({ link_changes: false });
    t.vault.state.uploadRequests.push(request({ id: 'r1' }));
    await unlocked(t, <SharingScreen />, { before: as(t, 'adult') });
    await screen.findByTestId('request-r1');
    expect(screen.queryByTestId('request-change-r1')).toBeNull();
    expect(screen.getByTestId('requests-ask')).toBeTruthy();
  });
});
