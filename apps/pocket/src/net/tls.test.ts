import { certificateTrouble } from './tls';

/** The platform's words for a certificate problem, as expo/fetch passes them on (4.15). */
describe('a certificate the phone will not accept', () => {
  it('a trust failure shows the certificate copy', () => {
    expect(
      certificateTrouble(
        new Error(
          'javax.net.ssl.SSLHandshakeException: java.security.cert.CertPathValidatorException: Trust anchor for certification path not found.',
        ),
      ),
    ).toBe('untrusted');
    expect(certificateTrouble(new Error('The certificate for this server is invalid. (NSURLErrorDomain -1202)'))).toBe(
      'untrusted',
    );
  });

  it('a certificate for another name, or out of date, is told apart', () => {
    expect(
      certificateTrouble(new Error('javax.net.ssl.SSLPeerUnverifiedException: Hostname vault.local not verified')),
    ).toBe('wrong_name');
    expect(
      certificateTrouble(
        new Error(
          'javax.net.ssl.SSLHandshakeException: java.security.cert.CertificateExpiredException: Certificate expired at Tue Sep 01 2026',
        ),
      ),
    ).toBe('expired');
  });

  it('anything else is not a certificate problem', () => {
    for (const err of [
      new TypeError('Network request failed'),
      new Error('java.net.ConnectException: Failed to connect to /192.168.1.20:8443'),
      new Error('java.net.UnknownHostException: Unable to resolve host "vault.local"'),
      new Error('timeout'),
      'nothing',
    ]) {
      expect(certificateTrouble(err)).toBeNull();
    }
  });
});
