import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EssentialsNotice, KeptWhileSignedOut } from '../essentials/ui';
import { useCapture } from '../state/capture';
import { useEssentials } from '../state/essentials';
import { useVault, type SignInResult } from '../state/vault';
import { Button, Card, Field, Notice, Text } from '../ui';

/**
 * Sign in: email and password, then the six-digit code if the account has
 * two-step sign-in. A wrong password shows the vault's own words.
 */
export default function SignIn() {
  const { t } = useTranslation();
  const { vault, caps, notice, signIn, signInCode, chooseAnotherVault } = useVault();
  const { waitingHere } = useCapture();
  const essentials = useEssentials();
  // Kept until the sign-in completes (past the code step): it renews the
  // grant for Essentials kept here, so they are not asked for it again.
  const typed = useRef('');
  const [email, setEmail] = useState(vault?.email ?? '');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'password' | 'code'>('password');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Exclude<SignInResult, { kind: 'ok' } | { kind: 'code' }> | null>(null);

  const name = caps?.branding.display_name ?? vault?.displayName ?? '';

  async function submit() {
    setBusy(true);
    setFailure(null);
    try {
      if (step === 'password') typed.current = password;
      const r = step === 'password' ? await signIn(email, password) : await signInCode(code);
      if (r.kind === 'code') {
        setStep('code');
        setPassword('');
      } else if (r.kind === 'ok') {
        void essentials.signedInWith(typed.current);
        typed.current = '';
      } else {
        setFailure(r);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.safe}>
        <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
          <Text variant="hero">{t('signIn.title')}</Text>
          {name ? <Text tone="soft">{t('signIn.to', { name })}</Text> : null}
          {notice === 'signed_out_here' ? <Notice tone="warn">{t('signIn.signedOutHere')}</Notice> : null}
          {waitingHere > 0 ? (
            <Notice tone="info" testID="sign-in-waiting">
              {t('signIn.waiting', { count: waitingHere })}
            </Notice>
          ) : null}
          {notice === 'reinstalled' ? <Notice tone="warn">{t('connect.reinstalled')}</Notice> : null}
          <Card>
            {step === 'password' ? (
              <>
                <Field
                  testID="sign-in-email"
                  label={t('signIn.email')}
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  textContentType="username"
                  autoComplete="email"
                />
                <Field
                  testID="sign-in-password"
                  label={t('signIn.password')}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  textContentType="password"
                  autoComplete="current-password"
                  returnKeyType="go"
                  onSubmitEditing={() => void submit()}
                />
              </>
            ) : (
              <>
                <Text>{t('signIn.codeStep')}</Text>
                <Field
                  testID="sign-in-code"
                  label={t('signIn.code')}
                  value={code}
                  onChangeText={setCode}
                  keyboardType="number-pad"
                  textContentType="oneTimeCode"
                  autoComplete="one-time-code"
                  maxLength={9}
                  returnKeyType="go"
                  onSubmitEditing={() => void submit()}
                />
              </>
            )}
            <Button
              testID="sign-in-go"
              label={step === 'password' ? t('signIn.signIn') : t('signIn.confirm')}
              onPress={() => void submit()}
              busy={busy}
              disabled={step === 'password' ? !email.trim() || !password : code.replace(/\s/g, '').length < 6}
            />
          </Card>
          {failure?.kind === 'refused' ? (
            <Notice tone="danger" testID="sign-in-refused">
              <Text>{failure.message}</Text>
              {failure.passkeyHint ? (
                <Text tone="soft" variant="secondary">
                  {t('signIn.passkeyOnly')}
                </Text>
              ) : null}
            </Notice>
          ) : null}
          {failure?.kind === 'unreachable' ? (
            <Notice tone="danger">
              {t('connect.unreachable', { host: vault?.origin.replace(/^https?:\/\//, '') ?? '' })}
            </Notice>
          ) : null}
          {failure?.kind === 'stranger' ? (
            <Notice tone="danger">
              {t('connect.stranger', { host: vault?.origin.replace(/^https?:\/\//, '') ?? '' })}
            </Notice>
          ) : null}
          {failure?.kind === 'wifi_only' ? (
            <Notice tone="warn" testID="sign-in-wifi-only">
              {t('connect.refuseMobileData')}
            </Notice>
          ) : null}
          <EssentialsNotice />
          <KeptWhileSignedOut />
          <Button kind="quiet" label={t('signIn.otherVault')} onPress={() => void chooseAnotherVault()} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  page: { padding: 20, gap: 16 },
});
