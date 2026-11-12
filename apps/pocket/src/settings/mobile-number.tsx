import type { MemberPhoneView } from '@fdv/shared';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { wordsFor } from '../errors/words';
import { emit } from '../state/events';
import { useStepUp } from '../state/step-up';
import { useVault } from '../state/vault';
import { Button, Card, Field, Notice, Text } from '../ui';
import { ConfirmSheet } from '../ui/confirm';
import { sp } from '../ui/space';

/**
 * Account → Mobile number (SMS4; the vault's SMS1, 0.9.0-dev.29): the
 * person's own number, for texts and codes by text. Added, then confirmed
 * by the code the vault texts to it — nothing else is ever sent to a
 * number before that. Changed means confirmed again (the old number is
 * told, by the vault); removed after asking. A number typed without + is
 * read in the household's country.
 *
 * Shown where the vault has texts (`features.sms_texts`) and they are set
 * up — or where the person already has a number, so it can be removed.
 * Setting texts up is an owner's, on the web.
 */
export function MobileNumber() {
  const { t } = useTranslation();
  const { caps, who, withToken } = useVault();
  const { guarded } = useStepUp();
  const [view, setView] = useState<MemberPhoneView | null>(null);
  const [editing, setEditing] = useState(false);
  const [number, setNumber] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const memberId = who?.member_id ?? null;
  const offered = caps?.features.sms_texts === true;

  const load = useCallback(async () => {
    if (!offered || !memberId) return;
    try {
      setView(await withToken((a, tk) => a.memberPhone(tk, memberId)));
    } catch {
      // No answer: nothing offered here; the screen's other cards say why.
    }
  }, [offered, memberId, withToken]);
  useEffect(() => {
    // Asked on arrival; set when the vault answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const run = async (task: () => Promise<MemberPhoneView | null>, after?: () => void) => {
    setBusy(true);
    setProblem(null);
    setSaid(null);
    try {
      const v = await task();
      if (!v) return;
      setView(v);
      after?.();
      emit('phoneChanged');
    } catch (err) {
      setProblem(wordsFor(err, t));
    } finally {
      setBusy(false);
    }
  };

  if (!offered || !memberId || !view) return null;
  const phone = view.phone;
  if (!phone && !view.sms_ready) return null;

  const send = () =>
    run(
      () => guarded((a, tk) => a.setMemberPhone(tk, memberId, number.trim())),
      () => {
        setEditing(false);
        setCode('');
      },
    );
  const confirm = () =>
    run(
      () => guarded((a, tk) => a.confirmMemberPhone(tk, memberId, code.replace(/\s/g, ''))),
      () => {
        setCode('');
        setSaid(t('mobile.confirmed'));
      },
    );
  const resend = () =>
    run(
      () => guarded((a, tk) => a.resendMemberPhoneCode(tk, memberId)),
      () => setSaid(t('mobile.resent')),
    );
  const remove = () =>
    run(
      () => guarded((a, tk) => a.removeMemberPhone(tk, memberId)),
      () => {
        setRemoving(false);
        setSaid(t('mobile.removed'));
      },
    );

  const entering = editing || !phone;
  return (
    <Card>
      <Text variant="screen">{t('mobile.title')}</Text>
      <Text variant="secondary" tone="soft">
        {t('mobile.why')}
      </Text>
      {said ? (
        <Notice tone="ok" testID="mobile-said">
          {said}
        </Notice>
      ) : null}
      {problem && !removing ? (
        <Notice tone="warn" testID="mobile-problem">
          {problem}
        </Notice>
      ) : null}
      {entering ? (
        <View style={styles.form}>
          <Field
            testID="mobile-number"
            label={phone ? t('mobile.newNumber') : t('mobile.number')}
            value={number}
            onChangeText={setNumber}
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            autoComplete="tel"
            returnKeyType="go"
            onSubmitEditing={() => void send()}
          />
          <Text variant="secondary" tone="soft">
            {t('mobile.numberHint')}
          </Text>
          <Button
            testID="mobile-send"
            label={t('mobile.send')}
            busy={busy}
            disabled={number.replace(/[^0-9]/g, '').length < 6}
            onPress={() => void send()}
          />
          {phone ? (
            <Button testID="mobile-cancel" kind="quiet" label={t('common.cancel')} disabled={busy} onPress={() => setEditing(false)} />
          ) : null}
        </View>
      ) : !phone.confirmed ? (
        <View style={styles.form}>
          <Text testID="mobile-waiting">{t('mobile.codeSent', { to: phone.masked })}</Text>
          <Field
            testID="mobile-code"
            label={t('mobile.code')}
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            // Android offers the texted code as it comes.
            autoComplete="sms-otp"
            maxLength={9}
            returnKeyType="go"
            onSubmitEditing={() => void confirm()}
          />
          <Button
            testID="mobile-confirm"
            label={t('mobile.confirm')}
            busy={busy}
            disabled={code.replace(/\s/g, '').length < 6}
            onPress={() => void confirm()}
          />
          <Button testID="mobile-resend" kind="quiet" label={t('mobile.resend')} disabled={busy} onPress={() => void resend()} />
          <Button
            testID="mobile-other"
            kind="quiet"
            label={t('mobile.other')}
            disabled={busy}
            onPress={() => {
              setNumber('');
              setEditing(true);
            }}
          />
        </View>
      ) : (
        <View style={styles.form}>
          <Text weight="600" testID="mobile-shown">
            {phone.masked}
          </Text>
          <Text variant="secondary" tone="soft">
            {t('mobile.isConfirmed')}
          </Text>
          <Button
            testID="mobile-change"
            kind="quiet"
            label={t('mobile.change')}
            onPress={() => {
              setNumber('');
              setProblem(null);
              setEditing(true);
            }}
          />
          <Button
            testID="mobile-remove"
            kind="quiet"
            label={t('mobile.remove')}
            onPress={() => {
              setProblem(null);
              setRemoving(true);
            }}
          />
        </View>
      )}
      <ConfirmSheet
        visible={removing}
        testID="mobile-remove-sheet"
        title={t('mobile.removeTitle')}
        words={t('mobile.removeWords')}
        confirmLabel={t('mobile.removeYes')}
        busy={busy}
        problem={removing ? problem : null}
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(false)}
        confirmID="mobile-remove-yes"
        cancelID="mobile-remove-cancel"
        problemID="mobile-remove-problem"
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  form: { gap: sp(12) },
});
