import type * as Shared from '@fdv/shared';

/**
 * The same inputs through @fdv/shared's helpers, as strings. Run under Node
 * they become node-snapshots.json (scripts/gen-shared-snapshots.mts); run
 * under Hermes on a phone (probe P1) they show whether the phone formats a
 * date, a status or a reminder the way the vault and the web do. Any
 * difference — one Intl says "Sept" where another says "Sep" — is a
 * difference a person would see.
 */
export function sharedCases(s: typeof Shared): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (key: string, value: unknown) => {
    out[key] = typeof value === 'string' ? value : JSON.stringify(value);
  };

  put('formatDate day', s.formatDate({ date: '2031-03-14', precision: 'day' }));
  put('formatDate september', s.formatDate({ date: '2026-09-05', precision: 'day' }));
  put('formatDate month', s.formatDate({ date: '2031-03-31', precision: 'month' }));
  put('formatDate year', s.formatDate({ date: '2031-12-31', precision: 'year' }));

  for (const input of ['2031-03-14', '14/03/2031', 'March 2031', '2031-03', '2031', '14 Mar 2031', ' 2031 ', 'not a date']) {
    put(`parseDateInput ${JSON.stringify(input)}`, s.parseDateInput(input));
  }

  const now = new Date('2026-09-23T16:00:00Z');
  for (const iso of [
    '2026-09-23T14:05:00Z',
    '2026-09-22T09:30:00Z',
    '2026-09-17T12:00:00Z',
    '2026-06-01T08:00:00Z',
    '2025-01-15T20:45:00Z',
  ]) {
    put(`whenWords ${iso}`, s.whenWords(iso, now));
  }

  const passport = { key: 'passport', expiry_driver: 'expires', reminder_leads: [270, 180] };
  const today = '2026-09-23';
  const statuses: [string, Shared.StatusInput][] = [
    ['no type', { type: null, owner_member_id: 'm', expires: null }],
    ['no owner', { type: passport, owner_member_id: null, expires: null }],
    ['no expiry rule', { type: { key: 'birth_certificate', expiry_driver: null, reminder_leads: [] }, owner_member_id: 'm', expires: null }],
    ['expiring', { type: passport, owner_member_id: 'm', expires: { date: '2027-03-01', precision: 'day' } }],
    ['expired', { type: passport, owner_member_id: 'm', expires: { date: '2026-09-01', precision: 'day' } }],
    ['valid', { type: passport, owner_member_id: 'm', expires: { date: '2031-03-14', precision: 'day' } }],
    ['superseded', { type: passport, owner_member_id: 'm', expires: null, superseded: true }],
  ];
  for (const [name, doc] of statuses) put(`deriveStatus ${name}`, s.deriveStatus(doc, today));

  put('reminderLabel today', s.reminderLabel('2026-09-23', today, 'due', null));
  put('reminderLabel future', s.reminderLabel('2026-10-05', today, 'scheduled', null));
  put('reminderLabel tomorrow', s.reminderLabel('2026-09-24', today, 'scheduled', null));
  put('reminderLabel overdue', s.reminderLabel('2026-09-20', today, 'due', null));
  put('reminderLabel snoozed', s.reminderLabel('2026-09-20', today, 'snoozed', '2026-10-01'));

  // The search tokeniser's pattern: Unicode property escapes under Hermes.
  put('unicode letters', 'Zoë 2031 Ünïcödé — ok'.match(/[\p{L}\p{N}]+/gu));
  return out;
}
