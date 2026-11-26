import type { RecoveryWay } from '@fdv/shared';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EssentialsNotice, KeptWhileSignedOut } from '../essentials/ui';
import { useCapture } from '../state/capture';
import { useEssentials } from '../state/essentials';
import { useScreenGuard } from '../state/lock';
import { useVault, type SignInResult } from '../state/vault';
import { wordsFor } from '../errors/words';
import { Button, Card, Field, Notice, Text } from '../ui';
import { FormScroll } from '../ui/keyboard';
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
 *
 * Getting back in without the second step (0.9.0-dev.104), as the web's
 * sign-in offers it: under the code, Use a recovery code and Answer your
 * security questions, where the vault says they may stand in
 * (`MfaChallenge.recovery`). Each asks for a new password too, which
 * replaces the old one there and then. A code by text that can't be sent
 * refuses the sign-in (`409 text_code_unavailable`): the vault's words,
 * and only the stand-ins it has — or, when nothing here can finish it, its
 * passkey in the browser, or a reset an owner sends. Signed in so, the
 * session sets up two-step sign-in again (update/gate.tsx).
 */
export default function SignIn() {
  const { t } = useTranslation();
  const {
    vault,
    caps,
    notice,
    signIn,
    signInCode,
    sendSignInText,
    signInQuestions,
    signInStandIn,
    chooseAnotherVault,
    api,
  } = useVault();
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
  // What stands in for a lost second step (0.9.0-dev.104): which is chosen,
  // which the vault offers, and a sign-in only a stand-in can finish here.
  const [way, setWay] = useState<'second_step' | RecoveryWay>('second_step');
  const [ways, setWays] = useState<RecoveryWay[]>([]);
  const [onlyStandIn, setOnlyStandIn] = useState<Extract<SignInResult, { kind: 'stand_in' }> | null>(null);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [questions, setQuestions] = useState<string[] | null>(null);
  const [answers, setAnswers] = useState<string[]>([]);
  // Chosen as a code or the answers stand in: the password somebody else may know never gets in again.
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordRefused, setNewPasswordRefused] = useState<string | null>(null);
  const [standInProblem, setStandInProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<
    Exclude<SignInResult, { kind: 'ok' } | { kind: 'code' } | { kind: 'stand_in' } | { kind: 'password_refused' }> | null
  >(null);
  // Too many tries (the vault's 0.9.0): when it takes another, and the button waits until then.
  const [waitUntil, setWaitUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (waitUntil === null) return;
    const timer = setInterval(() => {
      const at = Date.now();
      setNow(at);
      if (at >= waitUntil) setWaitUntil(null);
    }, 1000);
    return () => clearInterval(timer);
  }, [waitUntil]);
  const left = waitUntil === null ? 0 : Math.max(0, Math.ceil((waitUntil - now) / 1000));

  const name = caps?.branding.display_name ?? vault?.displayName ?? '';

  /**
   * What the vault answered, other than the next step: signed in, or why
   * not. `password` is the one the sign-in set, when it set one (a
   * stand-in's new password): only then, once it is in, does it open
   * Essentials kept here.
   */
  function answered(r: SignInResult, password?: string) {
    if (r.kind === 'ok') {
      void essentials.signedInWith(password ?? typed.current);
      typed.current = '';
    } else if (r.kind === 'password_refused') {
      setNewPasswordRefused(r.message);
    } else if (r.kind !== 'code' && r.kind !== 'stand_in') {
      if (r.kind === 'throttled') {
        const at = Date.now();
        setNow(at);
        setWaitUntil(at + r.seconds * 1000);
      }
      setFailure(r);
    }
  }

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
        setWays(r.recovery);
        // A text already gone, or a text the only way: the code is the text's.
        const byText = r.textSent || !r.methods.includes('totp');
        setMethod(byText ? 'text' : 'totp');
        setTextedTo(r.textSent ? r.textTo : null);
        setTextProblem(null);
      } else if (r.kind === 'stand_in') {
        setStep('code');
        setPassword('');
        setSecond(null);
        setWays(r.recovery);
        setOnlyStandIn(r);
      } else answered(r);
    } finally {
      setBusy(false);
    }
  }

  /** The security questions, asked for as they are chosen, and again with Try again. */
  const askQuestions = async () => {
    setBusy(true);
    setStandInProblem(null);
    try {
      const asked = await signInQuestions();
      if ('questions' in asked) {
        setQuestions(asked.questions);
        setAnswers(asked.questions.map(() => ''));
      } else setStandInProblem(asked.problem);
    } finally {
      setBusy(false);
    }
  };

  /** One of what stands in for the second step, chosen. */
  const choose = async (next: RecoveryWay) => {
    setFailure(null);
    setStandInProblem(null);
    setWay(next);
    if (next === 'security_questions' && !questions) await askQuestions();
  };

  /** The recovery code, or the answers, in place of the second step, with the new password. */
  const standIn = async () => {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    setStandInProblem(null);
    setNewPasswordRefused(null);
    try {
      // The new password opens Essentials kept here from now on — once it is set, and not before.
      const chosen = newPassword;
      answered(await signInStandIn(way === 'recovery_code' ? { code: recoveryCode } : { answers }, chosen), chosen);
    } finally {
      setBusy(false);
    }
  };

  /** Back to the email and password, as if nothing had been typed after them. */
  const startAgain = () => {
    setStep('password');
    setSecond(null);
    setCode('');
    setTextedTo(null);
    setTextProblem(null);
    setWay('second_step');
    setWays([]);
    setOnlyStandIn(null);
    setRecoveryCode('');
    setQuestions(null);
    setAnswers([]);
    setNewPassword('');
    setNewPasswordRefused(null);
    setStandInProblem(null);
    setFailure(null);
    typed.current = '';
  };

  // A stand-in chosen, or the only way on from here.
  const standingIn = step === 'code' && (way !== 'second_step' || onlyStandIn !== null);
  // A recovery code or the answers on the screen: never in a screenshot or the recent apps view.
  useScreenGuard('sign-in-stand-in', standingIn && way !== 'second_step');
  const standInReady =
    newPassword !== '' &&
    (way === 'recovery_code'
      ? recoveryCode.trim() !== ''
      : way === 'security_questions' && questions !== null && answers.every((a) => a.trim() !== ''));
  // What stands in, as quiet buttons under the second step.
  const standInLinks = (
    <>
      {ways.includes('recovery_code') && way !== 'recovery_code' ? (
        <Button
          testID="sign-in-use-recovery-code"
          kind="quiet"
          size="small"
          label={t('signIn.useRecoveryCode')}
          onPress={() => void choose('recovery_code')}
        />
      ) : null}
      {ways.includes('security_questions') && way !== 'security_questions' ? (
        <Button
          testID="sign-in-use-questions"
          kind="quiet"
          size="small"
          label={t('signIn.useQuestions')}
          onPress={() => void choose('security_questions')}
        />
      ) : null}
      {way !== 'second_step' && !onlyStandIn ? (
        <Button
          testID="sign-in-use-second-step"
          kind="quiet"
          size="small"
          label={t('signIn.useSecondStep')}
          onPress={() => {
            setWay('second_step');
            setStandInProblem(null);
            setFailure(null);
          }}
        />
      ) : null}
    </>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <FormScroll contentContainerStyle={styles.page}>
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
          {standingIn ? (
            <View style={styles.form}>
              <Text variant="title" testID="sign-in-stand-in-title">
                {way === 'recovery_code'
                  ? t('signIn.recoveryTitle')
                  : way === 'security_questions'
                    ? t('signIn.questionsTitle')
                    : t('signIn.oneMoreStep')}
              </Text>
              <Text testID="sign-in-stand-in-words">
                {way === 'recovery_code'
                  ? t('signIn.recoveryWords')
                  : way === 'security_questions'
                    ? t('signIn.questionsWords')
                    : (onlyStandIn?.refused ?? t('signIn.passkeySecond'))}
              </Text>
              {way === 'second_step' && onlyStandIn?.refused && onlyStandIn.passkey ? (
                // The phone has no passkeys: one of theirs signs them in, in the browser.
                <Text tone="soft" variant="secondary" testID="sign-in-passkey-browser">
                  {t('signIn.passkeyBrowser')}
                </Text>
              ) : null}
              {way !== 'second_step' ? (
                <Text tone="soft" variant="secondary" testID="sign-in-stand-in-warning">
                  {t('signIn.standInWarning')}
                </Text>
              ) : null}
              {way === 'recovery_code' ? (
                <Field
                  key="sign-in-recovery-code"
                  testID="sign-in-recovery-code"
                  label={t('signIn.recoveryCode')}
                  value={recoveryCode}
                  onChangeText={setRecoveryCode}
                  placeholder="xxxxx-xxxxx"
                  autoComplete="off"
                  importantForAutofill="no"
                />
              ) : null}
              {way === 'security_questions'
                ? (questions ?? []).map((q, i) => (
                    <Field
                      key={`sign-in-answer-${i}`}
                      testID={`sign-in-answer-${i}`}
                      label={q}
                      value={answers[i] ?? ''}
                      autoComplete="off"
                      importantForAutofill="no"
                      onChangeText={(v) => setAnswers(answers.map((a, j) => (j === i ? v : a)))}
                    />
                  ))
                : null}
              {way !== 'second_step' ? (
                <>
                  <Field
                    key="sign-in-new-password"
                    testID="sign-in-new-password"
                    label={t('signIn.newPassword')}
                    value={newPassword}
                    onChangeText={(v) => {
                      setNewPassword(v);
                      setNewPasswordRefused(null);
                    }}
                    error={newPasswordRefused}
                    secureTextEntry
                    textContentType="newPassword"
                    autoComplete="new-password"
                    returnKeyType="go"
                    onSubmitEditing={() => {
                      if (standInReady) void standIn();
                    }}
                  />
                  <Text variant="small" tone="soft">
                    {t('signIn.newPasswordHint')}
                  </Text>
                </>
              ) : null}
              {standInProblem ? (
                <Notice tone="warn" testID="sign-in-stand-in-problem">
                  {standInProblem}
                </Notice>
              ) : null}
              {way === 'security_questions' && questions === null && !busy ? (
                // The questions didn't come: asked for again, rather than only Start again.
                <Button
                  testID="sign-in-questions-again"
                  kind="quiet"
                  label={t('common.tryAgain')}
                  onPress={() => void askQuestions()}
                />
              ) : null}
              {way !== 'second_step' ? (
                <Button
                  testID="sign-in-stand-in-go"
                  label={t('signIn.continue')}
                  busy={busy}
                  disabled={left > 0 || !standInReady}
                  onPress={() => void standIn()}
                />
              ) : null}
              {standInLinks}
              <Button
                testID="sign-in-start-again"
                kind="quiet"
                size="small"
                label={t('signIn.startAgainButton')}
                onPress={startAgain}
              />
            </View>
          ) : step === 'password' ? (
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
                // Its own native field: the code's field below must never
                // be this one reused, or Android can carry the password's
                // text into the code (seen in an emulator run).
                key="sign-in-password"
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
                  key="sign-in-code"
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
              {standInLinks}
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
          {standingIn ? null : (
            <Button
              testID="sign-in-go"
              label={step === 'password' ? t('signIn.signIn') : t('signIn.confirm')}
              onPress={() => void submit()}
              busy={busy}
              disabled={
                left > 0 ||
                (step === 'password'
                  ? !email.trim() || !password
                  : code.replace(/\s/g, '').length < 6 || (method === 'text' && !textedTo))
              }
            />
          )}
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
        {failure?.kind === 'throttled' && left > 0 ? (
          <Notice tone="warn" testID="sign-in-throttled">
            {left >= 60
              ? t('signIn.throttledMinutes', { count: Math.ceil(left / 60) })
              : t('signIn.throttledSeconds', { count: left })}
          </Notice>
        ) : null}
        {failure?.kind === 'passkey_only' ? (
          <Notice tone="warn" testID="sign-in-passkey-second">
            {t('signIn.passkeySecond')}
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
      </FormScroll>
      <Sheet visible={forgetting} onClose={() => setForgetting(false)} testID="forgot-sheet">
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
  form: { gap: sp(12) },
});
