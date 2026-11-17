import {
  can,
  ENDED_SHARING_DAYS,
  ENDED_SHARING_DEFAULT,
  ENDED_SHARING_KEPT_NOTE,
  endedSharingChoiceWords,
  endedSharingSpan,
  endedSharingWords,
  radii,
  refusalFor,
  type EndedSharing,
  type EndedSharingDays,
} from '@fdv/shared';
import { Trash2 } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { wordsFor } from '../errors/words';
import { useStepUp } from '../state/step-up';
import { useVault } from '../state/vault';
import { Button, Card, Notice, Text } from '../ui';
import { ConfirmSheet } from '../ui/confirm';
import { sp } from '../ui/space';
import { LoadFailed, loadFailure } from '../ui/states';
import { useStyles, type Palette } from '../ui/theme';

/** The choices, in the order the web offers them. */
const CHOICES: readonly (EndedSharingDays | null)[] = [...ENDED_SHARING_DAYS, null];

/** Whether a new choice removes sooner than the old: Never to any, or fewer days. */
export function removesSooner(was: EndedSharingDays | null, to: EndedSharingDays | null): boolean {
  if (to === null) return false;
  return was === null || to < was;
}

/**
 * Settings → Links and requests that no longer work (a vault of
 * 0.9.0-dev.53, RQ; `features.ended_sharing`), as the web's Settings →
 * Privacy has it: how long links outside the family and requests to send
 * documents are kept once they no longer work — 30 days, 90 (the default),
 * a year, or never. An owner chooses, then saves; a choice that removes
 * sooner than before is asked first, saying what goes the next night. An
 * adult, who makes links and requests too, reads it. What stays once one
 * is removed is said beside it. No step-up, as on the web.
 */
export function EndedSharingCard() {
  const styles = useStyles(makeStyles);
  const { t } = useTranslation();
  const { caps, who, withToken, offline } = useVault();
  const { guarded } = useStepUp();
  const offered = caps?.features.ended_sharing === true && !!who && can(who.role, 'document.share');
  const [data, setData] = useState<EndedSharing | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  // What is chosen and not yet saved; undefined, what is saved.
  const [picked, setPicked] = useState<EndedSharingDays | null | undefined>(undefined);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!offered) return;
    try {
      setData(await withToken((a, tk) => a.endedSharing(tk)));
      setFailed(null);
    } catch (err) {
      setFailed(loadFailure('endedSharing', err, t));
    }
  }, [offered, withToken, t]);
  useEffect(() => {
    // Asked on arrival, and when the connection returns; set once the vault answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, offline]);

  if (!offered || (!data && !failed)) return null;
  const saved = data?.remove_after_days ?? null;
  const chosen = picked === undefined ? saved : picked;
  const unsaved = data !== null && chosen !== saved;

  const save = async () => {
    if (busy || !unsaved) return;
    setBusy(true);
    setProblem(null);
    setSaid(null);
    try {
      const next = await guarded((a, tk) => a.setEndedSharing(tk, chosen));
      setAsking(false);
      if (!next) return;
      setData(next);
      setPicked(undefined);
      setSaid(t('endedSharing.saved', { choice: endedSharingChoiceWords(next.remove_after_days) }));
    } catch (err) {
      setAsking(false);
      setProblem(wordsFor(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <View testID="ended-sharing" style={styles.box}>
        <Text variant="title">{t('endedSharing.title')}</Text>
        <Text tone="soft" variant="secondary">
          {t('endedSharing.words')}
        </Text>
        {failed && !data ? <LoadFailed words={failed} onRetry={() => void load()} testID="ended-sharing-failed" /> : null}
        {data?.can_change ? (
          <>
            <View accessibilityRole="radiogroup" accessibilityLabel={t('endedSharing.remove')} style={styles.choices}>
              <Text weight="600">{t('endedSharing.remove')}</Text>
              {CHOICES.map((days) => {
                const label = `${endedSharingChoiceWords(days)}${days === ENDED_SHARING_DEFAULT ? t('endedSharing.theDefault') : ''}`;
                return (
                  <Pressable
                    key={String(days)}
                    testID={`ended-sharing-${days ?? 'never'}`}
                    accessibilityRole="radio"
                    accessibilityLabel={label}
                    accessibilityState={{ checked: chosen === days, disabled: busy }}
                    disabled={busy}
                    onPress={() => {
                      setSaid(null);
                      setPicked(days);
                    }}
                    style={styles.choice}
                  >
                    <View style={[styles.dot, chosen === days ? styles.dotOn : null]} />
                    <Text>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Button
              label={t('endedSharing.save')}
              busy={busy && !asking}
              disabled={busy || !unsaved || offline}
              onPress={() => {
                if (removesSooner(saved, chosen)) setAsking(true);
                else void save();
              }}
              testID="ended-sharing-save"
            />
          </>
        ) : data ? (
          <Text testID="ended-sharing-now">{endedSharingWords(data.remove_after_days)}</Text>
        ) : null}
        {data ? (
          <Text variant="small" tone="soft">
            {ENDED_SHARING_KEPT_NOTE}
          </Text>
        ) : null}
        {data && !data.can_change ? (
          <Text variant="small" tone="soft" testID="ended-sharing-owners">
            {refusalFor('household.ended_sharing')}
          </Text>
        ) : null}
        {problem && !asking ? (
          <Notice tone="warn" testID="ended-sharing-problem">
            {problem}
          </Notice>
        ) : null}
        {said ? (
          <Notice tone="ok" testID="ended-sharing-said">
            {said}
          </Notice>
        ) : null}
      </View>
      <ConfirmSheet
        visible={asking && chosen !== null}
        testID="ended-sharing-question"
        icon={Trash2}
        title={t('endedSharing.soonerTitle')}
        words={`${t('endedSharing.soonerWords', { span: chosen !== null ? endedSharingSpan(chosen) : '' })} ${ENDED_SHARING_KEPT_NOTE}`}
        confirmLabel={t('endedSharing.soonerYes', { span: chosen !== null ? endedSharingSpan(chosen) : '' })}
        busy={busy}
        problem={problem}
        onConfirm={() => void save()}
        onCancel={() => setAsking(false)}
        confirmID="ended-sharing-yes"
        cancelID="ended-sharing-cancel"
        problemID="ended-sharing-question-problem"
      />
    </Card>
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    box: { gap: sp(10) },
    choices: { gap: sp(4) },
    choice: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: sp(12) },
    dot: { width: 20, height: 20, borderRadius: radii.pill, borderWidth: 2, borderColor: colours.borderInput },
    dotOn: { borderWidth: 6, borderColor: colours.accent },
  });
