import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

/**
 * Iteration 4.12's proof on a real vault, through the web build: a
 * document found by Search, opened, its pages shown after confirming it is
 * you (it is an Essential), and its reminder put off a week on Needs
 * attention.
 */
const VAULT = process.env.FDV_DEV_API ?? 'http://localhost:8099';
const EMAIL = process.env.FDV_E2E_EMAIL ?? 'pocket-e2e@example.test';
const PASSWORD = process.env.FDV_E2E_PASSWORD ?? 'correct horse battery staple';
const FAMILY = 'The Pocket family';

/** A one-page PDF with a line of text on it: the vault draws it. */
function pdf(text: string): Buffer {
  const body = `BT /F1 18 Tf 60 780 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${body.length} >>\nstream\n${body}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

async function token(request: APIRequestContext): Promise<string> {
  let r = await request.post(`${VAULT}/api/v1/auth/password`, { data: { email: EMAIL, password: PASSWORD } });
  // The specs before this one signed in too: the vault's limit is waited out, once.
  if (r.status() === 429) {
    const wait = Number(r.headers()['retry-after'] ?? 60);
    await new Promise((done) => setTimeout(done, (wait + 1) * 1000));
    r = await request.post(`${VAULT}/api/v1/auth/password`, { data: { email: EMAIL, password: PASSWORD } });
  }
  expect(r.ok(), await r.text()).toBe(true);
  const body = (await r.json()) as { access_token?: string };
  if (!body.access_token) throw new Error('two-step sign-in is on for the e2e account');
  return body.access_token;
}

async function signIn(page: Page, address: string) {
  await page.goto('/');
  await page.getByLabel('Vault address').fill(address);
  await page.getByRole('button', { name: 'Connect' }).click();
  await page.getByRole('button', { name: 'Use it on this Wi-Fi' }).click();
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Needs attention').first()).toBeVisible();
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

test("search, open, confirm it's you, snooze", async ({ page, baseURL, request }) => {
  test.setTimeout(180_000);
  const word = `lookup${randomUUID().slice(0, 8)}`;
  const title = `Passport ${word}`;
  await signIn(page, new URL(baseURL ?? '').host);

  // A passport added from the phone, as anybody would.
  const chooser = page.waitForEvent('filechooser');
  // The tab bar's +, then Add a file.
  await page.getByRole('button', { name: 'Add a document' }).click();
  await page.getByRole('menuitem', { name: 'Add a file' }).click();
  await (await chooser).setFiles({ name: `${word}.pdf`, mimeType: 'application/pdf', buffer: pdf(word) });
  await page.getByRole('button', { name: 'More details' }).click();
  await page.getByLabel('Name', { exact: true }).fill(title);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('On its way')).toHaveCount(0, { timeout: 30_000 });

  // In the vault: made an Essential (its pages then ask to confirm it is you), with a reminder due today.
  const bearer = await token(request);
  const auth = { authorization: `Bearer ${bearer}` };
  // "On its way" can be absent for a moment before the scan is even queued:
  // the vault is asked until it has it (run 36230772547 read too soon).
  let doc: { id: string; title: string | null } | undefined;
  await expect
    .poll(
      async () => {
        const listed = (await (await request.get(`${VAULT}/api/v1/documents?limit=200`, { headers: auth })).json()) as {
          items: { id: string; title: string | null }[];
        };
        doc = listed.items.find((d) => d.title === title);
        return doc?.id;
      },
      { timeout: 30_000 },
    )
    .toBeTruthy();
  const marked = await request.patch(`${VAULT}/api/v1/documents/${doc?.id}`, {
    headers: auth,
    data: { is_essential: true },
  });
  expect(marked.ok(), await marked.text()).toBe(true);
  const today = new Date().toISOString().slice(0, 10);
  const reminded = await request.post(`${VAULT}/api/v1/reminders`, {
    headers: auth,
    data: { document_id: doc?.id, fire_at: today, note: `Renew ${word}` },
  });
  expect(reminded.ok(), await reminded.text()).toBe(true);

  // Search: found by its name, opened.
  await page.getByRole('tab', { name: 'Search' }).click();
  await page.getByLabel('Search your documents').fill(word);
  await page.getByRole('button', { name: title }).click();
  await expect(page.getByRole('button', { name: 'Show', exact: true })).toBeVisible();

  // Its pages, once the vault has drawn them (an Essential's are drawn at once).
  await expect
    .poll(
      async () => {
        const r = await request.get(`${VAULT}/api/v1/documents/${doc?.id}/versions`, { headers: auth });
        if (!r.ok()) return null; // asked too often, or not yet: again in a moment
        const v = (await r.json()) as { items?: { preview_pages?: number | null }[] };
        return v.items?.[0]?.preview_pages ?? null;
      },
      { timeout: 60_000, intervals: [1_000, 2_000, 3_000] },
    )
    .not.toBeNull();
  await page.getByRole('button', { name: 'Show the pages' }).click();
  // The vault asks to confirm it is you — unless the sign-in a moment ago
  // still counts (its window is five minutes); the sheet itself is tested
  // in document.test.tsx.
  const asked = page.getByText("Confirm it's you");
  const shown = page.getByRole('img', { name: `Page 1 of ${title}` });
  await expect(asked.or(shown)).toBeVisible({ timeout: 30_000 });
  if (await asked.isVisible()) {
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Confirm' }).click();
  }
  await expect(shown).toBeVisible({ timeout: 30_000 });

  // Needs attention: due today; put off a week, it leaves Due for a week.
  await page.goBack();
  await page.goBack();
  await page.getByRole('tab', { name: 'Needs attention' }).click();
  const id = ((await reminded.json()) as { id: string }).id;
  await expect(page.getByTestId(`snooze-week-${id}`)).toBeVisible();
  await page.getByTestId(`snooze-week-${id}`).click();
  await expect
    .poll(async () => {
      const due = (await (await request.get(`${VAULT}/api/v1/reminders?state=due`, { headers: auth })).json()) as {
        items: { id: string }[];
      };
      return due.items.some((r) => r.id === id);
    })
    .toBe(false);
  const all = (await (await request.get(`${VAULT}/api/v1/reminders?state=all`, { headers: auth })).json()) as {
    items: { id: string; status: string; snoozed_until: string | null }[];
  };
  const snoozed = all.items.find((r) => r.id === id);
  expect(snoozed?.status).toBe('snoozed');
  expect(snoozed?.snoozed_until?.slice(0, 10)).not.toBe(today);
});
