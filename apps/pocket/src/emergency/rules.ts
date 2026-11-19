import {
  EMERGENCY_FIELD_KEYS,
  EMERGENCY_FIELD_LABELS,
  EMERGENCY_LINK_MAX_HOURS,
  emergencyFilled,
  formatDate,
  type Capabilities,
  type EmergencyFieldKey,
  type EmergencyItem,
  type EmergencyLink,
  type EmergencyMedication,
  type EmergencyPerson,
  type EmergencyView,
  type Role,
} from '@fdv/shared';
import type { TFunction } from 'i18next';

/**
 * Emergency information on the phone (app 0.15.0; the vault's
 * 0.9.0-dev.47, H4 of the health plan), by the web's rules
 * (apps/web/src/emergency.tsx). Pure, so the rules are tested without
 * drawing a screen.
 *
 * What is on a page is typed here since app 0.19.0 (edit-model.ts), and
 * who sees it chosen and its wallet card made, as on the web. A clinician's
 * link is made, shown and taken back here, as the web does it. It files and
 * shows what was typed: nothing is read into it, checked or suggested.
 * Never kept on the phone: a page lives in the screen's memory while it is
 * shown, as identity details do.
 */

/** The vault has emergency information at all. */
export const emergencyOn = (caps: Capabilities | null | undefined): boolean => caps?.features.emergency_info === true;

/** More -> Emergency information: whoever may read a page — never a viewer, and so never a guest. */
export const emergencyOffered = (caps: Capabilities | null | undefined, role: Role | null | undefined): boolean =>
  emergencyOn(caps) && !!role && role !== 'viewer';

/** How long a clinician's link may last, the web's choices (hours). */
export const LINK_HOURS: readonly number[] = [1, 2, 4, 8, 12, 24].filter((h) => h <= EMERGENCY_LINK_MAX_HOURS);

/** A list's entry on one line, as typed: "Penicillin · Rash", "Metformin · 500 mg twice a day". */
export function itemLine(i: EmergencyItem | EmergencyMedication | EmergencyPerson): string {
  const parts = [i.name];
  if ('dose' in i && i.dose) parts.push(i.dose);
  if ('role' in i && i.role) parts.push(i.role);
  if ('phone' in i && i.phone) parts.push(i.phone);
  if (i.note) parts.push(i.note);
  return parts.join(' · ');
}

/** One part of a page, as it is shown: its name and its lines. */
export interface Section {
  key: EmergencyFieldKey;
  label: string;
  lines: string[];
}

/** The parts with something on them, in the page's order (`EMERGENCY_FIELD_KEYS`). */
export function sections(view: Pick<EmergencyView, 'fields' | 'date_of_birth'>, t: TFunction): Section[] {
  const f = view.fields;
  const filled = new Set(emergencyFilled(f, view.date_of_birth));
  const out: Section[] = [];
  for (const key of EMERGENCY_FIELD_KEYS) {
    if (!filled.has(key)) continue;
    let lines: string[] = [];
    if (key === 'date_of_birth' && view.date_of_birth) {
      lines = [formatDate({ date: view.date_of_birth, precision: 'day' })];
    } else if (key === 'blood_type' && f.blood_type) {
      lines = [f.blood_type];
    } else if (key === 'notes' && f.notes) {
      lines = [f.notes.trim()];
    } else if (key === 'insurance' && f.insurance) {
      const ins = f.insurance;
      lines = [
        ins.insurer,
        ins.member_id ? t('emergency.memberId', { id: ins.member_id }) : null,
        ins.group_number ? t('emergency.group', { group: ins.group_number }) : null,
        ins.phone,
      ].filter((x): x is string => !!x);
    } else if (
      key === 'allergies' ||
      key === 'medications' ||
      key === 'conditions' ||
      key === 'doctors' ||
      key === 'emergency_contacts'
    ) {
      lines = ((f[key] ?? []) as (EmergencyItem | EmergencyMedication | EmergencyPerson)[]).map(itemLine);
    }
    if (lines.length > 0) out.push({ key, label: EMERGENCY_FIELD_LABELS[key], lines });
  }
  return out;
}

/** Who can see a page besides the person and the owners, in words about this person. */
export function audienceWords(view: Pick<EmergencyView, 'audience' | 'chosen'>, mine: boolean, name: string, t: TFunction): string {
  const named = view.chosen.map((c) => c.name).join(', ');
  const base =
    view.audience === 'owners_and_self'
      ? mine
        ? t('emergency.audienceSelfMine')
        : t('emergency.audienceSelf', { name })
      : view.audience === 'adults'
        ? mine
          ? t('emergency.audienceAdultsMine')
          : t('emergency.audienceAdults', { name })
        : t('emergency.audienceFamily');
  return named ? t('emergency.audienceNamed', { base, named }) : `${base}.`;
}

/** A browser, in a few words, from what it said it was (the web's browserWords). */
export function browserWords(agent: string | null, t: TFunction): string {
  if (!agent) return t('emergency.aBrowser');
  const known = /(Edg|Firefox|Chrome|Safari)\/[\d.]+/.exec(agent);
  return known ? (known[1] === 'Edg' ? 'Edge' : (known[1] as string)) : agent.slice(0, 60);
}

/** What a clinician's link shows, in words: "allergies, medications". */
export const showsWords = (l: Pick<EmergencyLink, 'emergency_fields'>): string =>
  l.emergency_fields.map((k) => EMERGENCY_FIELD_LABELS[k].toLowerCase()).join(', ');

/** The parts a clinician's link may show: those with something on them, ticked to begin with. */
export const shareable = (view: Pick<EmergencyView, 'fields' | 'date_of_birth'>): EmergencyFieldKey[] =>
  emergencyFilled(view.fields, view.date_of_birth);

/** Ticked or not, kept in the page's order. */
export function tick(now: readonly EmergencyFieldKey[], key: EmergencyFieldKey, on: boolean): EmergencyFieldKey[] {
  return EMERGENCY_FIELD_KEYS.filter((k) => (k === key ? on : now.includes(k)));
}
