import { expect, test, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { apiToken, Authenticator, ready, signInOnPage, VAULT } from './vault';

/**
 * Iteration 4.4's proof on a real vault, through the web build's picker:
 * a PDF added from the phone and saved as Only me reaches the vault as
 * its owner's — whole, private from its first byte — and a second adult
 * of the same family can neither list it nor find it.
 */

/** A one-page PDF with a line of text on it. */
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

const titlesFor = async (request: APIRequestContext, bearer: string) => {
  const r = await request.get(`${VAULT}/api/v1/documents?limit=200`, {
    headers: { authorization: `Bearer ${bearer}` },
  });
  return ((await r.json()) as { items: { title: string | null; visibility: string; owner_member_id: string | null }[] })
    .items;
};

let second = { email: '', password: 'another correct horse battery' };

test.beforeAll(async ({ request }) => {
  test.setTimeout(120_000);
  // A second adult in the same family.
  const owner = await ready(request);
  second = { ...second, email: `pocket-second-${randomUUID().slice(0, 8)}@example.test` };
  const invited = await request.post(`${VAULT}/api/v1/invitations`, {
    headers: { authorization: `Bearer ${owner}` },
    data: { display_name: 'Second Adult', email: second.email, role: 'adult' },
  });
  expect(invited.ok(), await invited.text()).toBe(true);
  const { link_token, code } = (await invited.json()) as { link_token: string; code: string };
  const accepted = await request.post(`${VAULT}/api/v1/invitations/${encodeURIComponent(link_token)}/accept`, {
    data: { code, password: second.password },
  });
  expect(accepted.ok(), await accepted.text()).toBe(true);
});

test('a PDF saved as Only me is invisible to the second adult', async ({ page, baseURL, request }) => {
  const title = `Only me proof ${randomUUID().slice(0, 8)}`;
  // The owner's codes, each a time step of its own, and the second adult's set-up: minutes at most.
  test.setTimeout(180_000);
  await signInOnPage(page, new URL(baseURL ?? '').host);

  // Add a file, from the tab bar's +: the browser's own file chooser.
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add a document' }).click();
  await page.getByRole('menuitem', { name: 'Add a file' }).click();
  await (
    await chooser
  ).setFiles({ name: 'counselling-letter.pdf', mimeType: 'application/pdf', buffer: pdf('A private letter') });

  // The card: whose it is, Only me, a name; then Save.
  await expect(page.getByText('counselling-letter.pdf', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: /\(Yours\)$/ }).click();
  await page.getByRole('button', { name: 'Only me' }).click();
  await expect(
    page.getByText('Only you can open this. Nobody can open it after you, unless you leave a key.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'More details' }).click();
  await page.getByLabel('Name', { exact: true }).fill(title);
  await page.getByRole('button', { name: 'Save' }).click();

  // Saved on the phone at once; in the vault as soon as it has gone.
  await expect(page.getByText(/^Saved\./)).toBeVisible();
  await expect(page.getByText('On its way')).toHaveCount(0, { timeout: 30_000 });

  const owner = await apiToken(request);
  const mine = (await titlesFor(request, owner)).find((d) => d.title === title);
  expect(mine).toMatchObject({ visibility: 'private' });
  expect(mine?.owner_member_id).toBeTruthy();

  // A household made since 0.9.0 asks it of adults too: theirs is set up as they sign in.
  const theirs = await apiToken(request, second.email, second.password, new Authenticator(null));
  expect((await titlesFor(request, theirs)).some((d) => d.title === title)).toBe(false);
  const searched = await request.get(`${VAULT}/api/v1/search?q=${encodeURIComponent(title)}`, {
    headers: { authorization: `Bearer ${theirs}` },
  });
  expect(((await searched.json()) as { items: unknown[] }).items).toEqual([]);
});
