import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EssentialsNotice, KeptWhileSignedOut } from '../essentials/ui';
import { useCapture } from '../state/capture';
import { useEssentials } from '../state/essentials';
import { useVault, type SignInResult } from '../state/vault';
import { wordsFor } from '../errors/words';
import { Button, Card, Field, Notice, Text } from '../ui';
import { Sheet } from '../ui/sheet';
import { sp } from '../ui/space';

/**
 * Sign in: email and password, then the six-digit code if the account has
 * two-step sign-in — from the authenticator app, or texted to the person's
 * own number where they turned that on (0.9.0-dev.33, SMS3), either way
 * where both are. A wrong password shows the vault's own words. A
 * sign-in an owner paused — locked, or waiting after a restore (5.28) —
 * says so plainly, whether the vault ended the session or refused the
 * sign-in: nothing went wrong, and the person is told whom to ask. So does
 * a guest's whose access has ended (5.34, 5.36).
 */
export default function SignIn() {
  const { t } = useTranslation();
  const { vault, caps, notice, signIn, signInCode, sendSignInText, chooseAnotherVault, api } = useVault();
  const { waitingHere } = useCapture();
  const essentials = useEssentials();
  // Kept until the sign-in completes (past the code step): it renews the
  // grant for Essentials kept here, so they are not asked for it again.
  const typed = useRef('');
  const [email, setEmail] = useState(vault?.email ?? '');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'password' | 'code'>('password');
  // The second step's ways (SMS3), and which one this code is.
  const [second, setSecond] = useState<Extract<SignInResult, { kind: 'code' }> | null>(null);
  const [method, setMethod] = useState<'totp' | 'text'>('totp');
  const [textedTo, setTextedTo] = useState<string | null>(null);
  const [textProblem, setTextProblem] = useState<string | null>(null);
  const [texting, setTexting] = useState(false);
  const sendText = async () => {
    if (texting) return;
    setTexting(true);
    setTextProblem(null);
    try {
      const r = await sendSignInText();
      if ('sentTo' in r) {
        setTextedTo(r.sentTo);
        setMethod('text');
        setCode('');
      } else setTextProblem(r.problem);
    } finally {
      setTexting(false);
    }
  };
  // Forgot your password? (the owner's ask of 12 Nov 2026): a link by email, as the web sends it.
  const [forgetting, setForgetting] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSaid, setForgotSaid] = useState<string | null>(null);
  const [forgotProblem, setForgotProblem] = useState<string | null>(null);
  const [forgotBusy, setForgotBusy] = useState(false);
  const sendLink = async () => {
    if (!api || forgotBusy || !forgotEmail.trim()) return;
    setForgotBusy(true);
    setForgotProblem(null);
    try {
      const r = await api.forgotPassword(forgotEmail.trim());
      setForgotSaid(r.message || t('signIn.forgotSent'));
    } catch (err) {
      setForgotProblem(wordsFor(err, t));
    } finally {
      setForgotBusy(false);
    }
  };
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Exclude<SignInResult, { kind: 'ok' } | { kind: 'code' }> | null>(null);

  const name = caps?.branding.display_name ?? vault?.displayName ?? '';

  async function submit() {
    setBusy(true);
    setFailure(null);
    try {
      if (step === 'password') typed.current = password;
      const r = step === 'password' ? await signIn(email, password) : await signInCode(code, second ? method : undefined);
      if (r.kind === 'code') {
        setStep('code');
        setPassword('');
        setSecond(r);
        // A text already gone, or a text the only way: the code is the text's.
        const byText = r.textSent || !r.methods.includes('totp');
        setMethod(byText ? 'text' : 'totp');
        setTextedTo(r.textSent ? r.textTo : null);
        setTextProblem(null);
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
          {notice === 'paused' && failure?.kind !== 'paused' ? (
            <Notice tone="warn" testID="sign-in-paused">
              {t('signIn.paused')}
            </Notice>
          ) : null}
          {notice === 'access_ended' || failure?.kind === 'access_ended' ? (
            <Notice tone="warn" testID="sign-in-access-ended">
              {t('signIn.accessEnded')}
            </Notice>
          ) : null}
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
                {method === 'totp' ? (
                  <Text testID="sign-in-code-app">{t('signIn.codeStep')}</Text>
                ) : textedTo ? (
                  <Text testID="sign-in-code-texted">{t('signIn.codeTexted', { to: textedTo })}</Text>
                ) : (
                  <Text testID="sign-in-code-text-offer">{t('signIn.codeTextOffer', { to: second?.textTo ?? '' })}</Text>
                )}
                {method === 'text' && !textedTo ? (
                  <Button testID="sign-in-text-send" label={t('signIn.textMe')} busy={texting} onPress={() => void sendText()} />
                ) : (
                  <Field
                    testID="sign-in-code"
                    label={t('signIn.code')}
                    value={code}
                    onChangeText={setCode}
                    keyboardType="number-pad"
                    textContentType="oneTimeCode"
                    // A texted code: Android offers it from the message as it comes.
                    autoComplete={method === 'text' ? 'sms-otp' : 'one-time-code'}
                    maxLength={9}
                    returnKeyType="go"
                    onSubmitEditing={() => void submit()}
                  />
                )}
                {textProblem ? (
                  <Notice tone="warn" testID="sign-in-text-problem">
                    {textProblem}
                  </Notice>
                ) : null}
                {method === 'text' && textedTo ? (
                  <Button
                    testID="sign-in-text-again"
                    kind="quiet"
                    size="small"
                    label={t('signIn.textAgain')}
                    busy={texting}
                    onPress={() => void sendText()}
                  />
                ) : null}
                {second && second.methods.includes('text') && second.methods.includes('totp') ? (
                  <Button
                    testID="sign-in-code-switch"
                    kind="quiet"
                    size="small"
                    label={method === 'totp' ? t('signIn.useText') : t('signIn.useApp')}
                    onPress={() => {
                      setCode('');
                      setTextProblem(null);
                      setMethod(method === 'totp' ? 'text' : 'totp');
                    }}
                  />
                ) : null}
              </>
            )}
            {step === 'password' ? (
              <Button
                testID="sign-in-forgot"
                kind="quiet"
                size="small"
                label={t('signIn.forgot')}
                onPress={() => {
                  setForgotEmail(email);
                  setForgotSaid(null);
                  setForgotProblem(null);
                  setForgetting(true);
                }}
              />
            ) : null}
            <Button
              testID="sign-in-go"
              label={step === 'password' ? t('signIn.signIn') : t('signIn.confirm')}
              onPress={() => void submit()}
              busy={busy}
              disabled={
                step === 'password'
                  ? !email.trim() || !password
                  : code.replace(/\s/g, '').length < 6 || (method === 'text' && !textedTo)
              }
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
          {failure?.kind === 'paused' ? (
            <Notice tone="warn" testID="sign-in-paused">
              {failure.reason === 'restored' ? t('signIn.pausedRestored') : t('signIn.paused')}
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
      <Sheet visible={forgetting} onClose={() => setForgetting(false)} testID="forgot-sheet" keyboard>
        <Text variant="screen">{t('signIn.forgotTitle')}</Text>
        <Text>{t('signIn.forgotWords')}</Text>
        {forgotSaid ? (
          <Notice tone="ok" testID="forgot-said">
            {forgotSaid}
          </Notice>
        ) : (
          <>
            <Field
              testID="forgot-email"
              label={t('signIn.email')}
              value={forgotEmail}
              onChangeText={setForgotEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              textContentType="emailAddress"
              autoComplete="email"
              returnKeyType="send"
              onSubmitEditing={() => void sendLink()}
            />
            {forgotProblem ? (
              <Notice tone="warn" testID="forgot-problem">
                {forgotProblem}
              </Notice>
            ) : null}
            <Button
              testID="forgot-send"
              label={t('signIn.forgotSend')}
              busy={forgotBusy}
              disabled={!forgotEmail.trim()}
              onPress={() => void sendLink()}
            />
          </>
        )}
        <Button
          testID="forgot-close"
          kind="quiet"
          label={forgotSaid ? t('row.done') : t('common.cancel')}
          onPress={() => setForgetting(false)}
        />
      </Sheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  page: { padding: sp(20), gap: sp(16) },
});
