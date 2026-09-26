import { createFakeVault } from '@fdv/client/testing';
import { deriveStatus, missingFields, type DateValue, type DocumentInput, type DocumentView } from '@fdv/shared';
import { addCar, fieldOf, ownerApi } from '../test-support/kinds';
import { keptType, statusToday } from './status';

const DAY = 86_400_000;
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const on = (iso: string): DateValue => ({ date: iso, precision: 'day' });

/**
 * The client's fake vault with a family's Essentials in it: passports with
 * and without their number, cars with and without their plate, everyday
 * and Only me. `listed` is each as the offline set has it (an Only me
 * document's details sealed, 0.5.8); `opened` as its owner's own request
 * for it answers, details open.
 */
async function family() {
  const vault = createFakeVault();
  vault.state.setupRequired = false;
  vault.state.email = 'owner@example.test';
  vault.state.password = 'correct horse battery staple';
  const car = await addCar(vault);
  const plate = fieldOf(car, 'Registration plate');
  const { api, token } = await ownerApi(vault);
  const now = Date.now();
  const inYears = on(day(now + 3 * 365 * DAY));
  const soon = on(day(now + 20 * DAY));
  const mine = { owner_member_id: 'fake-member', is_essential: true };
  const made: DocumentInput[] = [
    { ...mine, title: 'Passport, no number', type_key: 'passport', expires: inYears },
    { ...mine, title: 'Passport', type_key: 'passport', expires: inYears, identifier: '123456789' },
    { ...mine, title: 'Passport, no number, expiring', type_key: 'passport', expires: soon },
    { ...mine, title: 'Passport, no date', type_key: 'passport', identifier: '987654321' },
    { ...mine, title: 'Car', type_key: car.key, extra: { [plate]: 'AB12 CDE' } },
    { ...mine, title: 'Car, no plate', type_key: car.key },
    { ...mine, title: 'Only me car', type_key: car.key, visibility: 'private', extra: { [plate]: 'MY 0WN' } },
    { ...mine, title: 'Only me car, no plate', type_key: car.key, visibility: 'private' },
    { ...mine, title: 'Only me passport, no number', type_key: 'passport', visibility: 'private', expires: inYears },
  ];
  for (const body of made) await api.createDocument(token, body);
  const listed = (await api.documents(token)).items;
  const opened = await Promise.all(listed.map((d) => api.document(token, d.id)));
  const types = (await api.documentTypes(token)).items;
  return { listed, opened, types, now };
}

/** What the vault would say of a document on a given day: its own rule, with its details open. */
function vaultSays(doc: DocumentView, types: Awaited<ReturnType<typeof family>>['types'], today: string) {
  const type = types.find((t) => t.key === doc.type_key) ?? null;
  return deriveStatus(
    { type, owner_member_id: doc.owner_member_id, expires: doc.expires, missing: missingFields(type, doc) },
    today,
  );
}

describe("an Essential's status with no connection", () => {
  it('is the vault’s own, words and all — a passport with no number is not Valid on the phone', async () => {
    const { listed, types, now } = await family();
    const kept = types.map(keptType);
    const today = day(now);
    for (const doc of listed) expect([doc.title, statusToday(doc, kept, today)]).toEqual([doc.title, doc.status]);
    const passport = listed.find((d) => d.title === 'Passport, no number') as DocumentView;
    expect(statusToday(passport, kept, today)).toEqual({ value: 'needs_info', label: 'Needs a passport number' });
    // What 0.2.0 said: an expiry years away, and nothing else asked.
    expect(statusToday(passport, kept.map(({ core: _c, fields: _f, ...old }) => old), today)).not.toMatchObject({
      value: 'active',
    });
  });

  it('agrees with the vault as the days pass, an Only me document’s sealed details included', async () => {
    const { listed, opened, types, now } = await family();
    const kept = types.map(keptType);
    // Types kept by 0.2.0 have no rules: the vault's Needs info stands, unless the expiry comes first.
    const old = kept.map(({ core: _c, fields: _f, ...rest }) => rest);
    for (const later of [0, 30, 400, 3 * 365 - 10, 3 * 365 + 10]) {
      const today = day(now + later * DAY);
      for (const [i, doc] of listed.entries()) {
        const truth = vaultSays(opened[i] as DocumentView, types, today);
        expect([doc.title, later, statusToday(doc, kept, today)]).toEqual([doc.title, later, truth]);
        expect([doc.title, later, 'as 0.2.0 kept it', statusToday(doc, old, today)]).toEqual([
          doc.title,
          later,
          'as 0.2.0 kept it',
          truth,
        ]);
      }
    }
  });
});
