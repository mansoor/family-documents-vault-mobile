import { expect, test } from '@playwright/test';

/**
 * Iteration 4.2's proof on a real vault: connect over plain http only
 * after saying yes, see the vault's own words for a wrong password, sign
 * in, and still be signed in after a reload. A fresh vault is set up
 * first; one that is already set up must know FDV_E2E_EMAIL/PASSWORD.
 */
const VAULT = process.env.FDV_DEV_API ?? 'http://localhost:8099';
const EMAIL = process.env.FDV_E2E_EMAIL ?? 'pocket-e2e@example.test';
const PASSWORD = process.env.FDV_E2E_PASSWORD ?? 'correct horse battery staple';
const FAMILY = 'The Pocket family';

/** What the vault calls itself, which is what the app shows. */
let family = FAMILY;

test.beforeAll(async ({ request }) => {
  const capabilities = async () =>
    (await (await request.get(`${VAULT}/api/v1/capabilities`)).json()) as {
      setup_required: boolean;
      branding: { display_name: string | null };
    };
  if ((await capabilities()).setup_required) {
    const r = await request.post(`${VAULT}/api/v1/setup`, {
      data: { household_name: FAMILY, display_name: 'Pocket Owner', email: EMAIL, password: PASSWORD },
    });
    expect(r.ok(), await r.text()).toBe(true);
  }
  family = (await capabilities()).branding.display_name ?? FAMILY;
});

test('connect over http after saying yes, sign in, stay signed in', async ({ page, baseURL }) => {
  const address = new URL(baseURL ?? '').host;
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Your vault' })).toBeVisible();
  await page.getByLabel('Vault address').fill(address);
  await page.getByRole('button', { name: 'Connect' }).click();

  // Plain http: nothing is kept until the answer is yes.
  await expect(page.getByText(/doesn't use a secure connection/)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('prefs.vaults'))).toBeNull();
  await page.getByRole('button', { name: 'Use it on this Wi-Fi' }).click();

  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByText(`to ${family}`)).toBeVisible();

  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill('not the password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText("That email and password don't match.")).toBeVisible();

  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: family })).toBeVisible();
  await expect(page.getByText('Needs attention').first()).toBeVisible();

  // A reload starts from what was kept: straight back to Home.
  await page.reload();
  await expect(page.getByRole('heading', { name: family })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toHaveCount(0);
});
