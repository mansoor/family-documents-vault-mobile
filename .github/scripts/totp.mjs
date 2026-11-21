// The e2e owner's authenticator app, on the runner (the vault of 0.9.0 asks
// every owner for two-step sign-in, and takes each code once).
//
//   node totp.mjs enrol   sign in as the owner, set up an authenticator, keep its key
//   node totp.mjs serve   answer GET /code with the next code nobody has had yet
//
// The key and the last time step given live in $RUNNER_TEMP (FDV_TOTP_DIR),
// never in the repository. The Maestro flows ask /code from Maestro itself,
// on the host, at http://localhost:8097/code (runScript, apps/pocket/.maestro/common),
// and the seed scripts at http://localhost:8097/code (owner-token.sh): every
// code goes through the one server, so no two are of the same time step.
import { createHmac } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

const dir = process.env.FDV_TOTP_DIR ?? process.env.RUNNER_TEMP ?? '.';
const KEY = join(dir, 'owner-totp');
const STEP = join(dir, 'owner-totp-step');
const VAULT = process.env.VAULT ?? 'http://localhost:8099';
const PORT = Number(process.env.TOTP_PORT ?? 8097);

/** The six-digit code an authenticator app shows for a base32 key at a moment (RFC 6238). */
function totpCode(secret, at) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secret.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase()) {
    bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  }
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = createHmac('sha1', key).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, '0');
}

const lastStep = () => {
  try {
    return Number(readFileSync(STEP, 'utf8').trim());
  } catch {
    return -1;
  }
};

/** A code of a time step after the last one given — waited for if need be (30 s at most). */
async function freshCode(secret) {
  const now = () => Math.floor(Date.now() / 30_000);
  const last = lastStep();
  const want = Math.max(now(), Number.isFinite(last) ? last + 1 : now());
  while (want > now() + 1) await new Promise((r) => setTimeout(r, 500));
  writeFileSync(STEP, `${want}\n`);
  return totpCode(secret, want * 30_000);
}

async function call(path, body, token) {
  const res = await fetch(`${VAULT}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function enrol() {
  const { EMAIL, PASSWORD } = process.env;
  const signed = await call('/api/v1/auth/password', { email: EMAIL, password: PASSWORD });
  if (!signed.access_token) throw new Error('the owner has two-step sign-in already: no key to set up');
  const token = signed.access_token;
  await call('/api/v1/auth/step-up', { password: PASSWORD }, token);
  const { secret } = await call('/api/v1/auth/totp/enrol', {}, token);
  writeFileSync(KEY, `${secret}\n`, { mode: 0o600 });
  writeFileSync(STEP, '-1\n');
  await call('/api/v1/auth/totp/confirm', { code: await freshCode(secret) }, token);
  await call('/api/v1/auth/logout', {}, token).catch(() => undefined);
  console.log('The owner has an authenticator app; its key is kept for this run only.');
}

function serve() {
  const secret = readFileSync(KEY, 'utf8').trim();
  // One code at a time, in order: never two of the same step.
  let queue = Promise.resolve();
  createServer((req, res) => {
    if (req.url !== '/code' && !req.url?.startsWith('/code?')) {
      res.writeHead(404).end();
      return;
    }
    queue = queue.then(async () => {
      const code = await freshCode(secret);
      res.writeHead(200, { 'content-type': 'text/plain' }).end(code);
    });
  }).listen(PORT, '0.0.0.0', () => console.log(`codes on :${PORT}/code`));
}

const what = process.argv[2];
if (what === 'enrol') await enrol();
else if (what === 'serve') serve();
else {
  console.error('node totp.mjs enrol|serve');
  process.exit(2);
}
