import type { DocumentTypeView } from '@fdv/shared';
import {
  chooseOwner,
  chooseType,
  newDraft,
  readDetail,
  toMetadata,
  visibilityChoices,
  visibilityOf,
  type Household,
} from './draft';
import { exportRuns, split, TimingRecorder, loadRuns } from './timings';
import { matchTypes, rankTypes } from './types';
import { detailInput } from './ui';

const type = (key: string, label: string, over: Partial<DocumentTypeView> = {}): DocumentTypeView => ({
  key,
  label,
  category: 'other',
  fields: [],
  expiry_driver: null,
  reminder_leads: [],
  usually_essential: false,
  default_visibility: 'household',
  ...over,
});

const TYPES = [
  type('passport', 'Passport', {
    expiry_driver: 'expires_on',
    usually_essential: true,
  }),
  type('bank_statement', 'Bank / investment statement', {
    default_visibility: 'adults',
  }),
  type('utility_bill', 'Utility / bill'),
  type('pet_record', 'Pet records'),
  type('warranty', 'Warranty / receipt'),
  type('other', 'Something else'),
];

describe('the type chips', () => {
  it('what the household files most comes first, then the usual first ones; Something else is never a chip', () => {
    const { top, rest } = rankTypes(TYPES, ['pet_record', 'pet_record', 'warranty', null], 4);
    expect(top.map((t) => t.key)).toEqual(['pet_record', 'warranty', 'passport', 'bank_statement']);
    expect(rest.map((t) => t.key)).toEqual(['other', 'utility_bill']);
  });

  it('More… finds a kind by any of its words', () => {
    expect(matchTypes(TYPES, 'bill').map((t) => t.key)).toEqual(['utility_bill']);
    expect(matchTypes(TYPES, 'INVEST state').map((t) => t.key)).toEqual(['bank_statement']);
    expect(matchTypes(TYPES, '')).toHaveLength(TYPES.length);
  });

  it('a kind the household has hidden is not offered, not even as one of the usual first ones', () => {
    // The vault still lists it while a document uses it (0.5.6), so that document's kind is known.
    const hidden = TYPES.map((t) => (t.key === 'passport' ? { ...t, hidden: true } : t));
    const { top, rest } = rankTypes(hidden, ['passport', 'passport', 'warranty'], 4);
    expect(top.map((t) => t.key)).toEqual(['warranty', 'bank_statement', 'utility_bill']);
    expect(rest.map((t) => t.key)).toEqual(['pet_record', 'other']);
    expect(matchTypes(hidden, 'pass')).toEqual([]);
  });
});

describe('a type’s details on the card (custom_types)', () => {
  const car = type('h_car0000000', 'Car', {
    fields: [
      { key: 'plate', label: 'Registration plate', kind: 'text', required: true },
      { key: 'first_registered', label: 'First registered', kind: 'date' },
      { key: 'seats', label: 'Seats', kind: 'number' },
      { key: 'fuel', label: 'Fuel', kind: 'choice', choices: ['Petrol', 'Electric'] },
      { key: 'financed', label: 'On finance', kind: 'yes_no', required: true },
    ],
  });
  const passport = type('passport', 'Passport', {
    expiry_driver: 'expires_on',
    core: {
      identifier: { shown: true, required: true, label: 'Passport number' },
      issued_by: { shown: true, required: false, label: 'Issuing country' },
      issued: { shown: true, required: false, label: null },
      expires: { shown: true, required: true, label: null },
      physical_location: { shown: false, required: false, label: null },
      tags: { shown: true, required: false, label: null },
      notes: { shown: true, required: true, label: null },
    },
  });
  const h: Household = {
    types: [car, passport],
    members: [{ id: 'me', display_name: 'Aisha' }],
    me: { member_id: 'me', role: 'owner' },
    issuedBy: true,
    details: true,
  };
  const source = { kind: 'pages' as const, pages: [{ uri: 'cache:/1.jpg' }] };

  it('waits for what the type requires among what the card asks, and sends each detail as its kind', () => {
    let d = chooseType(newDraft(source, h.me), 'h_car0000000');
    // A required yes/no left alone says no, as its switch shows: only the plate is missing.
    expect(toMetadata(d, h).missing).toEqual(['plate']);
    d = { ...d, details: { plate: ' AB12 CDE ', first_registered: 'March 2019', seats: '5', fuel: 'Electric' } };
    const out = toMetadata(d, h);
    expect(out.missing).toEqual([]);
    expect(out.metadata.extra).toEqual({
      plate: 'AB12 CDE',
      first_registered: { date: '2019-03-31', precision: 'month' },
      seats: 5,
      fuel: 'Electric',
      financed: false,
    });
    // One it cannot read is said on the detail itself, and nothing is sent.
    expect(toMetadata({ ...d, details: { ...d.details, seats: 'five' } }, h).fields).toEqual({
      'detail:seats': 'That should be a number, such as 42.',
    });
    // Offline too, the vault's own check: an answer the field does not offer.
    expect(toMetadata({ ...d, details: { ...d.details, fuel: 'Diesel' } }, h).fields).toEqual({
      'detail:fuel': 'Fuel must be one of: Petrol, Electric.',
    });
  });

  it('a decimal comma is never read as thousands: 12,50 is refused, not kept as 1250', () => {
    const money = { kind: 'money', required: false } as const;
    const number = { kind: 'number', required: false } as const;
    expect(readDetail(money, '12,50')).toEqual({ message: 'Use a point for pence, such as 12.50.' });
    expect(readDetail(money, '£125,00')).toEqual({ message: 'Use a point for pence, such as 12.50.' });
    expect(readDetail(number, '3,5')).toEqual({ message: 'Use a point for a decimal, such as 3.5.' });
    // A comma that groups thousands is read so, as the web card reads it.
    expect(readDetail(money, '£1,234.50')).toEqual({ value: 1234.5 });
    expect(readDetail(money, '12.50')).toEqual({ value: 12.5 });
    expect(readDetail(number, '1,234')).toEqual({ value: 1234 });
    expect(readDetail(number, '-3.5')).toEqual({ value: -3.5 });
    // Written out in figures only: not hexadecimal, not an exponent.
    expect(readDetail(number, '0x10')).toEqual({ message: 'That should be a number, such as 42.' });
    expect(readDetail(number, '1e3')).toEqual({ message: 'That should be a number, such as 42.' });
    // On the card: said on the detail, and nothing is sent.
    const d = { ...chooseType(newDraft(source, h.me), 'h_car0000000'), details: { plate: 'AB12 CDE', seats: '3,5' } };
    expect(toMetadata(d, h).fields).toEqual({ 'detail:seats': 'Use a point for a decimal, such as 3.5.' });
  });

  it('a fixed field the type hides is neither asked for nor sent; one the card has no box for is not waited for', () => {
    const d = { ...chooseType(newDraft(source, h.me), 'passport'), location: 'The safe', identifier: '' };
    const out = toMetadata(d, h);
    expect(out.missing).toEqual(['identifier', 'expires']);
    expect(out.metadata).not.toHaveProperty('physical_location');
    // Without custom_types, as in 0.2.0: nothing waited for, nothing new sent.
    const old = toMetadata({ ...d, details: { plate: 'X' } }, { ...h, details: false });
    expect(old.missing).toEqual([]);
    expect(old.metadata).toMatchObject({ physical_location: 'The safe' });
    expect(old.metadata).not.toHaveProperty('extra');
  });
});

describe('the keyboard for a detail', () => {
  // The keyboards React Native's Android text input knows (ReactTextInputManager's
  // setKeyboardType); any other opens the letters.
  const ANDROID = [
    ...['default', 'numeric', 'number-pad', 'decimal-pad'],
    ...['email-address', 'phone-pad', 'visible-password', 'url'],
  ];

  it('a number, an amount and a year open the numbers on Android, the first shipped', () => {
    for (const kind of ['number', 'money', 'year']) {
      const keyboard = detailInput(kind, 'android')?.keyboardType;
      expect([kind, ANDROID.includes(keyboard ?? '') && keyboard !== 'default']).toEqual([kind, true]);
    }
    // A number may have a sign and a point.
    expect(detailInput('number', 'android')?.keyboardType).toBe('numeric');
    // iOS: numbers and punctuation, which always has the point a decimal is written with.
    expect(detailInput('number', 'ios')?.keyboardType).toBe('numbers-and-punctuation');
    expect(detailInput('money', 'ios')?.keyboardType).toBe('numbers-and-punctuation');
    expect(detailInput('year', 'ios')?.keyboardType).toBe('number-pad');
    expect(detailInput('text', 'android')).toEqual({ autoCapitalize: 'sentences' });
  });
});

describe('a teen’s card', () => {
  const h: Household = {
    types: TYPES,
    members: [
      { id: 'sam', display_name: 'Sam' },
      { id: 'mum', display_name: 'Aisha' },
    ],
    me: { member_id: 'sam', role: 'teen' },
    issuedBy: true,
    details: false,
  };
  const source = { kind: 'pages' as const, pages: [{ uri: 'cache:/1.jpg' }] };

  it('is theirs, and stays theirs', () => {
    const d = newDraft(source, h.me);
    expect(d.ownerId).toBe('sam');
    expect(chooseOwner(d, 'mum', h).ownerId).toBe('sam');
  });

  it('never files Adults only: a kind that usually is starts at their Only me (A71), and Everyone is still theirs to choose', () => {
    const d = chooseType(newDraft(source, h.me), 'bank_statement');
    expect(visibilityOf(d, h)).toBe('private');
    expect(visibilityChoices(d, h)).toEqual({
      household: true,
      adults: false,
      private: true,
    });
    expect(toMetadata(d, h)).toMatchObject({ problem: null, metadata: { visibility: 'private', owner_member_id: 'sam' } });
    expect(toMetadata({ ...d, visibility: 'household' }, h).metadata.visibility).toBe('household');
  });

  it('an adult’s own document of an Adults only kind stays Adults only', () => {
    const adult: Household = { ...h, me: { member_id: 'mum', role: 'adult' } };
    const d = chooseOwner(chooseType(newDraft(source, adult.me), 'bank_statement'), 'mum', adult);
    expect(visibilityOf(d, adult)).toBe('adults');
    expect(toMetadata(d, adult)).toMatchObject({ problem: null, metadata: { visibility: 'adults' } });
  });

  it('says who issued it only to a vault that takes it', () => {
    const d = {
      ...chooseType(newDraft(source, h.me), 'utility_bill'),
      issuedBy: '  British   Gas ',
    };
    expect(toMetadata(d, h).metadata).toMatchObject({
      issued_by: 'British Gas',
      title: 'British Gas bill',
    });
    expect(toMetadata(d, { ...h, issuedBy: false }).metadata).not.toHaveProperty('issued_by');
  });
});

describe('timings', () => {
  it('keeps each stage from the tap, and the vault’s answer when it comes', () => {
    let now = 1_000;
    const rec = new TimingRecorder(() => now);
    rec.start('scan');
    now = 1_040;
    rec.mark('scanner_shown');
    now = 9_200;
    rec.mark('pages_accepted', 2);
    now = 9_500;
    rec.mark('card_shown');
    now = 15_100;
    rec.mark('save');
    now = 15_600;
    rec.queued('item-1');
    now = 17_900;
    rec.created('item-1');
    const [run] = loadRuns();
    expect(run).toMatchObject({
      kind: 'scan',
      pages: 2,
      marks: {
        tap: 0,
        scanner_shown: 40,
        pages_accepted: 8_200,
        card_shown: 8_500,
        save: 14_100,
        queued: 14_600,
        created: 16_900,
      },
    });
    expect(split(run!).find((s) => s.from === 'card_shown')).toEqual({
      from: 'card_shown',
      to: 'save',
      ms: 5_600,
    });
  });

  it('shares times only: nothing that ties a run to a document', () => {
    const rec = new TimingRecorder(() => 0);
    rec.start('file');
    rec.queued('item-9');
    expect(exportRuns(loadRuns())).not.toContain('item-9');
  });

  it('keeps the last twenty', () => {
    const rec = new TimingRecorder(() => 0);
    for (let i = 0; i < 25; i += 1) {
      rec.start('scan');
      rec.queued(`item-${i}`);
    }
    expect(loadRuns()).toHaveLength(20);
    expect(loadRuns()[0]?.item).toBe('item-5');
  });
});
