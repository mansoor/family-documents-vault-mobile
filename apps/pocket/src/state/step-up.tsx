import { ApiRequestError, StepUpCoordinator, type Api } from '@fdv/client';
import { wordsFor } from '../errors/words';
import { colours, radii } from '@fdv/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, KeyboardAvoidingView, Modal, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Field, Text } from '../ui';
import { useLock } from './lock';
import { useVault } from './vault';

/**
 * "Confirm it's you" on the phone (4.12, SEC-17): some things the vault
 * asks for again — a sensitive document's pages, saving a copy. The request
 * is refused with `step_up_required`; one sheet asks for the password or an
 * authenticator code (pasting allowed), with the vault's own words, and
 * the request goes again by itself. However many ask at once, one sheet
 * answers them all (the client's StepUpCoordinator). Cancelling is an
 * answer: nothing is done, and nothing lost.
 */

interface StepUpValue {
  /** `fn` with the session's token; asked to confirm and tried again once, if the vault wants it. Null when not confirmed. */
  guarded<T>(fn: (a: Api, token: string) => Promise<T>): Promise<T | null>;
}

const Ctx = createContext<StepUpValue | null>(null);

/** One prompt: settled once, and it clears only itself. */
interface Asking {
  message: string;
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
        const confirmed = await coordinator.confirm({ action: err.action ?? '', message: err.message });
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
  const { withToken } = useVault();
  const insets = useSafeAreaInsets();
  const [how, setHow] = useState<'password' | 'code'>('password');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { asking } = props;

  const done = (ok: boolean) => {
    setValue('');
    setError(null);
    setHow('password');
    asking?.settle(ok);
  };
  const confirm = async () => {
    // The prompt this answer is for: a later one is never answered by it.
    const answering = asking;
    setBusy(true);
    setError(null);
    try {
      const body = how === 'password' ? { password: value } : { code: value.replace(/\s/g, '') };
      await withToken((a, token) => a.stepUp(token, body));
      setValue('');
      setHow('password');
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
    <Modal visible={asking !== null} transparent animationType="fade" onRequestClose={() => done(false)}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.scrim}>
        <View
          style={[styles.sheet, { paddingBottom: 20 + insets.bottom }]}
          accessibilityViewIsModal
          testID="step-up-sheet"
        >
          <Text variant="screen">{t('stepUp.title')}</Text>
          {asking?.message ? <Text tone="soft">{asking.message}</Text> : null}
          {how === 'password' ? (
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
              label={t('stepUp.code')}
              value={value}
              onChangeText={setValue}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              maxLength={9}
              returnKeyType="go"
              onSubmitEditing={() => void confirm()}
              error={error}
            />
          )}
          <Button
            testID="step-up-go"
            label={t('stepUp.confirm')}
            busy={busy}
            disabled={!value.trim()}
            onPress={() => void confirm()}
          />
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
          <Button testID="step-up-cancel" kind="quiet" label={t('stepUp.cancel')} onPress={() => done(false)} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(28,26,23,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colours.bg,
    padding: 20,
    gap: 12,
    borderTopLeftRadius: radii.l,
    borderTopRightRadius: radii.l,
  },
});
