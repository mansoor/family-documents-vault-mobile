import { createApi, createHttp, type FetchLike } from '@fdv/client';
import type { DocumentTypeView } from '@fdv/shared';

/**
 * The family's owner, straight to the client's fake vault (not through the
 * phone): for setting a test's vault up as somebody at a computer would.
 */
export async function ownerApi(
  vault: { fetch: FetchLike; state: { email: string | null; password: string | null } },
  origin = 'https://vault.test',
) {
  const api = createApi(createHttp({ baseUrl: origin, fetch: vault.fetch }));
  const tokens = await api.signIn(vault.state.email ?? '', vault.state.password ?? '');
  if ('mfa_required' in tokens) throw new Error('no second step here');
  return { api, token: tokens.access_token };
}

/**
 * A kind of document of the household's own (0.5.10), made in the vault's
 * kinds editor: a car, which requires its registration plate, and asks its
 * fuel and whether it is on finance.
 */
export async function addCar(vault: Parameters<typeof ownerApi>[0]): Promise<DocumentTypeView> {
  const { api, token } = await ownerApi(vault);
  const plate = await api.createDocumentAttribute(token, { label: 'Registration plate', kind: 'text' });
  const fuel = await api.createDocumentAttribute(token, {
    label: 'Fuel',
    kind: 'choice',
    choices: ['Petrol', 'Electric'],
  });
  const financed = await api.createDocumentAttribute(token, { label: 'On finance', kind: 'yes_no' });
  return api.createDocumentType(token, {
    label: 'Car',
    category: 'property',
    fields: [{ key: plate.key, required: true }, { key: fuel.key }, { key: financed.key }],
  });
}

/** A field of a kind, by its name. */
export function fieldOf(type: DocumentTypeView, label: string): string {
  const f = type.fields.find((x) => x.label === label);
  if (!f) throw new Error(`${type.label} has no field called ${label}`);
  return f.key;
}

/**
 * Built-in kinds the client's fake does not list, as a vault of 0.8.0 lists
 * them: Expires shown, and still `required` on the wire as for every kind
 * that expires (the vault's api-changelog, 0.8.0, S5). Whether a document
 * of one lacks its expiry is shared's rule (`expiryOptional`), not the wire's.
 */
const VAULT_KINDS = {
  will: { label: 'Will / trust / power of attorney', category: 'legal', expiry: 'review_on' },
  vehicle_registration: { label: 'Vehicle title / registration', category: 'property', expiry: 'expires_on' },
} as const;

/** A built-in kind of the vault's own, added to the fake as the vault lists it. */
export function addVaultKind(
  vault: { state: { types: DocumentTypeView[] } },
  key: keyof typeof VAULT_KINDS,
): DocumentTypeView {
  const passport = vault.state.types.find((t) => t.key === 'passport');
  if (!passport?.core) throw new Error('the fake lists no passport to copy');
  const { label, category, expiry } = VAULT_KINDS[key];
  const type: DocumentTypeView = {
    ...passport,
    key,
    label,
    category,
    expiry_driver: expiry,
    reminder_leads: [30],
    usually_essential: false,
    issued_by_label: null,
    short_label: null,
    issuer_noun: null,
    core: {
      ...passport.core,
      identifier: { shown: true, required: false, label: null },
      issued_by: { shown: true, required: false, label: null },
      expires: { shown: true, required: true, label: null },
    },
  };
  vault.state.types.push(type);
  return type;
}
