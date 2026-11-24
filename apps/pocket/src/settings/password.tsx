import { ApiRequestError } from '@fdv/client';
import {
  PASSWORD_RULES_CODE,
  passwordLacks,
  passwordRefusalWords,
  passwordRulesOf,
  passwordRulesWords,
  type PasswordRules,
} from '@fdv/shared';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { wordsFor } from '../errors/words';
import { useStepUp } from '../state/step-up';
import { useVault } from '../state/vault';
import { Button, Card, Field, Notice, Text } from '../ui';
import { sp } from '../ui/space';

/** As a vault from before password rules asks (POST /auth/password/change): at least this many characters. */
export const PASSWORD_MIN = 10;

/**
 * Whether the new password has what is asked of it: the household's
 * length and mix where the vault has said its rules, otherwise the ten
 * characters a vault from before them asks. Whether it is common is the
 * vault's to say, never the phone's.
 */
export function passwordFits(password: string, rules: PasswordRules | null): boolean {
  return rules ? passwordLacks(password, rules).length === 0 : password.length >= PASSWORD_MIN;
}

/** What the new password still lacks, in the vault's words; null once it has it all, or nothing is typed. */
export function passwordStillLacks(password: string, rules: PasswordRules | null): string | null {
  if (!rules || password.length === 0) return null;
  const lacks = passwordLacks(password, rules);
  return lacks.length === 0 ? null : passwordRefusalWords(lacks, rules);
}

/**
 * Account → Change your password (the owner's ask of 12 Nov 2026), as the
 * web's: the password now (left empty by somebody who signs in with a
 * passkey and never set one: the vault then asks them to confirm it is
 * them), and the new one. It also unlocks their own Only me documents, so
 * the vault brings those with it; every other device is signed out.
 *
 * Password rules (app 0.25.0; the vault's `features.password_rules`): the
 * household's rules are asked for as the form opens, said under the new
 * password ("At least 12 characters, with a number. Not a common password,
 * nor your name or email address."), what it still lacks of their length
 * and mix said as it is typed, and Change it waits until it has them. The
 * vault's refusal (`400 password_rules`: a common password, say) is shown
 * in its own words under the new password, never as a wrong password now.
 * A vault from before them, or rules that could not be read, keep the ten
 * characters it asked before.
 */
export function ChangePassword() {
  const { t } = useTranslation();
  const { caps, withToken } = useVault();
  const { guarded } = useStepUp();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // The vault's refusal of the new password itself, in its words.
  const [refused, setRefused] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // The household's rules, once the vault has said them; null for a vault
  // from before them, and while they load or when they could not be read.
  const [rules, setRules] = useState<PasswordRules | null>(null);
  const hasRules = caps?.features.password_rules === true;

  const loadRules = useCallback(async () => {
    if (!hasRules) return;
    try {
      setRules(passwordRulesOf(await withToken((a, tk) => a.passwordRules(tk))));
    } catch {
      // Not read: the ten characters asked before stand, and the vault still decides.
    }
  }, [hasRules, withToken]);
  useEffect(() => {
    // Asked as the form opens, so the rules said are the household's now.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) void loadRules();
  }, [open, loadRules]);

  const fits = passwordFits(next, rules);
  const lacks = passwordStillLacks(next, rules);

  const save = async () => {
    if (busy || !fits) return;
    setBusy(true);
    setProblem(null);
    setRefused(null);
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
      // The new password refused by the household's rules: the vault's own words, by the new password.
      if (err instanceof ApiRequestError && err.code === PASSWORD_RULES_CODE && err.message) setRefused(err.message);
      else setProblem(wordsFor(err, t));
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
            onChangeText={(v) => {
              setNext(v);
              setRefused(null);
            }}
            error={refused}
            secureTextEntry
            textContentType="newPassword"
            autoComplete="new-password"
          />
          <Text variant="small" tone="soft" testID="password-hint">
            {rules
              ? t('password.rulesHint', { rules: passwordRulesWords(rules) })
              : t('password.nextHint', { count: PASSWORD_MIN })}
          </Text>
          {lacks ? (
            <Text variant="small" tone="soft" testID="password-lacks">
              {lacks}
            </Text>
          ) : null}
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
            disabled={!fits}
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
              setRefused(null);
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
