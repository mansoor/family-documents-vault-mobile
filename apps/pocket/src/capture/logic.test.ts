import type { DocumentTypeView } from '@fdv/shared';
import {
  chooseOwner,
  chooseType,
  newDraft,
  toMetadata,
  visibilityChoices,
  visibilityOf,
  type Household,
} from './draft';
import { exportRuns, split, TimingRecorder, loadRuns } from './timings';
import { matchTypes, rankTypes } from './types';

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
  };
  const source = { kind: 'pages' as const, pages: [{ uri: 'cache:/1.jpg' }] };

  it('is theirs, and stays theirs', () => {
    const d = newDraft(source, h.me);
    expect(d.ownerId).toBe('sam');
    expect(chooseOwner(d, 'mum', h).ownerId).toBe('sam');
  });

  it('never files Adults only, even for a type that usually is', () => {
    const d = chooseType(newDraft(source, h.me), 'bank_statement');
    expect(visibilityOf(d, h)).toBe('household');
    expect(visibilityChoices(d, h)).toEqual({
      household: true,
      adults: false,
      private: true,
    });
    expect(toMetadata(d, h).problem).toBeNull();
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
