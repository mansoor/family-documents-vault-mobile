import type { UploadRequestView } from '@fdv/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Linking from 'expo-linking';
import SharingScreen from '../app/sharing';
import { SecureTokenStore } from '../session/store';
import { EndedSharingCard } from '../settings/ended-sharing';
import { audit } from '../test-support/a11y';
import { unlocked } from '../test-support/lookup';
import { installed } from '../test-support/render';
import { resetRoutes, routes } from '../test-support/router';
import { caps0519, capabilities, testVault, type TestVault } from '../test-support/vault';

jest.mock(
  'expo-router',
  () => jest.requireActual<typeof import('../test-support/router')>('../test-support/router').routerMock,
);

const ORIGIN = 'https://vault.test';

beforeEach(() => {
  installed();
  resetRoutes();
});

/** A vault of 0.9.0-dev.53: requests listed as links are, shown again and changed (LK), ended ones kept a while. */
function vault(over: Record<string, boolean> = {}): TestVault {
  const t = testVault([ORIGIN]);
  t.caps = capabilities({
    server_version: '0.9.0',
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
  return t;
}

/** A request to send documents, as GET /upload-requests lists it. */
function request(over: Partial<UploadRequestView> & { id: string }): UploadRequestView {
  return {
    title: 'Tax papers 2025',
    message: null,
    items: [],
    recipient_label: 'the accountant',
    recipient_email: null,
    requested_by_name: 'Fake Owner',
    mine: true,
    created_at: '2026-11-10T10:00:00Z',
    expires_at: '2030-11-24T17:00:00Z',
    protection: ['password'],
    max_visits: 3,
    visits_used: 1,
    max_files: 20,
    files_used: 2,
    max_total_bytes: 100_000_000,
    bytes_used: 1000,
    accept_types: 'documents',
    review_by: 'me',
    suggested_member_id: null,
    suggested_type_key: null,
    close_after_submit: false,
    state: 'active',
    paused_reason: null,
    closed_reason: null,
    files_received: 2,
    ...over,
  } as UploadRequestView;
}

/** As an adult, whom the phone keeps as signed in so. */
const asAdult = (t: TestVault) => async () => {
  t.vault.state.role = 'adult';
  const store = new SecureTokenStore();
  const kept = await store.load();
  await store.save({ ...(kept as NonNullable<typeof kept>), role: 'adult' as never });
};

describe('Asking for documents, in Sharing (RQ)', () => {
  it('each request: what was asked, whom for, what came in, where it stands; Working now, then No longer working', async () => {
    const t = vault();
    t.vault.state.uploadRequests.push(
      request({ id: 'r1' }),
      request({
        id: 'r2',
        title: 'Lease',
        recipient_label: null,
        mine: false,
        requested_by_name: 'Sam',
        review_by: 'adults',
        state: 'closed',
        closed_reason: 'submitted',
        files_received: 1,
        max_visits: null,
        visits_used: 1,
        created_at: '2026-10-01T10:00:00Z',
      }),
    );
    // Made since the vault kept copies (LK): it can be shown again.
    t.vault.state.uploadRequestCopies = { r1: { token: 'drop-tok', password: 'plum-heron-27' } };
    await unlocked(t, <SharingScreen />);
    const row = await screen.findByTestId('request-r1');
    expect(row).toHaveTextContent(/“Tax papers 2025”For the accountant2 files received · 1 of 3 visits usedWorking until /);
    const ended = screen.getByTestId('requests-ended');
    expect(ended).toHaveTextContent(/No longer working/);
    expect(screen.getByTestId('request-r2')).toHaveTextContent(
      /“Lease”Asked by Sam · Any adult looks at what comes in|“Lease”Asked by SamAny adult looks at what comes in/,
    );
    expect(screen.getByTestId('request-state-r2')).toHaveTextContent('Closed when they finished sending');
    // Nothing to do with one that ended.
    expect(screen.queryByTestId('request-end-r2')).toBeNull();
    expect(screen.getByTestId('request-show-r1').props.accessibilityLabel).toBe(
      'Show the link for the request “Tax papers 2025”',
    );
    expect(audit()).toEqual([]);
  });

  it('Show the link: the link and its password, to send, copy or email', async () => {
    const t = vault();
    t.vault.state.operatorMail = true;
    t.vault.state.uploadRequests.push(request({ id: 'r1' }));
    t.vault.state.uploadRequestCopies = { r1: { token: 'drop-tok', password: 'plum-heron-27' } };
    await unlocked(t, <SharingScreen />);
    await fireEvent.press(await screen.findByTestId('request-show-r1'));
    expect(await screen.findByTestId('request-shown-link')).toHaveTextContent(/drop#drop-tok$/);
    expect(screen.getByTestId('request-shown-password')).toHaveTextContent('plum-heron-27');
    // Not selectable (0.19.0): only Copy puts it on the clipboard, and clears it in a minute.
    expect(screen.getByTestId('request-shown-link').props.selectable).toBeFalsy();
    expect(screen.getByTestId('request-shown-password').props.selectable).toBeFalsy();
    expect(screen.getByTestId('request-shown-send')).toBeTruthy();
    // Email the link, the vault's way for a request.
    await fireEvent.press(screen.getByTestId('request-shown-email-open'));
    await fireEvent.changeText(screen.getByTestId('request-shown-email-to'), 'jane@example.com');
    await fireEvent.press(screen.getByTestId('request-shown-email-send'));
    expect(await screen.findByTestId('request-shown-email-sent')).toHaveTextContent(/^Sent to j/);
    await fireEvent.press(screen.getByTestId('request-shown-done'));
    await waitFor(() => expect(screen.queryByTestId('request-shown-link')).toBeNull());
  });

  it('End this request, asked first: cancelled, it stands; ended, it moves down and what came stays', async () => {
    const t = vault();
    t.vault.state.uploadRequests.push(request({ id: 'r1' }));
    await unlocked(t, <SharingScreen />);
    await fireEvent.press(await screen.findByTestId('request-end-r1'));
    expect(await screen.findByText('End this request?')).toBeTruthy();
    expect(screen.getByTestId('request-end-question')).toHaveTextContent(
      /the accountant can no longer open it or send anything/,
    );
    await fireEvent.press(screen.getByTestId('request-end-cancel'));
    expect(t.vault.state.uploadRequests[0]?.state).toBe('active');
    await fireEvent.press(screen.getByTestId('request-end-r1'));
    await fireEvent.press(await screen.findByTestId('request-end-yes'));
    expect(await screen.findByTestId('sharing-said')).toHaveTextContent(
      'The request “Tax papers 2025” is ended. What was sent already stays.',
    );
    expect(t.vault.state.uploadRequests[0]?.state).toBe('revoked');
    await waitFor(() => expect(screen.queryByTestId('request-end-r1')).toBeNull());
    expect(screen.getByTestId('requests-none')).toHaveTextContent('No request works now.');
  });

  it('Change and Ask for documents open the phone’s own form (0.18.0), never the web', async () => {
    const t = vault();
    t.vault.state.uploadRequests.push(request({ id: 'r1' }));
    const opened = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await unlocked(t, <SharingScreen />);
    await fireEvent.press(await screen.findByTestId('request-change-r1'));
    expect(routes().at(-1)).toEqual({ pathname: '/ask/[id]', params: { id: 'r1' } });
    await fireEvent.press(await screen.findByTestId('ask-cancel'));
    await fireEvent.press(await screen.findByTestId('requests-ask'));
    expect(routes().at(-1)).toEqual({ pathname: '/ask', params: {} });
    expect(opened).not.toHaveBeenCalled();
    opened.mockRestore();
  });

  it('an owner turns on what a restore paused; a vault without requests shows none', async () => {
    const t = vault();
    t.vault.state.uploadRequests.push(request({ id: 'r1', state: 'paused', paused_reason: 'restored' }));
    await unlocked(t, <SharingScreen />);
    expect(await screen.findByTestId('request-state-r1')).toHaveTextContent('Paused after a restore');
    await fireEvent.press(screen.getByTestId('request-resume-r1'));
    expect(await screen.findByTestId('sharing-said')).toHaveTextContent('The request “Tax papers 2025” works again.');

    const older = vault({ upload_requests: false });
    await unlocked(older, <SharingScreen />);
    await screen.findByTestId('sharing-none');
    expect(screen.queryByTestId('requests')).toBeNull();
  });
});

describe('Links and requests that no longer work, in Settings (RQ)', () => {
  it('an owner chooses: sooner is asked first, saying what goes; later is saved at once', async () => {
    const t = vault();
    await unlocked(t, <EndedSharingCard />);
    const ninety = await screen.findByTestId('ended-sharing-90');
    expect(ninety.props.accessibilityState).toEqual(expect.objectContaining({ checked: true }));
    expect(ninety.props.accessibilityLabel).toBe('After 90 days (the default)');
    expect(screen.getByTestId('ended-sharing-save').props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByTestId('ended-sharing-30'));
    await fireEvent.press(screen.getByTestId('ended-sharing-save'));
    expect(await screen.findByText('Remove them sooner?')).toBeTruthy();
    expect(screen.getByTestId('ended-sharing-question')).toHaveTextContent(
      /ended more than 30 days ago will be removed from Sharing the next night/,
    );
    await fireEvent.press(screen.getByTestId('ended-sharing-yes'));
    expect(await screen.findByTestId('ended-sharing-said')).toHaveTextContent('Saved: After 30 days.');
    expect(t.vault.state.endedSharingDays).toBe(30);
    // Never removes later: nothing asked.
    await fireEvent.press(screen.getByTestId('ended-sharing-never'));
    await fireEvent.press(screen.getByTestId('ended-sharing-save'));
    expect(await screen.findByTestId('ended-sharing-said')).toHaveTextContent('Saved: Never.');
    expect(t.vault.state.endedSharingDays).toBeNull();
  });

  it('an adult reads it, and who may change it', async () => {
    const t = vault();
    await unlocked(t, <EndedSharingCard />, { before: asAdult(t) });
    expect(await screen.findByTestId('ended-sharing-now')).toHaveTextContent(
      'Links and requests that no longer work are removed 90 days after they end.',
    );
    expect(screen.getByTestId('ended-sharing-owners')).toHaveTextContent(/Only an owner/);
    expect(screen.queryByTestId('ended-sharing-save')).toBeNull();
  });

  it('an older vault: not shown', async () => {
    const t = vault({ ended_sharing: false });
    await unlocked(t, <EndedSharingCard />);
    await waitFor(() => expect(screen.queryByTestId('lock-unlock')).toBeNull());
    expect(screen.queryByTestId('ended-sharing')).toBeNull();
  });
});
