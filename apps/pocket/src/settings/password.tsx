import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { wordsFor } from '../errors/words';
import { useStepUp } from '../state/step-up';
import { Button, Card, Field, Notice, Text } from '../ui';
import { sp } from '../ui/space';

/** As the vault asks (POST /auth/password/change): at least this many characters. */
export const PASSWORD_MIN = 10;

/**
 * Account → Change your password (the owner's ask of 12 Nov 2026), as the
 * web's: the password now (left empty by somebody who signs in with a
 * passkey and never set one: the vault then asks them to confirm it is
 * them), and the new one. It also unlocks their own Only me documents, so
 * the vault brings those with it; every other device is signed out.
 */
export function ChangePassword() {
  const { t } = useTranslation();
  const { guarded } = useStepUp();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const save = async () => {
    if (busy || next.length < PASSWORD_MIN) return;
    setBusy(true);
    setProblem(null);
    try {
      const changed = await guarded(async (a, tk) => {
        await a.changePassword(tk, { ...(current ? { current_password: current } : {}), new_password: next });
        return true;
      });
      if (!changed) return;
      setCurrent('');
      setNext('');
      setOpen(false);
      setDone(true);
    } catch (err) {
      setProblem(wordsFor(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Text variant="screen">{t('password.title')}</Text>
      {done ? (
        <Notice tone="ok" testID="password-done">
          {t('password.done')}
        </Notice>
      ) : null}
      {open ? (
        <View style={styles.form}>
          <Field
            testID="password-current"
            label={t('password.current')}
            value={current}
            onChangeText={setCurrent}
            secureTextEntry
            textContentType="password"
            autoComplete="current-password"
          />
          <Text variant="small" tone="soft">
            {t('password.currentHint')}
          </Text>
          <Field
            testID="password-new"
            label={t('password.next')}
            value={next}
            onChangeText={setNext}
            secureTextEntry
            textContentType="newPassword"
            autoComplete="new-password"
          />
          <Text variant="small" tone="soft">
            {t('password.nextHint', { count: PASSWORD_MIN })}
          </Text>
          <Text variant="secondary" tone="soft">
            {t('password.onlyMe')}
          </Text>
          {problem ? (
            <Notice tone="warn" testID="password-problem">
              {problem}
            </Notice>
          ) : null}
          <Button
            testID="password-save"
            label={t('password.save')}
            busy={busy}
            disabled={next.length < PASSWORD_MIN}
            onPress={() => void save()}
          />
          <Button
            testID="password-cancel"
            kind="quiet"
            label={t('common.cancel')}
            disabled={busy}
            onPress={() => {
              setOpen(false);
              setProblem(null);
            }}
          />
        </View>
      ) : (
        <Button
          testID="password-open"
          kind="quiet"
          label={t('password.open')}
          onPress={() => {
            setDone(false);
            setOpen(true);
          }}
        />
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  form: { gap: sp(12) },
});
