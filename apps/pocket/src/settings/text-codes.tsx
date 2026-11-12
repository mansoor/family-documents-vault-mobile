import { SMS_FACTOR_WARNING, type TextCodeSettings } from '@fdv/shared';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Switch, View } from 'react-native';
import { wordsFor } from '../errors/words';
import { on } from '../state/events';
import { useStepUp } from '../state/step-up';
import { useVault } from '../state/vault';
import { Card, Notice, Text } from '../ui';
import { sp } from '../ui/space';

/**
 * Account → Codes by text (SMS4; the vault's SMS3, 0.9.0-dev.33): a code
 * texted to the person's confirmed number when they sign in, and when they
 * set a new password. Each turned on or off after confirming it's them.
 * Said plainly beside it: a text is the weakest second step (SIM swap), as
 * well as a passkey or an authenticator app, not instead — and an owner
 * cannot make it their only one (the vault says why, `why_not`).
 */
export function TextCodes() {
  const { t } = useTranslation();
  const { caps, withToken } = useVault();
  const { guarded } = useStepUp();
  const [state, setState] = useState<TextCodeSettings | null>(null);
  const [busy, setBusy] = useState<'sign_in' | 'reset' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const offered = caps?.features.sms_codes === true;

  const load = useCallback(async () => {
    if (!offered) return;
    try {
      setState(await withToken((a, tk) => a.textCodeSettings(tk)));
    } catch {
      // No answer: nothing offered here.
    }
  }, [offered, withToken]);
  useEffect(() => {
    // Asked on arrival, and again when the number changes on this screen.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    return on('phoneChanged', () => void load());
  }, [load]);

  if (!offered || !state) return null;
  // Nothing to say until texts are set up, unless one is already on.
  if (!state.sms_ready && !state.sign_in && !state.reset) return null;

  const set = async (which: 'sign_in' | 'reset', value: boolean) => {
    setBusy(which);
    setProblem(null);
    try {
      const next = await guarded((a, tk) => a.setTextCodeSettings(tk, { [which]: value }));
      if (next) setState(next);
    } catch (err) {
      setProblem(wordsFor(err, t));
    } finally {
      setBusy(null);
    }
  };

  const row = (which: 'sign_in' | 'reset', label: string, hint: string) => {
    const value = state[which];
    return (
      <View style={styles.row}>
        <View style={styles.flex}>
          <Text weight="600">{label}</Text>
          <Text variant="secondary" tone="soft">
            {hint}
          </Text>
        </View>
        <Switch
          testID={`text-codes-${which === 'sign_in' ? 'sign-in' : 'reset'}`}
          accessibilityLabel={label}
          value={value}
          disabled={busy !== null || (!value && !state.can_turn_on)}
          onValueChange={(v) => void set(which, v)}
        />
      </View>
    );
  };

  return (
    <Card>
      <Text variant="screen">{t('textCodes.title')}</Text>
      {state.phone && state.phone_confirmed ? (
        <Text variant="secondary" tone="soft" testID="text-codes-to">
          {t('textCodes.to', { to: state.phone })}
        </Text>
      ) : null}
      {row('sign_in', t('textCodes.signIn'), t('textCodes.signInHint'))}
      {row('reset', t('textCodes.reset'), t('textCodes.resetHint'))}
      {!state.can_turn_on && state.why_not ? (
        <Text variant="secondary" tone="soft" testID="text-codes-why-not">
          {state.why_not}
        </Text>
      ) : null}
      <Notice tone="warn" testID="text-codes-warning">
        {SMS_FACTOR_WARNING}
      </Notice>
      {problem ? (
        <Notice tone="warn" testID="text-codes-problem">
          {problem}
        </Notice>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: sp(12) },
  flex: { flex: 1, gap: sp(4) },
});
