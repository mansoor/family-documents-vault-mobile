import { ApiRequestError, StepUpCoordinator, type Api, type StepUpRequest } from '@fdv/client';
import { wordsFor } from '../errors/words';
import { FACTOR_STEP_UPS } from '@fdv/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo } from 'react-native';
import { Button, Field, Text } from '../ui';
import { useLock } from './lock';
import { useVault } from './vault';
import { Sheet } from '../ui/sheet';

/**
 * "Confirm it's you" on the phone (4.12, SEC-17): some things the vault
 * asks for again — a sensitive document's pages, saving a copy. The request
 * is refused with `step_up_required`; one sheet asks for the password or an
 * authenticator code (pasting allowed), with the vault's own words, and
 * the request goes again by itself. However many ask at once, one sheet
 * answers them all (the client's StepUpCoordinator). Cancelling is an
 * answer: nothing is done, and nothing lost.
 *
 * Some things take a code and never the password (`FACTOR_STEP_UPS`, A54):
 * another person's identity numbers (`open_identity`, 5.26). For those the
 * sheet asks for the code alone — the phone has no passkeys — and offers
 * no password, which the vault would not take. Somebody whose only second
 * factor is a passkey (GET /me: no authenticator app) has no code to give:
 * the sheet says so, and where it can be done, rather than asking for one.
 *
 * A code by text (0.9.0-dev.33, SMS3): where the vault offers one
 * (`StepUpState.text_to`, for somebody who turned on the sign-in code), the
 * sheet offers Text me a code beside the password — never for what takes a
 * code alone, which a text does not serve.
 */

interface StepUpValue {
  /** `fn` with the session's token; asked to confirm and tried again once, if the vault wants it. Null when not confirmed. */
  guarded<T>(fn: (a: Api, token: string) => Promise<T>): Promise<T | null>;
}

const Ctx = createContext<StepUpValue | null>(null);

/** What is asked, and for a code alone, whether this sign-in has none to give. */
interface Request extends StepUpRequest {
  codeless: boolean;
}

/** One prompt: settled once, and it clears only itself. */
interface Asking {
  message: string;
  /** What asked (the vault's `action`): one of FACTOR_STEP_UPS takes a code alone. */
  action: string;
  /** For a code alone: this sign-in has no authenticator app (a passkey only), so no code can be given. */
  codeless: boolean;
  settle: (ok: boolean) => void;
}

export function StepUpProvider(props: { children: ReactNode }) {
  const { withToken } = useVault();
  const { status } = useLock();
  const [asking, setAsking] = useState<Asking | null>(null);

  const coordinator = useMemo(
    () =>
      new StepUpCoordinator(
        (req) =>
          new Promise<boolean>((settle) => {
            let done = false;
            const self: Asking = {
              message: req.message,
              action: req.action,
              codeless: (req as Request).codeless === true,
              settle: (ok) => {
                if (done) return;
                done = true;
                setAsking((cur) => (cur === self ? null : cur));
                settle(ok);
              },
            };
            setAsking(self);
          }),
      ),
    [],
  );

  // Locked (away too long, or Show mode ended): whatever was asked is not
  // confirmed, and nothing goes on behind the lock screen.
  const open = status === 'unlocked' || status === 'none';
  useEffect(() => {
    if (!open) asking?.settle(false);
  }, [open, asking]);

  const guarded = useCallback(
    async <T,>(fn: (a: Api, token: string) => Promise<T>): Promise<T | null> => {
      try {
        return await withToken(fn);
      } catch (err) {
        if (!(err instanceof ApiRequestError) || err.code !== 'step_up_required') throw err;
        const action = err.action ?? '';
        // A code alone: whether this sign-in has an authenticator app to give
        // one. Not known (no answer, an older vault): the code is asked for.
        const codeless = FACTOR_STEP_UPS.includes(action)
          ? await withToken((a, token) => a.me(token)).then(
              (me) => me.totp_enabled === false,
              () => false,
            )
          : false;
        const request: Request = { action, message: err.message, codeless };
        const confirmed = await coordinator.confirm(request);
        if (!confirmed) return null;
        return withToken(fn);
      }
    },
    [withToken, coordinator],
  );

  const value = useMemo<StepUpValue>(() => ({ guarded }), [guarded]);
  return (
    <Ctx.Provider value={value}>
      {props.children}
      <StepUpSheet asking={open ? asking : null} />
    </Ctx.Provider>
  );
}

export function useStepUp(): StepUpValue {
  const v = useContext(Ctx);
  return v ?? { guarded: async () => null };
}

/** The sheet: the password, or a code from the authenticator app. */
function StepUpSheet(props: { asking: Asking | null }) {
  const { t } = useTranslation();
  const { withToken, caps } = useVault();
  const [chosen, setHow] = useState<'password' | 'code' | 'text'>('password');
  // Where a code can be texted (masked), and where one went.
  const [textTo, setTextTo] = useState<string | null>(null);
  const [textedTo, setTextedTo] = useState<string | null>(null);
  const [texting, setTexting] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { asking } = props;
  // A code alone, for what the vault takes no password for.
  const codeOnly = asking !== null && FACTOR_STEP_UPS.includes(asking.action);
  const how = codeOnly ? 'code' : chosen;
  const texts = caps?.features.sms_codes === true;

  // Asked as the sheet opens: whether a code can be texted instead.
  useEffect(() => {
    if (!asking || codeOnly || !texts) return;
    let gone = false;
    withToken((a, tk) => a.stepUpState(tk)).then(
      (st) => {
        if (!gone) setTextTo(st.text_to ?? null);
      },
      () => undefined,
    );
    return () => {
      gone = true;
    };
  }, [asking, codeOnly, texts, withToken]);

  const reset = () => {
    setValue('');
    setError(null);
    setHow('password');
    setTextTo(null);
    setTextedTo(null);
  };
  const done = (ok: boolean) => {
    reset();
    asking?.settle(ok);
  };
  const sendText = async () => {
    setTexting(true);
    setError(null);
    try {
      const sent = await withToken((a, tk) => a.stepUpTextCode(tk));
      setTextedTo(sent.sent_to);
      setValue('');
      setHow('text');
    } catch (err) {
      const words = wordsFor(err, t, 'stepUp.failed');
      setError(words);
      AccessibilityInfo.announceForAccessibility(words);
    } finally {
      setTexting(false);
    }
  };
  const confirm = async () => {
    // The prompt this answer is for: a later one is never answered by it.
    const answering = asking;
    setBusy(true);
    setError(null);
    try {
      const typed = value.replace(/\s/g, '');
      const body = how === 'password' ? { password: value } : how === 'text' ? { text_code: typed } : { code: typed };
      await withToken((a, token) => a.stepUp(token, body));
      reset();
      answering?.settle(true);
    } catch (err) {
      // The vault's own words when it has them, said aloud too.
      const words = wordsFor(err, t, 'stepUp.failed');
      setError(words);
      AccessibilityInfo.announceForAccessibility(words);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={asking !== null} onClose={() => done(false)} testID="step-up-sheet" keyboard>
      <Text variant="screen">{t('stepUp.title')}</Text>
      {asking?.message ? <Text tone="soft">{asking.message}</Text> : null}
      {codeOnly && asking?.codeless ? (
        <Text testID="step-up-no-code">{t('stepUp.noCode')}</Text>
      ) : codeOnly ? (
        <Text tone="soft" testID="step-up-code-only">
          {t('stepUp.codeOnly')}
        </Text>
      ) : null}
      {how === 'text' && textedTo ? (
        <Text testID="step-up-texted">{t('stepUp.texted', { to: textedTo })}</Text>
      ) : null}
      {codeOnly && asking?.codeless ? null : how === 'password' ? (
        <Field
          testID="step-up-password"
          label={t('stepUp.password')}
          value={value}
          onChangeText={setValue}
          secureTextEntry
          textContentType="password"
          autoComplete="current-password"
          returnKeyType="go"
          onSubmitEditing={() => void confirm()}
          error={error}
        />
      ) : (
        <Field
          testID="step-up-code"
          label={how === 'text' ? t('stepUp.textCode') : t('stepUp.code')}
          value={value}
          onChangeText={setValue}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete={how === 'text' ? 'sms-otp' : 'one-time-code'}
          maxLength={9}
          returnKeyType="go"
          onSubmitEditing={() => void confirm()}
          error={error}
        />
      )}
      {codeOnly && asking?.codeless ? null : (
        <Button
          testID="step-up-go"
          label={t('stepUp.confirm')}
          busy={busy}
          disabled={!value.trim()}
          onPress={() => void confirm()}
        />
      )}
      {codeOnly || how === 'text' ? null : (
        <Button
          testID="step-up-switch"
          kind="quiet"
          label={how === 'password' ? t('stepUp.useCode') : t('stepUp.usePassword')}
          onPress={() => {
            setValue('');
            setError(null);
            setHow(how === 'password' ? 'code' : 'password');
          }}
        />
      )}
      {!codeOnly && textTo ? (
        how === 'text' ? (
          <>
            <Button
              testID="step-up-text-again"
              kind="quiet"
              label={t('stepUp.textAgain')}
              busy={texting}
              onPress={() => void sendText()}
            />
            <Button
              testID="step-up-switch"
              kind="quiet"
              label={t('stepUp.usePassword')}
              onPress={() => {
                setValue('');
                setError(null);
                setHow('password');
              }}
            />
          </>
        ) : (
          <Button
            testID="step-up-text"
            kind="quiet"
            label={t('stepUp.textMe', { to: textTo })}
            busy={texting}
            onPress={() => void sendText()}
          />
        )
      ) : null}
      <Button testID="step-up-cancel" kind="quiet" label={t('stepUp.cancel')} onPress={() => done(false)} />
    </Sheet>
  );
}
