import {
  BLOOD_TYPES,
  EMERGENCY_LIST_MAX,
  EMERGENCY_NAME_MAX,
  EMERGENCY_NOTE_MAX,
  EMERGENCY_NOTES_MAX,
  type BloodType,
  type EmergencyAudience,
  type EmergencyCandidate,
  type EmergencyFields,
} from '@fdv/shared';

/**
 * Editing a person's emergency information on the phone (app 0.19.0; the
 * vault's H4), by the web's rules (apps/web/src/emergency.tsx,
 * EmergencyEditor) and the vault's (emergency/service.ts): the whole page
 * is sent, made from the version read (If-Match), every part as typed —
 * trimmed, a blank left out. Pure, so the rules are tested without a screen.
 *
 * Nothing is read into what was typed, checked or suggested: it files it.
 */

/** The page's lists, in its order. */
export const LIST_KEYS = ['allergies', 'medications', 'conditions', 'doctors', 'emergency_contacts'] as const;
export type ListKey = (typeof LIST_KEYS)[number];

/** What an entry has besides its name. */
export type Part = 'dose' | 'role' | 'phone' | 'note';

/** What each list asks of an entry, besides its name (the web's LIST_PARTS). */
export const LIST_PARTS: Record<ListKey, readonly Part[]> = {
  allergies: ['note'],
  medications: ['dose', 'note'],
  conditions: ['note'],
  doctors: ['role', 'phone', 'note'],
  emergency_contacts: ['role', 'phone', 'note'],
};

/** The most each part of an entry takes, as the vault takes it. */
export const PART_MAX: Record<Part | 'name', number> = {
  name: EMERGENCY_NAME_MAX,
  dose: EMERGENCY_NAME_MAX,
  role: EMERGENCY_NAME_MAX,
  phone: 40,
  note: EMERGENCY_NOTE_MAX,
};

/** Insurance's parts, and the most each takes. */
export const INSURANCE_PARTS = ['insurer', 'member_id', 'group_number', 'phone'] as const;
export type InsurancePart = (typeof INSURANCE_PARTS)[number];
export const INSURANCE_MAX: Record<InsurancePart, number> = {
  insurer: EMERGENCY_NAME_MAX,
  member_id: 60,
  group_number: 60,
  phone: 40,
};

export const NOTES_MAX = EMERGENCY_NOTES_MAX;
export const LIST_MAX = EMERGENCY_LIST_MAX;
export { BLOOD_TYPES };

/** An entry as the form keeps it: every part a string. */
export interface Entry {
  id: string;
  name: string;
  dose: string;
  role: string;
  phone: string;
  note: string;
}

/** The page as the form keeps it. */
export interface Draft {
  blood: BloodType | '';
  lists: Record<ListKey, Entry[]>;
  insurance: Record<InsurancePart, string>;
  notes: string;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** The form, filled from the page as the vault has it. */
export function draftOf(fields: EmergencyFields): Draft {
  const lists = {} as Record<ListKey, Entry[]>;
  for (const key of LIST_KEYS) {
    lists[key] = ((fields[key] ?? []) as unknown as Record<string, unknown>[]).map((e) => ({
      id: str(e.id),
      name: str(e.name),
      dose: str(e.dose),
      role: str(e.role),
      phone: str(e.phone),
      note: str(e.note),
    }));
  }
  const ins = fields.insurance ?? {};
  return {
    blood: fields.blood_type && (BLOOD_TYPES as readonly string[]).includes(fields.blood_type) ? fields.blood_type : '',
    lists,
    insurance: {
      insurer: str(ins.insurer),
      member_id: str(ins.member_id),
      group_number: str(ins.group_number),
      phone: str(ins.phone),
    },
    notes: str(fields.notes),
  };
}

let made = 0;
/** A new entry's id: letters and digits, as the vault asks (`[A-Za-z0-9_-]{1,40}`). */
export function newEntryId(now: number = Date.now()): string {
  made += 1;
  return `p${now.toString(36)}${made.toString(36)}`;
}

/** A new, empty entry. */
export const newEntry = (): Entry => ({ id: newEntryId(), name: '', dose: '', role: '', phone: '', note: '' });

/** Nothing typed in it at all: it is left out, and taken away without asking. */
export const entryBlank = (e: Entry): boolean =>
  !e.name.trim() && !e.dose.trim() && !e.role.trim() && !e.phone.trim() && !e.note.trim();

/** Anything in the insurance part. */
export const insuranceTyped = (d: Draft): boolean => INSURANCE_PARTS.some((p) => d.insurance[p].trim() !== '');

/** The entries of a list with something typed. */
export const typedEntries = (d: Draft, key: ListKey): Entry[] => d.lists[key].filter((e) => !entryBlank(e));

/** An entry as the vault takes it: its id, its name, and the parts typed. */
function entryOut(e: Entry, parts: readonly Part[]): Record<string, string> {
  const out: Record<string, string> = { id: e.id, name: e.name.trim() };
  for (const p of parts) {
    const v = e[p].trim();
    if (v) out[p] = v;
  }
  return out;
}

/** What Save sends, or the entries that need a name first. */
export type Reading = { fields: EmergencyFields; unnamed: [] } | { fields: null; unnamed: { key: ListKey; id: string }[] };

/**
 * The page to send: blanks left out, as the web sends it. An entry with
 * something typed but no name is not left out quietly (the web drops it):
 * it is said where it is, in the vault's words, and nothing is sent.
 */
export function readDraft(d: Draft): Reading {
  const unnamed: { key: ListKey; id: string }[] = [];
  const fields: EmergencyFields = {
    blood_type: d.blood || null,
    notes: d.notes.trim() || null,
    insurance: insuranceTyped(d)
      ? {
          insurer: d.insurance.insurer.trim() || null,
          member_id: d.insurance.member_id.trim() || null,
          group_number: d.insurance.group_number.trim() || null,
          phone: d.insurance.phone.trim() || null,
        }
      : null,
  };
  for (const key of LIST_KEYS) {
    const kept = typedEntries(d, key);
    for (const e of kept) if (!e.name.trim()) unnamed.push({ key, id: e.id });
    (fields as Record<string, unknown>)[key] = kept.map((e) => entryOut(e, LIST_PARTS[key]));
  }
  return unnamed.length > 0 ? { fields: null, unnamed } : { fields, unnamed: [] };
}

/**
 * The page as it would be kept, for "has anything changed": what the vault
 * keeps (its `tidy`) — blanks, empty lists and an empty insurance gone.
 */
function kept(d: Draft): string {
  const out: Record<string, unknown> = {};
  if (d.blood) out.blood_type = d.blood;
  for (const key of LIST_KEYS) {
    const list = typedEntries(d, key).map((e) => entryOut(e, LIST_PARTS[key]));
    if (list.length) out[key] = list;
  }
  const ins = Object.fromEntries(INSURANCE_PARTS.map((p) => [p, d.insurance[p].trim()]).filter(([, v]) => v));
  if (Object.keys(ins).length) out.insurance = ins;
  if (d.notes.trim()) out.notes = d.notes.trim();
  return JSON.stringify(out);
}

/** Whether the form says anything different from the page it was opened on. */
export const draftChanged = (d: Draft, from: EmergencyFields): boolean => kept(d) !== kept(draftOf(from));

/** A list with the entry taken out. */
export const without = (d: Draft, key: ListKey, id: string): Draft => ({
  ...d,
  lists: { ...d.lists, [key]: d.lists[key].filter((e) => e.id !== id) },
});

/** A list's entry with one part changed. */
export const withPart = (d: Draft, key: ListKey, id: string, part: keyof Omit<Entry, 'id'>, value: string): Draft => ({
  ...d,
  lists: { ...d.lists, [key]: d.lists[key].map((e) => (e.id === id ? { ...e, [part]: value } : e)) },
});

/** A list with a new, empty entry at its end — never past the most the vault keeps. */
export const withNew = (d: Draft, key: ListKey): Draft =>
  d.lists[key].length >= LIST_MAX ? d : { ...d, lists: { ...d.lists, [key]: [...d.lists[key], newEntry()] } };

/** A part of the page emptied: a list, the insurance, or the other information. */
export type Clearable = ListKey | 'insurance' | 'notes';

export function cleared(d: Draft, what: Clearable): Draft {
  if (what === 'insurance') return { ...d, insurance: { insurer: '', member_id: '', group_number: '', phone: '' } };
  if (what === 'notes') return { ...d, notes: '' };
  return { ...d, lists: { ...d.lists, [what]: [] } };
}

/** Who sees a page besides the person, the owners and a caregiver: an audience, and people named. */
export interface Readers {
  audience: EmergencyAudience;
  chosen: readonly string[];
}

/** Whether somebody who may be named (an adult or a teen) sees a page, as the vault decides it. */
export const sees = (page: Readers, c: Pick<EmergencyCandidate, 'member_id' | 'role'>): boolean =>
  (c.role === 'adult' && (page.audience === 'adults' || page.audience === 'family')) ||
  (c.role === 'teen' && page.audience === 'family') ||
  page.chosen.includes(c.member_id);

/**
 * Whoever a new choice takes the page away from: of those who may be named,
 * the ones who see it now and would not. The vault ends their exports.
 */
export const losing = (
  before: Readers,
  after: Readers,
  candidates: readonly Pick<EmergencyCandidate, 'member_id' | 'role'>[],
): string[] => candidates.filter((c) => sees(before, c) && !sees(after, c)).map((c) => c.member_id);

/**
 * The people named, as the form starts with them: only those who may still
 * be named (the vault refuses anybody else), and the names of those left off
 * — somebody named before who is now a viewer or an owner.
 */
export function chosenToStart(
  chosen: readonly { member_id: string; name: string }[],
  candidates: readonly Pick<EmergencyCandidate, 'member_id'>[],
): { ids: string[]; dropped: string[] } {
  const may = new Set(candidates.map((c) => c.member_id));
  return {
    ids: chosen.filter((c) => may.has(c.member_id)).map((c) => c.member_id),
    dropped: chosen.filter((c) => !may.has(c.member_id)).map((c) => c.name),
  };
}
