/**
 * Why an https connection failed, when it was the certificate (4.15). The
 * phone's own fetch says only "Network request failed"; expo/fetch passes
 * the platform's error on, and its class names say which it was — a
 * certificate this phone does not trust (a vault that makes its own), one
 * for another name, or one that has expired. Anything else is not a
 * certificate problem, and is left to the usual "can't reach" words.
 */
export type CertificateTrouble = 'untrusted' | 'wrong_name' | 'expired';

const RULES: [RegExp, CertificateTrouble][] = [
  // Android (Conscrypt / OkHttp).
  [/CertificateExpiredException|CertificateNotYetValidException|certificate (has )?expired/i, 'expired'],
  [
    /SSLPeerUnverifiedException|Hostname .* not verified|doesn't match any of the subject alternative names/i,
    'wrong_name',
  ],
  [
    /CertPathValidatorException|Trust anchor for certification path not found|unable to find valid certification path/i,
    'untrusted',
  ],
  // iOS (NSURLErrorDomain): -1202 untrusted, -1201 expired, -1203/-1204 no or bad root.
  [/NSURLErrorServerCertificateHasBadDate|-1201\b/i, 'expired'],
  [
    /NSURLErrorServerCertificateUntrusted|NSURLErrorServerCertificateHasUnknownRoot|NSURLErrorServerCertificateNotYetValid|-120[234]\b|certificate for this server is invalid/i,
    'untrusted',
  ],
];

export function certificateTrouble(err: unknown): CertificateTrouble | null {
  const text =
    err instanceof Error
      ? `${err.name} ${err.message} ${String((err as { cause?: unknown }).cause ?? '')}`
      : String(err);
  for (const [rule, trouble] of RULES) if (rule.test(text)) return trouble;
  return null;
}
