import { expect, test } from '@playwright/test';

/**
 * Iteration 4.15's proof against a vault older than the app needs: the
 * published 0.4.5 images, as the throwaway stack "fdvold" on :8097.
 *
 *   FDV_OLD_VAULT=0.4.5 FDV_DEV_API=http://localhost:8097 \
 *     npx playwright test -c e2e-web/playwright.config.ts too-old
 *
 * Skipped anywhere else (CI's vault is the version the app is pinned to).
 */
const OLD = process.env.FDV_OLD_VAULT;

test('a vault older than the app says both versions, and how to update it', async ({ page, baseURL }) => {
  test.skip(!OLD, 'needs FDV_OLD_VAULT (its version) and FDV_DEV_API pointing at that vault');
  const address = new URL(baseURL ?? '').host;
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your vault' })).toBeVisible();
  await page.getByLabel('Vault address').fill(address);
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(
    page.getByText(`Your vault is on version ${OLD}. This app needs 0.4.10 or newer.`, { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show how' })).toBeVisible();
  // Nothing was kept: the app never got as far as asking to use it.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your vault' })).toBeVisible();
});
