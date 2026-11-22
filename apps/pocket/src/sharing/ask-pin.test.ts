import type { UploadRequestView } from '@fdv/shared';
import { ASK_START, readAsk, readRequestChange, startRequestChange } from './ask-model';

// A request's PIN (a vault with `upload_request_pin`), as a share link's: the
// vault makes it up and shows it once, and never with a password.

const zone = 'Europe/London';
const ctx = { timezone: zone, emailCode: false };

function request(over: Partial<UploadRequestView> = {}): UploadRequestView {
  return {
    id: 'r1',
    title: 'Tax papers 2025',
    message: null,
    items: [],
    recipient_label: null,
    recipient_email: null,
    requested_by_name: 'Fake Owner',
    mine: true,
    created_at: new Date(Date.now() - 864e5).toISOString(),
    expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
    protection: [],
    max_visits: null,
    visits_used: 0,
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

describe('a request’s PIN', () => {
  it('is asked for where the vault makes one, and never with a password', () => {
    const v = { ...ASK_START, title: 'Tax papers', withPin: true, withPassword: true };
    const body = readAsk(v, { ...ctx, pins: true }).body;
    expect(body?.with_pin).toBe(true);
    expect(body?.with_password).toBeUndefined();
    expect(body?.password).toBeUndefined();
  });

  it('an older vault is never sent one: the password stands as chosen', () => {
    const v = { ...ASK_START, title: 'Tax papers', withPin: true, withPassword: true };
    const body = readAsk(v, ctx).body;
    expect(body?.with_pin).toBeUndefined();
    expect(body?.with_password).toBe(true);
  });

  it('changed: a new PIN is asked of the vault, and one taken away goes', () => {
    const r = request({ protection: ['pin'] });
    const start = startRequestChange(r, zone);
    const pin = readRequestChange(r, { ...start, secret: 'pin' }, { timezone: zone });
    expect(pin.hasPin).toBe(true);
    expect(pin.body.secret).toBe('pin');
    expect(readRequestChange(r, { ...start, secret: 'none' }, { timezone: zone }).body.secret).toBe('none');
    expect(readRequestChange(r, start, { timezone: zone }).nothing).toBe(true);
  });

  it('only whoever asked changes it', () => {
    const r = request({ protection: ['pin'], mine: false });
    const start = startRequestChange(r, zone);
    expect(readRequestChange(r, { ...start, secret: 'pin' }, { timezone: zone }).body.secret).toBeUndefined();
  });
});
