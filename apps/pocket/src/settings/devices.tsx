import { wordsFor } from '../errors/words';
import type { SessionRow } from '@fdv/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useVault } from '../state/vault';
import { Button, Card, Notice, Text } from '../ui';

const when = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * Settings → Signed-in devices (4.15): every session of this person, named
 * as the vault names them (4.6) — this phone marked, the ones that keep
 * Essentials said — and any other signed out from here, after a second tap.
 */
export function SignedInDevices() {
  const { t } = useTranslation();
  const { withToken } = useVault();
  const [items, setItems] = useState<SessionRow[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Bumped to ask the vault again (after signing one out).
  const [asked, setAsked] = useState(0);

  useEffect(() => {
    let live = true;
    withToken((a, token) => a.sessions(token))
      .then(({ items: rows }) => {
        if (!live) return;
        setItems([...rows].sort((a, b) => Number(b.current) - Number(a.current)));
        setProblem(null);
      })
      .catch(() => {
        if (live) setProblem(t('settings.devicesUnreachable'));
      });
    return () => {
      live = false;
    };
  }, [withToken, t, asked]);

  const signOutThere = async (id: string) => {
    setBusy(id);
    try {
      await withToken((a, token) => a.revokeSession(token, id));
      setConfirming(null);
      setAsked((n) => n + 1);
    } catch (err) {
      setProblem(wordsFor(err, t, 'settings.devicesUnreachable'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <Text variant="title">{t('settings.devices')}</Text>
      {problem ? <Notice tone="warn">{problem}</Notice> : null}
      {items === null && !problem ? <Text tone="soft">{t('common.working')}</Text> : null}
      {(items ?? []).map((s) => {
        const name = s.label ?? s.user_agent ?? t('settings.deviceUnknown');
        return (
          <View key={s.id} style={styles.device} testID={`settings-device-${s.id}`}>
            <Text weight="600">{s.current ? t('settings.thisPhone', { name }) : name}</Text>
            <Text tone="soft" variant="secondary">
              {t('settings.deviceLastUsed', { date: when(s.last_used_at) })}
              {s.offline ? ` · ${t('settings.deviceKeepsEssentials')}` : ''}
            </Text>
            {s.current ? null : confirming === s.id ? (
              <View style={styles.row}>
                <Button
                  testID={`settings-device-confirm-${s.id}`}
                  kind="danger"
                  label={t('settings.deviceSignOutConfirm')}
                  busy={busy === s.id}
                  onPress={() => void signOutThere(s.id)}
                />
                <Button kind="quiet" label={t('common.cancel')} onPress={() => setConfirming(null)} />
              </View>
            ) : (
              <Button
                testID={`settings-device-sign-out-${s.id}`}
                kind="quiet"
                label={t('settings.deviceSignOut')}
                accessibilityLabel={t('settings.deviceSignOutNamed', { name })}
                onPress={() => setConfirming(s.id)}
              />
            )}
          </View>
        );
      })}
    </Card>
  );
}

const styles = StyleSheet.create({
  device: { gap: 4, paddingVertical: 6 },
  row: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
});
