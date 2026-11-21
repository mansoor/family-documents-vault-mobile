import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The real vault these specs run against, as its 0.9.0 has it: setting it
 * up takes the setup code from its .env, and an owner (and, in a household
 * made since, every adult) must have two-step sign-in before anything else.
 * The e2e owner's is an authenticator app's key, set up here the first time
 * and kept beside the app for the specs after it.
 */
export const VAULT = process.env.FDV_DEV_API ?? 'http://localhost:8099';
export const EMAIL = process.env.FDV_E2E_EMAIL ?? 'pocket-e2e@example.test';
export const PASSWORD = process.env.FDV_E2E_PASSWORD ?? 'correct horse battery staple';
export const FAMILY = 'The Pocket family';

/** FDV_SETUP_TOKEN: from the environment, or the .env scripts/gen-env.mjs wrote for the stack (as CI's). */
export function setupCode(): string {
  if (process.env.FDV_SETUP_TOKEN) return process.env.FDV_SETUP_TOKEN.trim();
  try {
    const env = readFileSync(join(__dirname, '..', '..', '..', 'vendor', 'fdv', '.env'), 'utf8');
    return /^FDV_SETUP_TOKEN=(.*)$/m.exec(env)?.[1]?.trim() ?? '';
  } catch {
    return '';
  }
}

/** The six-digit code an authenticator app shows for a base32 key at a moment (RFC 6238). */
export function totpCode(secret: string, at = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secret.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase()) {
    bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  }
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = createHmac('sha1', key).update(counter).digest();
  const o = (h[h.length - 1] as number) & 0xf;
  const n =
    (((h[o] as number) & 0x7f) << 24) |
    ((h[o + 1] as number) << 16) |
    ((h[o + 2] as number) << 8) |
    (h[o + 3] as number);
  return String(n % 1_000_000).padStart(6, '0');
}

/**
 * Somebody's authenticator app: the key, and the time step of the last code
 * given — the vault takes each code once, so the next is of a later step,
 * waited for when it must be (30 seconds at most). The owner's is kept in
 * files beside the app, for the next spec and the next run.
 */
export class Authenticator {
  private last = -1;
  constructor(
    public secret: string | null,
    private readonly files?: { key: string; step: string },
  ) {
    if (files) {
      try {
        this.secret = process.env.FDV_E2E_TOTP_SECRET?.trim() || readFileSync(files.key, 'utf8').trim() || null;
        this.last = Number(readFileSync(files.step, 'utf8').trim());
      } catch {
        // None kept yet.
      }
    }
  }

  keep(secret: string): void {
    this.secret = secret;
    this.last = -1;
    if (this.files) writeFileSync(this.files.key, `${secret}\n`);
  }

  async code(): Promise<string> {
    if (!this.secret) throw new Error('no authenticator key kept for this account');
    const now = () => Math.floor(Date.now() / 30_000);
    const want = Math.max(now(), Number.isFinite(this.last) ? this.last + 1 : now());
    while (want > now() + 1) await new Promise((resolve) => setTimeout(resolve, 1000));
    this.last = want;
    if (this.files) writeFileSync(this.files.step, `${want}\n`);
    return totpCode(this.secret, want * 30_000);
  }
}

export const owner = new Authenticator(null, {
  key: join(__dirname, '..', '.e2e-owner-totp'),
  step: join(__dirname, '..', '.e2e-owner-totp-step'),
});

/** The vault set up, the owner given the setup code: once per stack. */
export async function setUp(request: APIRequestContext): Promise<void> {
  const caps = (await (await request.get(`${VAULT}/api/v1/capabilities`)).json()) as { setup_required: boolean };
  if (!caps.setup_required) return;
  const r = await request.post(`${VAULT}/api/v1/setup`, {
    data: {
      household_name: FAMILY,
      display_name: 'Pocket Owner',
      email: EMAIL,
      password: PASSWORD,
      setup_token: setupCode(),
    },
  });
  expect(r.ok(), await r.text()).toBe(true);
}

/**
 * Signed in through the API, as anybody: the password, then the code when
 * two-step sign-in is on — or, held to setting it up, set up first (the
 * password confirms it is them, the key is kept, its code turns it on).
 * The access token.
 */
export async function apiToken(
  request: APIRequestContext,
  email = EMAIL,
  password = PASSWORD,
  app: Authenticator = owner,
): Promise<string> {
  let r = await request.post(`${VAULT}/api/v1/auth/password`, { data: { email, password } });
  // The specs before this one signed in too: a limit is waited out, once.
  if (r.status() === 429) {
    const wait = Number(r.headers()['retry-after'] ?? 60);
    await new Promise((done) => setTimeout(done, (wait + 1) * 1000));
    r = await request.post(`${VAULT}/api/v1/auth/password`, { data: { email, password } });
  }
  expect(r.ok(), await r.text()).toBe(true);
  const body = (await r.json()) as { access_token?: string; mfa_token?: string; two_step_setup_required?: boolean };
  if (body.mfa_token) {
    const second = await request.post(`${VAULT}/api/v1/auth/mfa`, {
      data: { mfa_token: body.mfa_token, code: await app.code() },
    });
    expect(second.ok(), await second.text()).toBe(true);
    return ((await second.json()) as { access_token: string }).access_token;
  }
  const token = body.access_token as string;
  if (body.two_step_setup_required) {
    const auth = { authorization: `Bearer ${token}` };
    const stepUp = await request.post(`${VAULT}/api/v1/auth/step-up`, { headers: auth, data: { password } });
    expect(stepUp.ok(), await stepUp.text()).toBe(true);
    const enrol = await request.post(`${VAULT}/api/v1/auth/totp/enrol`, { headers: auth, data: {} });
    expect(enrol.ok(), await enrol.text()).toBe(true);
    app.keep(((await enrol.json()) as { secret: string }).secret);
    const confirm = await request.post(`${VAULT}/api/v1/auth/totp/confirm`, {
      headers: auth,
      data: { code: await app.code() },
    });
    expect(confirm.ok(), await confirm.text()).toBe(true);
  }
  return token;
}

/**
 * The vault set up, and the owner's two-step sign-in with it: before any
 * spec signs in on the page. The owner's access token. A hook calling it
 * gives itself two minutes: a code may wait for the next time step.
 */
export async function ready(request: APIRequestContext): Promise<string> {
  await setUp(request);
  return apiToken(request);
}

/** The owner, signed in on the page: Connect over http on this Wi-Fi, the password, the code. */
export async function signInOnPage(page: Page, address: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Vault address').fill(address);
  await page.getByRole('button', { name: 'Connect' }).click();
  await page.getByRole('button', { name: 'Use it on this Wi-Fi' }).click();
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await finishWithCode(page);
}

/** The second step on the page: the owner's next code. */
export async function finishWithCode(page: Page, app: Authenticator = owner): Promise<void> {
  await page.getByTestId('sign-in-code').fill(await app.code());
  await page.getByTestId('sign-in-go').click();
  await expect(page.getByTestId('home-ready')).toBeVisible();
}
