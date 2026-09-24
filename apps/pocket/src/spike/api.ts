import { fetch as expoFetch } from 'expo/fetch';
import { multipartFile } from './multipart';

/**
 * The spike talks to the vault with plain fetch, on purpose: the real app
 * uses @fdv/client (from 4.2), and the spike is here to learn what the
 * phone's network stack does with an upload, not to build on.
 */

export type SignIn =
  | { kind: 'signed_in'; accessToken: string }
  | { kind: 'second_step'; mfaToken: string }
  | { kind: 'refused'; status: number; message: string };

const json = (body: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json' },
  body: JSON.stringify(body),
});

async function signInResult(res: Response): Promise<SignIn> {
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    mfa_required?: boolean;
    mfa_token?: string;
    error?: { message?: string };
  };
  if (res.ok && data.mfa_required && data.mfa_token) return { kind: 'second_step', mfaToken: data.mfa_token };
  if (res.ok && data.access_token) return { kind: 'signed_in', accessToken: data.access_token };
  return { kind: 'refused', status: res.status, message: data.error?.message ?? `HTTP ${res.status}` };
}

export async function signIn(base: string, email: string, password: string): Promise<SignIn> {
  return signInResult(await fetch(`${base}/api/v1/auth/password`, json({ email, password })));
}

export async function signInSecondStep(base: string, mfaToken: string, code: string): Promise<SignIn> {
  return signInResult(await fetch(`${base}/api/v1/auth/mfa`, json({ mfa_token: mfaToken, code })));
}

export interface Captured {
  status: number;
  documentId: string | null;
  message: string | null;
}

async function captured(res: { status: number; ok: boolean; json(): Promise<unknown> }): Promise<Captured> {
  const data = (await res.json().catch(() => ({}))) as { document_id?: string; error?: { message?: string } };
  return {
    status: res.status,
    documentId: res.ok ? (data.document_id ?? null) : null,
    message: res.ok ? null : (data.error?.message ?? null),
  };
}

/** Variant A: React Native's FormData, pointing at the PDF on disk. */
export async function captureFromFile(
  base: string,
  accessToken: string,
  fileUri: string,
  idempotencyKey: string,
): Promise<Captured> {
  const form = new FormData();
  // React Native's FormData takes a file by reference: { uri, name, type }.
  form.append('file', { uri: fileUri, name: 'scan.pdf', type: 'application/pdf' } as unknown as Blob);
  return captured(
    await fetch(`${base}/api/v1/capture`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'idempotency-key': idempotencyKey },
      body: form,
    }),
  );
}

/** Variant B: the bytes in memory, in a hand-built body, through expo/fetch. */
export async function captureFromBytes(
  base: string,
  accessToken: string,
  pdf: Uint8Array,
  idempotencyKey: string,
): Promise<Captured> {
  const { body, contentType } = multipartFile('file', 'scan.pdf', 'application/pdf', pdf);
  return captured(
    await expoFetch(`${base}/api/v1/capture`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'idempotency-key': idempotencyKey,
        'content-type': contentType,
      },
      body,
    }),
  );
}
