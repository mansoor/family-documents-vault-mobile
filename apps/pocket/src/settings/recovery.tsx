import type { Api } from '@fdv/client';
import {
  RECOVERY_CODE_COUNT,
  SECURITY_QUESTION_CHOICES,
  SECURITY_QUESTION_COUNT,
  SECURITY_QUESTION_OWN,
  SECURITY_QUESTIONS_WARNING,
  securityAnswerProblem,
  type RecoveryCodesMade,
  type RecoveryCodesState,
  type SecurityQuestionsInput,
  type SecurityQuestionsState,
} from '@fdv/shared';
import type { TFunction } from 'i18next';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Share as SystemShare, StyleSheet, View } from 'react-native';
import { wordsFor } from '../errors/words';
import { copyForAMinute, nativeClipboard } from '../identity/clipboard';
import { dayWords, useFamilyZone } from '../state/family-time';
import { useScreenGuard } from '../state/lock';
import { useStepUp } from '../state/step-up';
import { useVault } from '../state/vault';
import { Button, Card, Field, Notice, Text } from '../ui';
import { ConfirmSheet } from '../ui/confirm';
import { SheetScroll } from '../ui/keyboard';
import { PickerSheet, type PickOption } from '../ui/picker';
import { Sheet } from '../ui/sheet';
import { sp } from '../ui/space';
import { loadFailure, LoadFailed } from '../ui/states';

/**
 * Getting back in when the second step is lost (the vault's 0.9.0-dev.104),
 * as the web's Settings → Your account has it: recovery codes, and security
 * questions if the person wants them. Both are made and set here, in
 * Account; either stands in for the second step at sign-in (sign-in.tsx),
 * never on its own. Each is offered only where the vault says it has them
 * (`features.recovery_codes`, `features.security_questions`).
 */

/** The codes as one piece of text, to copy or to share: what they are, and the ten. */
export function recoveryCodesText(vault: string, codes: readonly string[], t: TFunction): string {
  return [t('recovery.fileTitle', { vault }), '', t('recovery.fileWords'), '', ...codes, ''].join('\n');
}

/**
 * Ten new codes, shown this once: Copy (marked sensitive and cleared in a
 * minute, as an identity number is) and Share or save, then I've kept them.
 * The vault keeps only their hashes, so nothing shows them again. Never in
 * a screenshot, a screen recording or the recent apps view while shown.
 */
export function RecoveryCodesShown(props: { codes: string[]; onDone: () => void; busy?: boolean }) {
  const { t } = useTranslation();
  const { caps, vault } = useVault();
  useScreenGuard('recovery-codes');
  const [said, setSaid] = useState<string | null>(null);
  const clipboard = nativeClipboard();
  const name = caps?.branding.display_name ?? vault?.displayName ?? t('recovery.vaultName');
  const text = recoveryCodesText(name, props.codes, t);
  return (
    <Card>
      <View style={styles.form} testID="recovery-codes">
        <Text variant="screen">{t('recovery.shownTitle')}</Text>
        <Text>{t('recovery.shownWords')}</Text>
        <Text weight="700">{t('recovery.shownOnce')}</Text>
        <View style={styles.codes} accessibilityRole="list">
          {props.codes.map((c, i) => (
            <Text key={c} testID={`recovery-code-${i}`} style={styles.code}>
              {`${i + 1}. ${c}`}
            </Text>
          ))}
        </View>
        {clipboard ? (
          <Button
            testID="recovery-codes-copy"
            kind="quiet"
            label={t('recovery.copy')}
            onPress={() => setSaid(copyForAMinute(clipboard, text) ? t('recovery.copied') : t('recovery.notCopied'))}
          />
        ) : null}
        <Button
          testID="recovery-codes-share"
          kind="quiet"
          label={t('recovery.share')}
          onPress={() => void SystemShare.share({ message: text }).catch(() => undefined)}
        />
        {said ? (
          <Text variant="secondary" tone="soft" testID="recovery-codes-said">
            {said}
          </Text>
        ) : null}
        <Button testID="recovery-codes-kept" label={t('recovery.kept')} busy={props.busy === true} onPress={props.onDone} />
      </View>
    </Card>
  );
}

/**
 * A second step just set up (0.9.0-dev.104): with no recovery codes yet,
 * ten are made beside it, to be shown once; null when none were made.
 */
export async function makeCodesIfNone(
  withToken: <T>(fn: (a: Api, token: string) => Promise<T>) => Promise<T>,
  guarded: <T>(fn: (a: Api, token: string) => Promise<T>) => Promise<T | null>,
): Promise<RecoveryCodesMade | null> {
  const now = await withToken((a, tk) => a.recoveryCodes(tk));
  if (!now.second_step || now.made_at !== null) return null;
  return guarded((a, tk) => a.makeRecoveryCodes(tk));
}

/**
 * Account → Recovery codes: how many are left, a warning when two or fewer
 * are, and new ones made on request (after confirming it's you), which
 * replace the old — asked first. Read again whenever `refresh` changes
 * (codes made as a second step was just set up, shown in their own sheet).
 */
export function RecoveryCodesCard(props: { refresh?: unknown } = {}) {
  const { t } = useTranslation();
  const { caps, withToken } = useVault();
  const { guarded } = useStepUp();
  const zone = useFamilyZone();
  const offered = caps?.features.recovery_codes === true;
  const [data, setData] = useState<RecoveryCodesState | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [shown, setShown] = useState<RecoveryCodesMade | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!offered) return;
    setFailed(null);
    try {
      setData(await withToken((a, tk) => a.recoveryCodes(tk)));
    } catch (err) {
      setFailed(loadFailure('recovery_codes', err, t));
    }
  }, [offered, withToken, t]);
  const { refresh } = props;
  useEffect(() => {
    // Asked on arrival, and again as codes are made beside a new second step.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, refresh]);

  const make = async () => {
    setAsking(false);
    setBusy(true);
    setProblem(null);
    try {
      const made = await guarded((a, tk) => a.makeRecoveryCodes(tk));
      if (made) {
        setShown(made);
        setData(made);
      }
    } catch (err) {
      setProblem(wordsFor(err, t));
    } finally {
      setBusy(false);
    }
  };

  if (!offered) return null;
  if (shown) {
    return (
      <RecoveryCodesShown
        codes={shown.codes}
        onDone={() => {
          setShown(null);
          void load();
        }}
      />
    );
  }
  return (
    <Card>
      <Text variant="screen">{t('recovery.title')}</Text>
      <Text variant="secondary" tone="soft">
        {t('recovery.words', { count: RECOVERY_CODE_COUNT })}
      </Text>
      {data === null && failed ? <LoadFailed words={failed} onRetry={() => void load()} testID="recovery-codes-failed" /> : null}
      {data && !data.second_step && data.made_at === null ? (
        <Text variant="secondary" tone="soft" testID="recovery-codes-first">
          {t('recovery.secondStepFirst')}
        </Text>
      ) : null}
      {data && data.made_at !== null ? (
        data.low ? (
          <Notice tone="warn" testID="recovery-codes-left">
            {data.remaining === 0
              ? t('recovery.noneLeft')
              : `${t('recovery.left', { count: data.remaining, of: RECOVERY_CODE_COUNT, day: dayWords(data.made_at, zone) })} ${t('recovery.makeSoon')}`}
          </Notice>
        ) : (
          <Text variant="secondary" tone="soft" testID="recovery-codes-left">
            {t('recovery.left', { count: data.remaining, of: RECOVERY_CODE_COUNT, day: dayWords(data.made_at, zone) })}
          </Text>
        )
      ) : null}
      {data && data.second_step && data.made_at === null ? (
        <Notice tone="warn" testID="recovery-codes-none">
          {t('recovery.none')}
        </Notice>
      ) : null}
      {problem ? (
        <Notice tone="warn" testID="recovery-codes-problem">
          {problem}
        </Notice>
      ) : null}
      {data?.second_step ? (
        <Button
          testID="recovery-codes-make"
          kind={data.made_at === null || data.low ? 'primary' : 'quiet'}
          busy={busy}
          label={data.made_at === null ? t('recovery.make') : t('recovery.makeNew')}
          onPress={() => (data.made_at === null ? void make() : setAsking(true))}
        />
      ) : null}
      <ConfirmSheet
        visible={asking}
        testID="recovery-codes-question"
        title={t('recovery.makeNewTitle')}
        words={t('recovery.makeNewWords')}
        confirmLabel={t('recovery.makeNew')}
        onConfirm={() => void make()}
        onCancel={() => setAsking(false)}
        confirmID="recovery-codes-make-yes"
        cancelID="recovery-codes-make-no"
      />
    </Card>
  );
}

/**
 * Codes made as a second step was just set up (Account), over the page in
 * a sheet, so they are never missed far down it: shown once, only I've kept
 * them closes it — Back does nothing here, as the codes would be gone.
 */
export function RecoveryCodesSheet(props: { made: RecoveryCodesMade | null; onKept: () => void }) {
  return (
    <Sheet visible={props.made !== null} onClose={() => undefined} testID="recovery-codes-sheet" tall>
      <SheetScroll>
        {props.made ? <RecoveryCodesShown codes={props.made.codes} onDone={props.onKept} /> : null}
      </SheetScroll>
    </Sheet>
  );
}

/** Three blank answers, as a form opens. */
const blanks = () => Array.from({ length: SECURITY_QUESTION_COUNT }, () => '');

/**
 * Account → Security questions: three, chosen and answered, which may stand
 * in for a lost second step — with the password, never on their own — and
 * whose answers are never shown again. The card says plainly that relatives
 * may know such answers. Set, changed or removed after confirming it's you;
 * removing is asked first. Turned off for the household by an owner, they
 * are kept and never asked, and new ones can't be set.
 */
export function SecurityQuestionsCard() {
  const { t } = useTranslation();
  const { caps, withToken } = useVault();
  const { guarded } = useStepUp();
  const zone = useFamilyZone();
  const offered = caps?.features.security_questions === true;
  const [data, setData] = useState<SecurityQuestionsState | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [keys, setKeys] = useState<string[]>(() =>
    SECURITY_QUESTION_CHOICES.slice(0, SECURITY_QUESTION_COUNT).map((c) => c.key),
  );
  const [own, setOwn] = useState('');
  const [answers, setAnswers] = useState<string[]>(blanks);
  const [picking, setPicking] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  // Answers being typed are never in a screenshot or the recent apps view.
  useScreenGuard('security-answers', editing);

  const load = useCallback(async () => {
    if (!offered) return;
    setFailed(null);
    try {
      setData(await withToken((a, tk) => a.securityQuestions(tk)));
    } catch (err) {
      setFailed(loadFailure('security_questions', err, t));
    }
  }, [offered, withToken, t]);
  useEffect(() => {
    // Asked on arrival; set when the vault answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (!offered) return null;

  const options: PickOption[] = [
    ...SECURITY_QUESTION_CHOICES.map((c) => ({ value: c.key, label: c.text })),
    { value: SECURITY_QUESTION_OWN, label: t('questions.ownChoice') },
  ];
  const labelOf = (key: string) => options.find((o) => o.value === key)?.label ?? key;

  const close = () => {
    setEditing(false);
    setProblem(null);
    setAnswers(blanks());
  };

  const save = async () => {
    if (busy) return;
    setProblem(null);
    const local =
      new Set(keys).size !== keys.length
        ? t('questions.different')
        : keys.includes(SECURITY_QUESTION_OWN) && own.trim() === ''
          ? t('questions.ownEmpty')
          : answers.map(securityAnswerProblem).find((p) => p !== null);
    if (local) {
      setProblem(local);
      return;
    }
    setBusy(true);
    try {
      const body: SecurityQuestionsInput = {
        questions: keys.map((key, i) => ({
          key,
          ...(key === SECURITY_QUESTION_OWN ? { text: own.trim() } : {}),
          answer: answers[i] ?? '',
        })),
      };
      const next = await guarded((a, tk) => a.setSecurityQuestions(tk, body));
      if (next) {
        setData(next);
        close();
      }
    } catch (err) {
      setProblem(wordsFor(err, t));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const next = await guarded((a, tk) => a.removeSecurityQuestions(tk));
      setRemoving(false);
      if (next) setData(next);
    } catch (err) {
      setRemoving(false);
      setProblem(wordsFor(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Text variant="screen">{t('questions.title')}</Text>
      <Text variant="secondary" tone="soft">
        {t('questions.words')}
      </Text>
      <Notice tone="warn" testID="questions-warning">
        {SECURITY_QUESTIONS_WARNING}
      </Notice>
      {data === null && failed ? <LoadFailed words={failed} onRetry={() => void load()} testID="questions-failed" /> : null}
      {data && !data.offered ? (
        <Text variant="secondary" tone="soft" testID="questions-off">
          {t('questions.off')}
        </Text>
      ) : null}
      {data?.set && !editing ? (
        <View style={styles.form} testID="questions-set">
          {data.questions.map((q, i) => (
            <Text key={q.key} testID={`questions-set-${i}`}>{`${i + 1}. ${q.text}`}</Text>
          ))}
          <Text variant="secondary" tone="soft" testID="questions-set-at">
            {data.set_at ? t('questions.setAt', { day: dayWords(data.set_at, zone) }) : t('questions.neverShown')}
          </Text>
          {data.refused_until ? (
            <Notice tone="warn" testID="questions-refused">
              {t('questions.refused', { day: dayWords(data.refused_until, zone) })}
            </Notice>
          ) : null}
        </View>
      ) : null}
      {editing ? (
        <View style={styles.form} testID="questions-form">
          {keys.map((key, i) => (
            <View key={i} style={styles.form}>
              <Text variant="secondary" weight="600" tone="soft">
                {t('questions.question', { n: i + 1 })}
              </Text>
              <Button
                testID={`questions-pick-${i}`}
                kind="quiet"
                label={labelOf(key)}
                hint={t('questions.pickHint')}
                onPress={() => setPicking(i)}
              />
              {key === SECURITY_QUESTION_OWN ? (
                <Field
                  testID={`questions-own-${i}`}
                  label={t('questions.own')}
                  value={own}
                  onChangeText={setOwn}
                  autoCapitalize="sentences"
                />
              ) : null}
              <Field
                testID={`questions-answer-${i}`}
                label={t('questions.answer', { n: i + 1 })}
                value={answers[i] ?? ''}
                autoComplete="off"
                importantForAutofill="no"
                onChangeText={(v) => setAnswers(answers.map((a, j) => (j === i ? v : a)))}
              />
              <Text variant="small" tone="soft">
                {t('questions.answerHint')}
              </Text>
            </View>
          ))}
          {problem ? (
            <Notice tone="warn" testID="questions-problem">
              {problem}
            </Notice>
          ) : null}
          <Button testID="questions-save" label={t('questions.save')} busy={busy} onPress={() => void save()} />
          <Button testID="questions-cancel" kind="quiet" label={t('common.cancel')} disabled={busy} onPress={close} />
        </View>
      ) : data?.offered ? (
        <>
          {problem ? (
            <Notice tone="warn" testID="questions-problem">
              {problem}
            </Notice>
          ) : null}
          <Button
            testID="questions-edit"
            kind="quiet"
            label={data.set ? t('questions.change') : t('questions.set')}
            onPress={() => {
              setProblem(null);
              setAnswers(blanks());
              setEditing(true);
            }}
          />
          {data.set ? (
            <Button
              testID="questions-remove"
              kind="quiet"
              label={t('questions.remove')}
              onPress={() => {
                setProblem(null);
                setRemoving(true);
              }}
            />
          ) : null}
        </>
      ) : null}
      <PickerSheet
        visible={picking !== null}
        title={t('questions.question', { n: (picking ?? 0) + 1 })}
        options={options}
        chosen={picking !== null ? [keys[picking] ?? ''] : []}
        onDone={([k]) => {
          const at = picking;
          setPicking(null);
          if (k && at !== null) setKeys(keys.map((x, j) => (j === at ? k : x)));
        }}
        onClose={() => setPicking(null)}
        testID="questions-picker"
        optionID="questions-picker-option"
      />
      <ConfirmSheet
        visible={removing}
        testID="questions-remove-question"
        title={t('questions.removeTitle')}
        words={t('questions.removeWords')}
        confirmLabel={t('questions.remove')}
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(false)}
        confirmID="questions-remove-yes"
        cancelID="questions-remove-no"
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  form: { gap: sp(12) },
  codes: { gap: sp(4) },
  // Each letter its own width, so the codes line up and read one by one.
  code: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), letterSpacing: 1 },
});
