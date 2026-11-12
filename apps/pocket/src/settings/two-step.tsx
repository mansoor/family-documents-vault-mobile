import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, View } from 'react-native';
import { wordsFor } from '../errors/words';
import { copyForAMinute, nativeClipboard } from '../identity/clipboard';
import { useStepUp } from '../state/step-up';
import { useVault } from '../state/vault';
import { Button, Card, Field, Notice, Text } from '../ui';
import { Sheet } from '../ui/sheet';
import { sp } from '../ui/space';

/**
 * Account → Two-step sign-in (the owner's ask of 12 Nov 2026), as the
 * web's: a six-digit code from an authenticator app asked at each sign-in
 * after the password. Set up from the phone: the vault makes a secret
 * (after confirming it is them), the phone opens it in the authenticator
 * app on this phone (or shows it, to copy or type), and a code from the
 * app confirms it. Turned off with a code, unless the household requires it
 * (an owner's). Passkeys stay in the browser.
 */
export function TwoStep() {
  const { t } = useTranslation();
  const { withToken } = useVault();
  const { guarded } = useStepUp();
  const [state, setState] = useState<{ enabled: boolean; required: boolean } | null>(null);
  const [setup, setSetup] = useState<{ secret: string; url: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [turningOff, setTurningOff] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const me = await withToken((a, tk) => a.me(tk));
      setState({ enabled: me.totp_enabled === true, required: me.totp_required === true });
    } catch {
      // No answer: said by the screen's other cards; nothing offered here.
    }
  }, [withToken]);
  useEffect(() => {
    // Asked on arrival; set when the vault answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setProblem(null);
    try {
      await task();
    } catch (err) {
      setProblem(wordsFor(err, t));
    } finally {
      setBusy(false);
    }
  };

  const begin = () =>
    run(async () => {
      setSaid(null);
      const made = await guarded((a, tk) => a.totpEnrol(tk));
      if (!made) return;
      setCode('');
      setCopied(false);
      setSetup({ secret: made.secret, url: made.otpauth_url });
    });

  const confirm = () =>
    run(async () => {
      const done = await guarded(async (a, tk) => {
        await a.totpConfirm(tk, code.replace(/\s/g, ''));
        return true;
      });
      if (!done) return;
      setSetup(null);
      setCode('');
      setSaid(t('twoStep.on'));
      await load();
    });

  const turnOff = () =>
    run(async () => {
      // The client has no call of its own for it yet: the route the web uses.
      await withToken((a, tk) =>
        a.http.request<void>('/api/v1/auth/totp/disable', {
          method: 'POST',
          body: { code: code.replace(/\s/g, '') },
          token: tk,
        }),
      );
      setTurningOff(false);
      setCode('');
      setSaid(t('twoStep.off'));
      await load();
    });

  if (!state) return null;
  const clipboard = nativeClipboard();
  return (
    <Card>
      <Text variant="screen">{t('twoStep.title')}</Text>
      <Text variant="secondary" tone="soft" testID="two-step-state">
        {state.enabled ? t('twoStep.isOn') : t('twoStep.isOff')}
      </Text>
      {said ? (
        <Notice tone="ok" testID="two-step-said">
          {said}
        </Notice>
      ) : null}
      {problem && !turningOff ? (
        <Notice tone="warn" testID="two-step-problem">
          {problem}
        </Notice>
      ) : null}
      {setup ? (
        <View style={styles.form}>
          <Text>{t('twoStep.setupWords')}</Text>
          <Button
            testID="two-step-open-app"
            label={t('twoStep.openApp')}
            onPress={() => void Linking.openURL(setup.url).catch(() => setProblem(t('twoStep.noApp')))}
          />
          <Text variant="secondary" tone="soft">
            {t('twoStep.orType')}
          </Text>
          <Text variant="title" selectable testID="two-step-secret">
            {setup.secret.replace(/(.{4})/g, '$1 ').trim()}
          </Text>
          {clipboard ? (
            <Button
              testID="two-step-copy"
              kind="quiet"
              label={copied ? t('share.copied') : t('twoStep.copy')}
              onPress={() => setCopied(copyForAMinute(clipboard, setup.secret))}
            />
          ) : null}
          <Field
            testID="two-step-code"
            label={t('twoStep.code')}
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            maxLength={9}
          />
          <Button
            testID="two-step-confirm"
            label={t('twoStep.confirm')}
            busy={busy}
            disabled={code.replace(/\s/g, '').length < 6}
            onPress={() => void confirm()}
          />
          <Button testID="two-step-cancel" kind="quiet" label={t('common.cancel')} disabled={busy} onPress={() => setSetup(null)} />
        </View>
      ) : state.enabled ? (
        state.required ? (
          <Text variant="secondary" tone="soft" testID="two-step-required">
            {t('twoStep.required')}
          </Text>
        ) : (
          <Button
            testID="two-step-turn-off"
            kind="quiet"
            label={t('twoStep.turnOff')}
            onPress={() => {
              setProblem(null);
              setCode('');
              setTurningOff(true);
            }}
          />
        )
      ) : (
        <Button testID="two-step-begin" label={t('twoStep.begin')} busy={busy} onPress={() => void begin()} />
      )}
      <Sheet visible={turningOff} onClose={() => setTurningOff(false)} testID="two-step-off-sheet" keyboard>
        <View style={styles.form}>
          <Text variant="screen">{t('twoStep.offTitle')}</Text>
          <Text>{t('twoStep.offWords')}</Text>
          <Field
            testID="two-step-off-code"
            label={t('twoStep.code')}
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            maxLength={9}
          />
          {problem ? (
            <Notice tone="warn" testID="two-step-off-problem">
              {problem}
            </Notice>
          ) : null}
          <Button
            testID="two-step-off-yes"
            kind="danger"
            label={t('twoStep.offYes')}
            busy={busy}
            disabled={code.replace(/\s/g, '').length < 6}
            onPress={() => void turnOff()}
          />
          <Button
            testID="two-step-off-cancel"
            kind="quiet"
            label={t('common.cancel')}
            disabled={busy}
            onPress={() => setTurningOff(false)}
          />
        </View>
      </Sheet>
    </Card>
  );
}

const styles = StyleSheet.create({
  form: { gap: sp(12) },
});
