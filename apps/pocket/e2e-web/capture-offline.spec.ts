import { expect, test, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';

/**
 * Iteration 4.5's proof on a real vault, through the web build: a file
 * saved from the card with no connection waits on the phone, and once the
 * connection is back it reaches the vault exactly once, with the card's
 * details. Since 0.2.1 (a vault of 0.5.11) the card knows, offline, what an
 * insurance policy requires — its insurer and its expiry — and Save waits
 * for them.
 */
const VAULT = process.env.FDV_DEV_API ?? 'http://localhost:8099';
const EMAIL = process.env.FDV_E2E_EMAIL ?? 'pocket-e2e@example.test';
const PASSWORD = process.env.FDV_E2E_PASSWORD ?? 'correct horse battery staple';
const FAMILY = 'The Pocket family';

const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
  'latin1',
);

async function token(request: APIRequestContext): Promise<string> {
  const r = await request.post(`${VAULT}/api/v1/auth/password`, { data: { email: EMAIL, password: PASSWORD } });
  expect(r.ok(), await r.text()).toBe(true);
  return ((await r.json()) as { access_token: string }).access_token;
}

test.beforeAll(async ({ request }) => {
  const caps = (await (await request.get(`${VAULT}/api/v1/capabilities`)).json()) as { setup_required: boolean };
  if (caps.setup_required) {
    const r = await request.post(`${VAULT}/api/v1/setup`, {
      data: { household_name: FAMILY, display_name: 'Pocket Owner', email: EMAIL, password: PASSWORD },
    });
    expect(r.ok(), await r.text()).toBe(true);
  }
});

test('saved with no connection, sent once when it is back', async ({ page, context, baseURL, request }) => {
  const title = `Offline proof ${randomUUID().slice(0, 8)}`;
  await page.goto('/');
  await page.getByLabel('Vault address').fill(new URL(baseURL ?? '').host);
  await page.getByRole('button', { name: 'Connect' }).click();
  await page.getByRole('button', { name: 'Use it on this Wi-Fi' }).click();
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Needs attention').first()).toBeVisible();

  // The connection goes, after the app has seen the vault's choices.
  await page.waitForTimeout(1000);
  await context.setOffline(true);
  const chooser = page.waitForEvent('filechooser');
  // The tab bar's +, then Add a file.
  await page.getByRole('button', { name: 'Add a document' }).click();
  await page.getByRole('menuitem', { name: 'Add a file' }).click();
  await (await chooser).setFiles({ name: 'insurance.pdf', mimeType: 'application/pdf', buffer: PDF });
  await page.getByRole('button', { name: 'Insurance policy' }).click();
  await page.getByRole('button', { name: 'More details' }).click();
  await page.getByLabel('Name', { exact: true }).fill(title);
  await page.getByRole('button', { name: 'Save' }).click();
  // Save waits for what an insurance policy requires, says what, and goes to the first.
  await expect(page.getByText('Still needed: Insurer and Expires. Fill them in, or skip for now.')).toBeVisible();
  await expect(page.getByLabel('Insurer, required')).toBeFocused();
  await page.getByLabel('Insurer, required').fill('Aviva');
  await page.getByLabel('Expires, required').fill('14 Mar 2031');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(
    page.getByText("Saved on this phone. It'll go to the vault as soon as there's a connection."),
  ).toBeVisible();
  await expect(page.getByText('Waiting to send')).toBeVisible();

  // Back online: it goes by itself.
  await context.setOffline(false);
  await expect(page.getByText('On its way')).toHaveCount(0, { timeout: 30_000 });

  const r = await request.get(`${VAULT}/api/v1/documents?limit=200`, {
    headers: { authorization: `Bearer ${await token(request)}` },
  });
  const made = ((await r.json()) as { items: { title: string | null; type_key: string | null }[] }).items.filter(
    (d) => d.title === title,
  );
  // With what the card waited for.
  expect(made).toEqual([
    expect.objectContaining({
      type_key: 'insurance_policy',
      issued_by: 'Aviva',
      expires: expect.objectContaining({ date: '2031-03-14' }),
    }),
  ]);
});
