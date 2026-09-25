import { colours } from '@fdv/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Platform, Pressable, StyleSheet, Switch, View } from 'react-native';
import { Button, Card, Notice, Text } from '../ui';
import type { Distributor } from './native';
import { usePush, type TurnOn } from './push';

/** Settings → Notifications (4.14): whether this phone hears from the vault, and how. */
export function NotificationsCard() {
  const { t } = useTranslation();
  const push = usePush();
  const s = push.status;
  const [busy, setBusy] = useState(false);
  const [choosing, setChoosing] = useState<Distributor[] | null>(null);
  const [said, setSaid] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);

  if (s.kind === 'unknown' || s.kind === 'not_set_up') return null;
  if (s.kind === 'unsupported' && Platform.OS !== 'ios') return null;

  // What the status does not already say.
  const outcome: Record<Exclude<TurnOn, 'on' | 'choose' | 'permission_off'>, string> = {
    no_distributor: t('push.noDistributor'),
    not_set_up: t('push.oldVault'),
    unreachable: t('push.unreachable'),
  };
  const turnOn = async (distributor?: string) => {
    setBusy(true);
    setSaid(null);
    try {
      const r = await push.turnOn(distributor);
      if (r === 'choose') setChoosing(push.distributors());
      else {
        setChoosing(null);
        if (r !== 'on' && r !== 'permission_off') setSaid({ tone: 'warn', text: outcome[r] });
      }
    } finally {
      setBusy(false);
    }
  };
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setSaid(null);
    try {
      await fn();
    } catch {
      setSaid({ tone: 'warn', text: t('push.unreachable') });
    } finally {
      setBusy(false);
    }
  };
  const test = () =>
    run(async () => {
      const sent = await push.sendTest();
      setSaid(sent ? { tone: 'ok', text: t('push.testSent') } : { tone: 'warn', text: t('push.unreachable') });
    });

  const reason = (why: string) =>
    why === 'NETWORK'
      ? t('push.failedNetwork')
      : why === 'ACTION_REQUIRED'
        ? t('push.failedAction')
        : t('push.failedOther');

  return (
    <Card>
      <Text variant="title" testID="push-title">
        {t('push.title')}
      </Text>
      {s.kind === 'unsupported' ? <Text testID="push-iphone">{t('push.iphone')}</Text> : null}
      {s.kind === 'old_vault' ? <Text testID="push-old-vault">{t('push.oldVault')}</Text> : null}
      {s.kind === 'no_distributor' ? <Text testID="push-install">{t('push.noDistributor')}</Text> : null}
      {s.kind === 'permission_off' ? (
        <>
          <Text testID="push-permission-off">{t('push.permissionOff')}</Text>
          <Button kind="quiet" label={t('push.openSettings')} onPress={() => void Linking.openSettings()} />
        </>
      ) : null}
      {s.kind === 'off' && !choosing ? (
        <>
          <Text tone="soft">{t('push.offHint')}</Text>
          <Button testID="push-turn-on" label={t('push.turnOn')} busy={busy} onPress={() => void turnOn()} />
        </>
      ) : null}
      {choosing ? (
        <View accessibilityRole="radiogroup" accessibilityLabel={t('push.choose')} style={styles.choices}>
          <Text weight="600">{t('push.choose')}</Text>
          {choosing.map((d) => (
            <Pressable
              key={d.id}
              testID={`push-distributor-${d.id}`}
              accessibilityRole="radio"
              accessibilityLabel={d.name}
              accessibilityState={{ checked: false, disabled: busy }}
              disabled={busy}
              onPress={() => void turnOn(d.id)}
              style={styles.choice}
            >
              <View style={styles.dot} />
              <Text>{d.name}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {s.kind === 'waiting' ? <Text testID="push-waiting">{t('push.waiting')}</Text> : null}
      {s.kind === 'failed' ? (
        <>
          <Text testID="push-failed">
            {t('push.failed', { why: s.reason === 'VAULT' && s.message ? s.message : reason(s.reason) })}
          </Text>
          <Button kind="quiet" label={t('push.tryAgain')} busy={busy} onPress={() => void turnOn()} />
        </>
      ) : null}
      {s.kind === 'waiting' || s.kind === 'failed' ? (
        <Button
          testID="push-turn-off"
          kind="quiet"
          label={t('push.turnOff')}
          busy={busy}
          onPress={() => void run(push.turnOff)}
        />
      ) : null}
      {s.kind === 'on' ? (
        <>
          <Text testID="push-on">
            {s.distributor ? t('push.onThrough', { distributor: s.distributor }) : t('push.on')}
          </Text>
          {push.daily !== null ? (
            <View style={styles.row}>
              <View style={styles.flex}>
                <Text weight="600">{t('push.daily')}</Text>
                <Text tone="soft" variant="secondary">
                  {t('push.dailyHint')}
                </Text>
              </View>
              <Switch
                testID="push-daily"
                accessibilityLabel={t('push.daily')}
                value={push.daily}
                disabled={busy}
                onValueChange={(v) => void run(() => push.setDaily(v))}
              />
            </View>
          ) : null}
          <Button testID="push-test" kind="quiet" label={t('push.sendTest')} busy={busy} onPress={() => void test()} />
          <Button
            testID="push-turn-off"
            kind="quiet"
            label={t('push.turnOff')}
            busy={busy}
            onPress={() => void run(push.turnOff)}
          />
        </>
      ) : null}
      {said ? (
        <Notice tone={said.tone} testID="push-said" announce={said.text}>
          {said.text}
        </Notice>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1 },
  choices: { gap: 4 },
  choice: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12 },
  dot: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colours.borderInput },
});
