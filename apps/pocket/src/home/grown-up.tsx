import { type GrownUpAnswerChoice, type GrownUpQuestionView } from '@fdv/shared';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { HeartPulse, Lock } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { caregiversOn } from '../caregivers/rules';
import { wordsFor } from '../errors/words';
import { emit } from '../state/events';
import { useEssentials } from '../state/essentials';
import { useVault } from '../state/vault';
import { Notice, Text } from '../ui';
import { ConfirmSheet } from '../ui/confirm';
import { feel } from '../ui/feel';
import { useColours, useStyles } from '../ui/theme';
import { cardStyles } from './alert-cards';

/**
 * Turning 18 on Home (app 0.12.0; the vault's 0.9.0-dev.43, H1b), as the
 * web's GrownUpQuestions, drawn as Home's alert cards are:
 *
 *  - The person's own question, asked once: keep their medical papers
 *    visible to the family, or make them Only me — asked first, saying
 *    plainly what changes. Nothing changes until they answer.
 *  - An owner's card for somebody with no sign-in: ask them in person;
 *    an owner may record only Keep, or name a caregiver on their page.
 *  - An owner's card for somebody 18 or over who still signs in as a teen:
 *    their role is changed to adult first (in the browser), then they are
 *    asked themselves.
 *
 * Not hidden with a ✕, as the other alerts are: the question waits for its
 * answer. Nothing on an older vault, or when the vault does not say.
 */
export function GrownUpCards(props: { again: number }) {
  const styles = useStyles(cardStyles);
  const colours = useColours();
  const { t } = useTranslation();
  const router = useRouter();
  const { caps, vault, offline, withTokenQuick, withToken } = useVault();
  const essentials = useEssentials();
  const offered = caregiversOn(caps);
  const [items, setItems] = useState<GrownUpQuestionView[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [asking, setAsking] = useState<GrownUpQuestionView | null>(null);

  const load = useCallback(async () => {
    if (!offered) return;
    try {
      setItems((await withTokenQuick((a, tk) => a.grownUpQuestions(tk))).items);
    } catch {
      // Home is never lost to it: refused or failed, there are none to ask now.
    }
  }, [offered, withTokenQuick]);
  useEffect(() => {
    if (offline) return;
    // Asked with Home, and again when it is; set once the vault answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, offline, props.again]);

  if (!offered || (items.length === 0 && !said && !problem)) return null;

  const answer = async (q: GrownUpQuestionView, choice: GrownUpAnswerChoice) => {
    if (busy) return;
    setBusy(q.member_id);
    setProblem(null);
    setSaid(null);
    try {
      const r = await withToken((a, tk) => a.answerGrownUp(tk, q.member_id, choice));
      setAsking(null);
      feel('done');
      setSaid(
        choice === 'only_me'
          ? t('grownUp.madeOnlyMe', { count: r.made_private })
          : q.asks === 'self'
            ? t('grownUp.keptMine')
            : t('grownUp.keptTheirs', { name: q.display_name }),
      );
      // Lists showing their papers look again: who can see them changed.
      if (choice === 'only_me') {
        emit('documentChanged', '');
        // The copies this phone keeps follow: Only me ones go to the locked store, or off the phone.
        void essentials.sync();
      }
      await load();
    } catch (err) {
      setProblem(wordsFor(err, t));
      // Answered somewhere else, say: the questions as the vault has them now.
      await load();
    } finally {
      setBusy(null);
    }
  };

  const actionsOf = (q: GrownUpQuestionView): { label: string; onPress: () => void; testID: string; hint?: string }[] => {
    if (q.asks === 'self') {
      return [
        { label: t('grownUp.keep'), onPress: () => void answer(q, 'keep'), testID: `grown-up-keep-${q.member_id}` },
        {
          label: t('grownUp.onlyMe'),
          onPress: () => {
            setProblem(null);
            setAsking(q);
          },
          testID: `grown-up-only-me-${q.member_id}`,
        },
      ];
    }
    if (q.asks === 'in_person') {
      return [
        {
          label: t('grownUp.keepTheirs'),
          hint: t('grownUp.keepTheirsHint', { name: q.display_name }),
          onPress: () => void answer(q, 'keep'),
          testID: `grown-up-keep-${q.member_id}`,
        },
        {
          label: t('grownUp.nameCaregiver'),
          onPress: () => router.push({ pathname: '/person/[id]', params: { id: q.member_id, name: q.display_name } }),
          testID: `grown-up-caregiver-${q.member_id}`,
        },
      ];
    }
    // Their role is changed on the web, where an owner changes roles.
    return vault
      ? [
          {
            label: t('grownUp.changeRole'),
            hint: t('grownUp.changeRoleHint'),
            onPress: () => void Linking.openURL(`${vault.origin}/people/${encodeURIComponent(q.member_id)}`),
            testID: `grown-up-role-${q.member_id}`,
          },
        ]
      : [];
  };

  return (
    <View style={styles.list} testID="home-grown-up">
      {items.map((q) => {
        const Icon = q.asks === 'self' ? Lock : HeartPulse;
        const actions = actionsOf(q);
        return (
          <View key={q.member_id} style={styles.card} testID={`grown-up-${q.member_id}`}>
            <Icon color={colours.warn} size={18} accessibilityElementsHidden importantForAccessibility="no" />
            <View style={styles.flex}>
              <Text weight="600" role="header">
                {q.title}
              </Text>
              <Text variant="secondary" tone="soft">
                {q.label}
              </Text>
              <View style={styles.actions}>
                {actions.map((x) => (
                  <Pressable
                    key={x.testID}
                    testID={x.testID}
                    accessibilityRole={x.testID.startsWith('grown-up-role') ? 'link' : 'button'}
                    accessibilityLabel={x.label}
                    {...(x.hint ? { accessibilityHint: x.hint } : {})}
                    accessibilityState={{ disabled: busy !== null || offline, busy: busy === q.member_id }}
                    disabled={busy !== null || offline}
                    hitSlop={8}
                    onPress={x.onPress}
                    style={({ pressed }) => [
                      styles.action,
                      busy !== null || offline ? styles.disabled : null,
                      pressed ? styles.pressed : null,
                    ]}
                  >
                    <Text variant="secondary" weight="700" tone="accent">
                      {x.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              {/* An owner's answer for somebody else is final: said where it is seen, not only heard. */}
              {q.asks === 'in_person' ? (
                <Text variant="small" tone="soft" testID={`grown-up-final-${q.member_id}`}>
                  {t('grownUp.keepTheirsFinal', { name: q.display_name })}
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}
      {said ? (
        <Notice tone="ok" testID="grown-up-said">
          {said}
        </Notice>
      ) : null}
      {problem && !asking ? (
        <Notice tone="warn" testID="grown-up-problem">
          {problem}
        </Notice>
      ) : null}
      <ConfirmSheet
        visible={asking !== null}
        testID="grown-up-only-me-question"
        icon={Lock}
        title={t('grownUp.onlyMeTitle')}
        words={t('grownUp.onlyMeWords', { count: asking?.papers ?? 0 })}
        confirmLabel={t('grownUp.onlyMeYes')}
        busy={busy !== null}
        problem={asking ? problem : null}
        onConfirm={() => asking && void answer(asking, 'only_me')}
        onCancel={() => {
          setAsking(null);
          setProblem(null);
        }}
        confirmID="grown-up-only-me-yes"
        cancelID="grown-up-only-me-cancel"
        problemID="grown-up-only-me-problem"
      />
    </View>
  );
}
