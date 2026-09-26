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
