import { can, securityHealthLines, type HealthLine, type SecurityHealthView } from '@fdv/shared';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { exactWords, useFamilyZone } from '../state/family-time';
import { useVault } from '../state/vault';
import { Button, Card, Text } from '../ui';
import { sp } from '../ui/space';
import { LoadFailed, loadFailure } from '../ui/states';

/**
 * System health (a vault with `features.security_health`; Security &
 * health until app 0.24.0, as the vault's web renamed it), as the
 * web's Settings has it, for an owner: the last backup and its copy
 * off-site, the last restore drill, the activity log's nightly check, and
 * the day's failed sign-ins and sign-ins used from two places — each fine,
 * a gentle note, or a problem in plain words with what to do, in the
 * vault's own words (`securityHealthLines`). Read from what the vault
 * already keeps; nothing is asked to see it. Where a line points at
 * Activity, it opens there; anything else is done in the browser or on the
 * server, as it says.
 */
export function SecurityHealthCard() {
  const { t } = useTranslation();
  const zone = useFamilyZone();
  const { caps, who, withToken, offline } = useVault();
  const offered = caps?.features.security_health === true && who?.role === 'owner';
  const [data, setData] = useState<SecurityHealthView | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!offered) return;
    try {
      setData(await withToken((a, tk) => a.securityHealth(tk)));
      setFailed(null);
    } catch (err) {
      setFailed(loadFailure('securityHealth', err, t));
    }
  }, [offered, withToken, t]);
  useEffect(() => {
    // Asked on arrival, and when the connection returns; set once the vault answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, offline]);

  if (!offered || (!data && !failed)) return null;
  const lines = data ? securityHealthLines(data, (iso) => exactWords(iso, zone)) : null;
  // A note (a restore drill to run) is worth doing, and no problem.
  const problems = lines?.filter((l) => l.tone === 'problem').length ?? 0;
  return (
    <Card>
      <View testID="security-health" style={styles.box}>
        <Text variant="title">{t('health.title')}</Text>
        {failed && !lines ? <LoadFailed words={failed} onRetry={() => void load()} testID="security-health-failed" /> : null}
        {lines ? (
          <>
            <Text weight="600" tone={problems === 0 ? 'soft' : 'danger'} testID="security-health-summary">
              {problems === 0 ? t('health.allFine') : t('health.needLooking', { count: problems })}
            </Text>
            {lines.map((l) => (
              <HealthRow key={l.key} line={l} />
            ))}
          </>
        ) : null}
      </View>
    </Card>
  );
}

function HealthRow(props: { line: HealthLine }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { who } = useVault();
  const l = props.line;
  const tone = l.tone === 'fine' ? t('health.fine') : l.tone === 'note' ? t('health.whenYouCan') : t('health.lookAtThis');
  // Activity is on the phone too, for whoever reads it; anything else is the browser's or the server's.
  const opens = l.to === '/activity' && !!who && can(who.role, 'audit.read');
  return (
    <View style={styles.line} testID={`health-${l.key}`}>
      <View style={styles.head}>
        <Text weight="600" style={styles.flex}>
          {l.label}
        </Text>
        <Text variant="small" weight="700" tone={l.tone === 'problem' ? 'danger' : l.tone === 'note' ? 'warn' : 'accent'}>
          {tone}
        </Text>
      </View>
      <Text variant="secondary">{l.words}</Text>
      {l.fix ? (
        <Text variant="secondary" tone="soft">
          {l.fix}
        </Text>
      ) : null}
      {opens ? (
        <Button
          kind="quiet"
          size="small"
          label={t('health.openActivity')}
          onPress={() => router.push('/activity')}
          testID={`health-${l.key}-open`}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: sp(12) },
  line: { gap: sp(4) },
  head: { flexDirection: 'row', alignItems: 'center', gap: sp(8) },
  flex: { flex: 1 },
});
