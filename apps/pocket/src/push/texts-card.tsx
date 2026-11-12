import { CLOCK_TIME, QUIET_FROM_DEFAULT, QUIET_TO_DEFAULT, type Preferences } from '@fdv/shared';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Switch, View } from 'react-native';
import { wordsFor } from '../errors/words';
import { on } from '../state/events';
import { useVault } from '../state/vault';
import { Button, Card, Field, Notice, Text } from '../ui';
import { sp } from '../ui/space';

type TextChoice = 'daily_text' | 'alerts_text' | 'share_opened_text';
const CHOICES: { key: TextChoice; id: string }[] = [
  { key: 'daily_text', id: 'daily' },
  { key: 'alerts_text', id: 'alerts' },
  { key: 'share_opened_text', id: 'share-opened' },
];

/**
 * Settings → Texts (SMS4; the vault's SMS2, 0.9.0-dev.31): what comes by
 * text to the person's own confirmed number — the day's reminders (one
 * text, a count), alerts about their account, and a link of theirs being
 * opened — each off until turned on, and the quiet hours on the family's
 * clock when nothing but an alert about their own sign-in comes. The same
 * choices as the web's Notifications; the vault keeps them, so they follow
 * the person to every device.
 *
 * Shown where the vault has text notifications and texts are set up. Until
 * the person's number is confirmed, it says where to add one.
 */
export function TextNotificationsCard() {
  const { t } = useTranslation();
  const { caps, who, withToken } = useVault();
  const router = useRouter();
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [phone, setPhone] = useState<{ ready: boolean; confirmed: boolean } | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const memberId = who?.member_id ?? null;
  const offered = caps?.features.sms_notifications === true && caps.features.sms_texts === true;

  const load = useCallback(async () => {
    if (!offered || !memberId) return;
    try {
      const [p, v] = await Promise.all([
        withToken((a, tk) => a.preferences(tk)),
        withToken((a, tk) => a.memberPhone(tk, memberId)),
      ]);
      setPrefs(p);
      setFrom(p.quiet_from ?? QUIET_FROM_DEFAULT);
      setTo(p.quiet_to ?? QUIET_TO_DEFAULT);
      setPhone({ ready: v.sms_ready, confirmed: v.phone?.confirmed === true });
    } catch {
      // No answer: nothing offered here.
    }
  }, [offered, memberId, withToken]);
  useEffect(() => {
    // Asked on arrival, and again when the number changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    return on('phoneChanged', () => void load());
  }, [load]);

  if (!offered || !prefs || !phone || !phone.ready) return null;

  const save = async (what: string, body: Partial<Preferences>, words?: string) => {
    setBusy(what);
    setProblem(null);
    setSaid(null);
    try {
      const next = await withToken((a, tk) => a.updatePreferences(tk, body));
      setPrefs(next);
      if (words) setSaid(words);
    } catch (err) {
      setProblem(wordsFor(err, t));
    } finally {
      setBusy(null);
    }
  };

  const fromOk = CLOCK_TIME.test(from.trim());
  const toOk = CLOCK_TIME.test(to.trim());
  const quietChanged = from.trim() !== (prefs.quiet_from ?? QUIET_FROM_DEFAULT) || to.trim() !== (prefs.quiet_to ?? QUIET_TO_DEFAULT);

  return (
    <Card>
      <Text variant="title">{t('texts.title')}</Text>
      {!phone.confirmed ? (
        <>
          <Text variant="secondary" tone="soft" testID="texts-no-number">
            {t('texts.noNumber')}
          </Text>
          <Button testID="texts-add-number" kind="quiet" label={t('texts.addNumber')} onPress={() => router.push('/account')} />
        </>
      ) : (
        <>
          <Text variant="secondary" tone="soft">
            {t('texts.hint')}
          </Text>
          {CHOICES.map(({ key, id }) => (
            <View key={key} style={styles.row}>
              <View style={styles.flex}>
                <Text weight="600">{t(`texts.${id}`)}</Text>
                <Text variant="secondary" tone="soft">
                  {t(`texts.${id}Hint`)}
                </Text>
              </View>
              <Switch
                testID={`texts-${id}`}
                accessibilityLabel={t(`texts.${id}`)}
                value={prefs[key] === true}
                disabled={busy !== null}
                onValueChange={(v) => void save(key, { [key]: v })}
              />
            </View>
          ))}
          <Text weight="600">{t('texts.quiet')}</Text>
          <Text variant="secondary" tone="soft">
            {t('texts.quietHint')}
          </Text>
          <View style={styles.times}>
            <View style={styles.flex}>
              <Field
                testID="texts-quiet-from"
                label={t('texts.quietFrom')}
                value={from}
                onChangeText={setFrom}
                keyboardType="numbers-and-punctuation"
                placeholder="21:00"
                maxLength={5}
                error={from.trim() && !fromOk ? t('texts.timeProblem') : null}
              />
            </View>
            <View style={styles.flex}>
              <Field
                testID="texts-quiet-to"
                label={t('texts.quietTo')}
                value={to}
                onChangeText={setTo}
                keyboardType="numbers-and-punctuation"
                placeholder="08:00"
                maxLength={5}
                error={to.trim() && !toOk ? t('texts.timeProblem') : null}
              />
            </View>
          </View>
          {quietChanged ? (
            <Button
              testID="texts-quiet-save"
              label={t('texts.quietSave')}
              busy={busy === 'quiet'}
              disabled={!fromOk || !toOk || busy !== null}
              onPress={() => void save('quiet', { quiet_from: from.trim(), quiet_to: to.trim() }, t('texts.quietSaved'))}
            />
          ) : null}
        </>
      )}
      {said ? (
        <Notice tone="ok" testID="texts-said">
          {said}
        </Notice>
      ) : null}
      {problem ? (
        <Notice tone="warn" testID="texts-problem">
          {problem}
        </Notice>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: sp(12) },
  flex: { flex: 1, gap: sp(4) },
  times: { flexDirection: 'row', gap: sp(12) },
});
