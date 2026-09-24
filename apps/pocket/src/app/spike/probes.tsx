import * as Device from 'expo-device';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { PROBES, type ProbeResult } from '../../probes/probes';
import { Button, Card, Field, Line } from '../../spike/ui';

/** Run the probes one at a time, see the answers, export them for FINDINGS. */
export default function Probes() {
  const [vault, setVault] = useState('http://192.168.1.10:8099');
  const [results, setResults] = useState<Record<string, ProbeResult>>({});
  const [running, setRunning] = useState<string | null>(null);

  async function run(id: string) {
    const probe = PROBES.find((p) => p.id === id);
    if (!probe) return;
    setRunning(id);
    try {
      const r = await probe.run({ vault: vault.trim().replace(/\/+$/, '') });
      setResults((prev) => ({ ...prev, [id]: r }));
    } finally {
      setRunning(null);
    }
  }

  async function share() {
    const out = new File(Paths.cache, 'probes.json');
    if (out.exists) out.delete();
    out.create();
    out.write(
      JSON.stringify(
        {
          device: {
            model: Device.modelName,
            android: Device.osVersion,
            ramBytes: Device.totalMemory,
          },
          results: Object.values(results),
        },
        null,
        2,
      ),
    );
    await Sharing.shareAsync(out.uri, { mimeType: 'application/json' });
  }

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Field label="Vault (a throwaway stack)" value={vault} onChangeText={setVault} keyboardType="url" />
      {PROBES.map((p) => {
        const r = results[p.id];
        return (
          <Card key={p.id} title={`${p.id} · ${p.title}`}>
            <Button label={running === p.id ? 'Running…' : 'Run'} onPress={() => void run(p.id)} disabled={running !== null} quiet />
            {r ? (
              <>
                <Line tone={r.pass === true ? 'ok' : r.pass === false ? 'danger' : 'muted'}>
                  {r.pass === true ? 'PASS' : r.pass === false ? 'FAIL' : 'JUDGE BY HAND'}
                </Line>
                {r.notes.map((n) => (
                  <Line key={n} tone="muted">
                    {n}
                  </Line>
                ))}
                {Object.entries(r.numbers).map(([k, v]) => (
                  <Line key={k} tone="muted">
                    {k}: {v}
                  </Line>
                ))}
              </>
            ) : null}
          </Card>
        );
      })}
      <Button label="Share the results" onPress={() => void share()} disabled={Object.keys(results).length === 0} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12, paddingBottom: 48 },
});
