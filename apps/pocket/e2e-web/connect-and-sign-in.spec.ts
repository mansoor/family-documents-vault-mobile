import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { apiToken, Authenticator, EMAIL, FAMILY, finishWithCode, PASSWORD, ready, VAULT } from './vault';

/**
 * Iteration 4.2's proof on a real vault: connect over plain http only
 * after saying yes, see the vault's own words for a wrong password, sign
 * in — with the owner's code, which the vault of 0.9.0 asks of every owner
 * — and still be signed in after a reload. A fresh vault is set up first;
 * one that is already set up must know FDV_E2E_EMAIL/PASSWORD (and
 * FDV_E2E_TOTP_SECRET, if the owner's key is not kept here).
 *
 * And 0.20.0's: an adult the household asks for two-step sign-in, signing
 * in without it, sets it up on the phone before anything else.
 */

/** What the vault calls itself, which is what the app shows. */
let family = FAMILY;

test.beforeAll(async ({ request }) => {
  test.setTimeout(120_000);
  await ready(request);
  const caps = (await (await request.get(`${VAULT}/api/v1/capabilities`)).json()) as {
    branding: { display_name: string | null };
  };
  family = caps.branding.display_name ?? FAMILY;
});

test('connect over http after saying yes, sign in, stay signed in', async ({ page, baseURL }) => {
  test.setTimeout(120_000);
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
  await page.getByLabel('Password', { exact: true }).fill('not the password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText("That email and password don't match.")).toBeVisible();

  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await finishWithCode(page);
  await expect(page.getByRole('heading', { name: family })).toBeVisible();

  // A reload starts from what was kept: straight back to Home.
  await page.reload();
  await expect(page.getByRole('heading', { name: family })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toHaveCount(0);
});

test('an adult without two-step sign-in sets it up on the phone, then carries on', async ({ page, baseURL, request }) => {
  test.setTimeout(150_000);
  const owner = await apiToken(request);
  const email = `pocket-adult-${randomUUID().slice(0, 8)}@example.test`;
  const password = 'an adult correct horse battery';
  const invited = await request.post(`${VAULT}/api/v1/invitations`, {
    headers: { authorization: `Bearer ${owner}` },
    data: { display_name: 'Held Adult', email, role: 'adult' },
  });
  expect(invited.ok(), await invited.text()).toBe(true);
  const { link_token, code } = (await invited.json()) as { link_token: string; code: string };
  const accepted = await request.post(`${VAULT}/api/v1/invitations/${encodeURIComponent(link_token)}/accept`, {
    data: { code, password },
  });
  expect(accepted.ok(), await accepted.text()).toBe(true);

  await page.goto('/');
  await page.getByLabel('Vault address').fill(new URL(baseURL ?? '').host);
  await page.getByRole('button', { name: 'Connect' }).click();
  await page.getByRole('button', { name: 'Use it on this Wi-Fi' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  // Held: only setting it up, or signing out.
  await expect(page.getByTestId('two-step-needed')).toBeVisible();
  await expect(page.getByTestId('home-ready')).toHaveCount(0);
  await page.getByTestId('two-step-begin').click();
  // Confirm it's them, if the vault asks (a sign-in a moment ago still counts): the password, as they have no code yet.
  const asked = page.getByTestId('step-up-password');
  await expect(asked.or(page.getByTestId('two-step-secret'))).toBeVisible();
  if (await asked.isVisible()) {
    await asked.fill(password);
    await page.getByTestId('step-up-go').click();
  }
  await expect(page.getByTestId('two-step-secret')).toBeVisible();
  const secret = ((await page.getByTestId('two-step-secret').textContent()) ?? '').replace(/\s+/g, '');
  expect(secret.length).toBeGreaterThan(10);
  const app = new Authenticator(secret);
  await page.getByTestId('two-step-code').fill(await app.code());
  await page.getByTestId('two-step-confirm').click();

  // Set up: the same session goes on, to Home.
  await expect(page.getByTestId('home-ready')).toBeVisible();
  await expect(page.getByTestId('two-step-needed')).toHaveCount(0);
});
