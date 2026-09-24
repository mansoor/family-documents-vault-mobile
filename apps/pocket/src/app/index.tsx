import { scanDocument } from '@preeternal/react-native-document-scanner-plugin';
import * as Crypto from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { Link } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useEffect, useRef, useState } from 'react';
import { AppState, Image, ScrollView, StyleSheet, View } from 'react-native';
import { buildPdf, type JpegPage } from '../pdf/build';
import { jpegSize } from '../pdf/jpeg-size';
import { captureFromBytes, captureFromFile, signIn, signInSecondStep } from '../spike/api';
import { loadLastRun, saveLastRun, type LastRun } from '../spike/last-run';
import { Timeline, type TimelineExport } from '../spike/timeline';
import { Button, Card, Field, Line } from '../spike/ui';

/**
 * The scanner spike (dev and preview builds only; never shipped).
 *
 * Sign in to a throwaway vault, scan with ML Kit's document scanner, build
 * the PDF on the phone, upload it both ways, and time every stage. The
 * numbers decide whether this scanner is the one (the kill criterion in
 * FINDINGS): tap → pages accepted, median ≤ 10 s, worst ≤ 12 s.
 */

const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

export default function Spike() {
  const [base, setBase] = useState('http://192.168.1.10:8099');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pages, setPages] = useState<string[]>([]);
  const [run, setRun] = useState<LastRun | null>(() => loadLastRun());
  const [busy, setBusy] = useState(false);
  const timeline = useRef<Timeline | null>(null);

  // The scanner is another app's activity: ours leaves the foreground when
  // it opens, which is the closest thing to "the scanner is showing".
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      const t = timeline.current;
      if (t && state !== 'active' && t.between('tap', 'scannerShown') === null) t.mark('scannerShown');
    });
    return () => sub.remove();
  }, []);

  const origin = base.trim().replace(/\/+$/, '');

  async function doSignIn() {
    setBusy(true);
    setStatus(null);
    try {
      const result = mfaToken
        ? await signInSecondStep(origin, mfaToken, code.trim())
        : await signIn(origin, email.trim(), password);
      if (result.kind === 'signed_in') {
        setToken(result.accessToken);
        setMfaToken(null);
        setStatus('Signed in.');
      } else if (result.kind === 'second_step') {
        setMfaToken(result.mfaToken);
        setStatus('Enter the code from your authenticator.');
      } else {
        setStatus(`Refused (${result.status}): ${result.message}`);
      }
    } catch (err) {
      setStatus(`Could not reach ${origin}: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function upload(uris: string[], t: Timeline) {
    const read: JpegPage[] = [];
    for (const [i, uri] of uris.entries()) {
      const bytes = await new File(uri).bytes();
      t.note(`page${i + 1}Bytes`, bytes.length);
      read.push({ bytes, ...jpegSize(bytes) });
    }
    const started = Date.now();
    const pdf = await buildPdf(read);
    t.mark('pdfBuilt');
    t.note('pdfMs', Date.now() - started);
    t.note('pdfBytes', pdf.length);
    const sha = hex(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, pdf));

    const file = new File(Paths.cache, 'spike-scan.pdf');
    if (file.exists) file.delete();
    file.create();
    file.write(pdf);

    const results: LastRun['results'] = [];
    if (token) {
      const a = await captureFromFile(origin, token, file.uri, Crypto.randomUUID());
      if (a.status === 201) t.mark('created201');
      results.push({ variant: 'file', status: a.status });
      const b = await captureFromBytes(origin, token, pdf, Crypto.randomUUID());
      results.push({ variant: 'bytes', status: b.status });
    }
    file.delete();
    const next: LastRun = { at: new Date().toISOString(), timeline: t.export(), pdfSha256: sha, results };
    saveLastRun(next);
    setRun(next);
  }

  async function scan() {
    const t = new Timeline();
    timeline.current = t;
    t.mark('tap');
    setBusy(true);
    try {
      const result = await scanDocument({
        maxNumDocuments: 10,
        croppedImageQuality: 80,
        responseType: 'imageFilePath' as never,
        scannerMode: 'full',
      });
      if (result.status !== 'success' || result.scannedImages.length === 0) {
        setStatus('Scan cancelled.');
        return;
      }
      t.mark('pagesAccepted');
      setPages(result.scannedImages);
      await upload(result.scannedImages, t);
      setStatus('Done.');
    } catch (err) {
      setStatus(`Scan failed: ${(err as Error).message}`);
    } finally {
      timeline.current = null;
      setBusy(false);
    }
  }

  /** The baseline: an ordinary photo, no scanner. */
  async function photo() {
    const t = new Timeline();
    t.mark('tap');
    setBusy(true);
    try {
      const shot = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8, exif: false });
      if (shot.canceled || !shot.assets[0]) {
        setStatus('Photo cancelled.');
        return;
      }
      t.mark('pagesAccepted');
      setPages([shot.assets[0].uri]);
      await upload([shot.assets[0].uri], t);
      setStatus('Done.');
    } catch (err) {
      setStatus(`Photo failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    if (!run) return;
    const out = new File(Paths.cache, 'spike-timeline.json');
    if (out.exists) out.delete();
    out.create();
    out.write(JSON.stringify(run, null, 2));
    await Sharing.shareAsync(out.uri, { mimeType: 'application/json' });
  }

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Card title="1. Vault">
        <Field label="Address" value={base} onChangeText={setBase} keyboardType="url" />
        {mfaToken ? (
          <Field label="Code" value={code} onChangeText={setCode} keyboardType="number-pad" />
        ) : (
          <>
            <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" />
            <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry />
          </>
        )}
        <Button label={token ? 'Signed in' : 'Sign in'} onPress={() => void doSignIn()} disabled={busy} />
      </Card>

      <Card title="2. Scan">
        <Button label="Scan a document" onPress={() => void scan()} disabled={busy} />
        <Button label="Photo instead" onPress={() => void photo()} disabled={busy} quiet />
        {status ? <Line>{status}</Line> : null}
        {pages.length ? (
          <ScrollView horizontal contentContainerStyle={styles.strip}>
            {pages.map((uri, i) => (
              <Image
                key={uri}
                source={{ uri }}
                style={styles.page1}
                accessibilityLabel={`Page ${i + 1}`}
                accessibilityIgnoresInvertColors
              />
            ))}
          </ScrollView>
        ) : null}
      </Card>

      {run ? <Timing run={run} onShare={() => void share()} /> : null}

      <Link href="/probes" asChild>
        <Button label="Probes" onPress={() => undefined} quiet />
      </Link>
      <View style={styles.bottom} />
    </ScrollView>
  );
}

function Timing(props: { run: LastRun; onShare: () => void }) {
  const { timeline, results, pdfSha256 } = props.run;
  const at = (m: TimelineExport['marks'][number]['mark']) => timeline.marks.find((x) => x.mark === m)?.ms;
  const accepted = at('pagesAccepted');
  return (
    <Card title="Last run">
      {timeline.marks.map((m) => (
        <Line key={m.mark}>
          {m.mark}: {(m.ms / 1000).toFixed(2)} s
        </Line>
      ))}
      {accepted !== undefined ? (
        <Line tone={accepted <= 10_000 ? 'ok' : 'danger'}>tap → pages accepted: {(accepted / 1000).toFixed(2)} s</Line>
      ) : null}
      {Object.entries(timeline.numbers).map(([k, v]) => (
        <Line key={k} tone="muted">
          {k}: {v}
        </Line>
      ))}
      {results.map((r) => (
        <Line key={r.variant} tone={r.status === 201 ? 'ok' : 'danger'}>
          upload ({r.variant}): {r.status}
        </Line>
      ))}
      {pdfSha256 ? <Line tone="muted">sha256 {pdfSha256}</Line> : null}
      <Button label="Share the timing" onPress={props.onShare} quiet />
    </Card>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 16 },
  strip: { gap: 8 },
  page1: { width: 90, height: 127, borderRadius: 6, backgroundColor: '#FFFFFF' },
  bottom: { height: 40 },
});
