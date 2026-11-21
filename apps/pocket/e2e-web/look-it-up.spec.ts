import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { apiToken, ready, signInOnPage, VAULT } from './vault';

/**
 * Iteration 4.12's proof on a real vault, through the web build: a
 * document found by Search, opened, its pages shown after confirming it is
 * you (it is an Essential), and its reminder put off a week on Needs
 * attention.
 */
const PASSWORD = process.env.FDV_E2E_PASSWORD ?? 'correct horse battery staple';

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

test.beforeAll(async ({ request }) => {
  test.setTimeout(120_000);
  await ready(request);
});

test("search, open, confirm it's you, snooze", async ({ page, baseURL, request }) => {
  test.setTimeout(180_000);
  const word = `lookup${randomUUID().slice(0, 8)}`;
  const title = `Passport ${word}`;
  await signInOnPage(page, new URL(baseURL ?? '').host);

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
  const bearer = await apiToken(request);
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
  // Search is the Documents tab since R3.
  await page.getByRole('tab', { name: 'Documents' }).click();
  // The search box opens from the magnifier beside the title (0.5.6).
  await page.getByTestId('documents-search').click();
  await page.getByLabel('Search your documents').fill(word);
  // The row itself, not its ⋯ ("Actions for “…”", 5.36), which names it too.
  await page.getByRole('button', { name: new RegExp(`^${title}`) }).click();
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
  // A round action on the document's page since R6: Pages.
  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  // The vault asks to confirm it is you — unless the sign-in a moment ago
  // still counts (its window is five minutes); the sheet itself is tested
  // in document.test.tsx.
  const asked = page.getByText("Confirm it's you");
  const shown = page.getByRole('img', { name: `Page 1 of ${title}` });
  await expect(asked.or(shown)).toBeVisible({ timeout: 30_000 });
  if (await asked.isVisible()) {
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Confirm' }).click();
  }
  await expect(shown).toBeVisible({ timeout: 30_000 });

  // Needs attention: due today; put off a week, it leaves Due for a week.
  await page.goBack();
  await page.goBack();
  // Behind the bell since R3.
  await page.getByRole('button', { name: /^Needs attention/ }).first().click();
  const id = ((await reminded.json()) as { id: string }).id;
  // Later (R6) asks how long, in a sheet: a week.
  await expect(page.getByTestId(`later-${id}`)).toBeVisible();
  await page.getByTestId(`later-${id}`).click();
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
