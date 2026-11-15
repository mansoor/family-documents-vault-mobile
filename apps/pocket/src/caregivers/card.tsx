import { ApiRequestError } from '@fdv/client';
import {
  caregiverLookWords,
  mayNameOwnCaregiver,
  radii,
  type CaregiverGrantView,
  type CaregiverLook,
  type PersonCaregivers,
} from '@fdv/shared';
import { useRouter } from 'expo-router';
import { HeartHandshake, UserPlus } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { wordsFor } from '../errors/words';
import { emit } from '../state/events';
import { useFamilyZone, relativeWords } from '../state/family-time';
import { useVault } from '../state/vault';
import { Button, Notice, Text } from '../ui';
import { ConfirmSheet } from '../ui/confirm';
import { feel } from '../ui/feel';
import { PickerSheet } from '../ui/picker';
import { sp } from '../ui/space';
import { LoadFailed, loadFailure } from '../ui/states';
import { useColours, useStyles, type Palette } from '../ui/theme';
import { caregiversOn, endLabel, endWords, grantWords } from './rules';

/**
 * Caregivers for one person's medical papers (app 0.12.0; the vault's
 * 0.9.0-dev.43, H1b), as the web's Caregivers card: on More -> Caregivers
 * for the person themselves, and on a person's page for an owner or one of
 * their caregivers.
 *
 *  - The list: each caregiver, and what they see. Keep, for the person, a
 *    caregiver an owner named for them (then their Only me papers are
 *    included); Revoke, for the person or an owner of somebody without a
 *    sign-in; Stop seeing them, for the caregiver. Each asked first.
 *  - Let someone see my medical papers: one of the family the vault
 *    offers, chosen, then said plainly before it is done.
 *  - Who looked, for the person and the owners: who opened which paper and
 *    when (an owner is never told which Only me paper).
 *
 * Nothing at all for anybody the vault refuses, or with nothing to show.
 */
export function CaregiversCard(props: {
  memberId: string;
  /** Their name, for the words; the person themselves are "you". */
  name: string;
  mine: boolean;
  /** The reader is an owner: told who looked at the person's papers, never which. */
  owner: boolean;
}) {
  const styles = useStyles(makeStyles);
  const colours = useColours();
  const { t } = useTranslation();
  const router = useRouter();
  const zone = useFamilyZone();
  const { withToken, offline, caps, who } = useVault();
  // The person's own, only for a role that names their caregivers: never a viewer's or a guest's.
  const offered = caregiversOn(caps) && (!props.mine || mayNameOwnCaregiver(who?.role));
  const readsLooks = props.mine || props.owner;
  const [grants, setGrants] = useState<PersonCaregivers | null>(null);
  const [looks, setLooks] = useState<CaregiverLook[]>([]);
  // Refused (not theirs to see, or no longer, given up): nothing drawn.
  const [hidden, setHidden] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [ending, setEnding] = useState<CaregiverGrantView | null>(null);
  // Keeping one an owner named, asked first: it reaches the Only me papers.
  const [keeping, setKeeping] = useState<CaregiverGrantView | null>(null);
  const [endProblem, setEndProblem] = useState<string | null>(null);
  const { memberId, mine, name } = props;

  const load = useCallback(async () => {
    if (!offered) return;
    try {
      const g = await withToken((a, tk) => a.caregiversOf(tk, memberId));
      const l = readsLooks
        ? await withToken((a, tk) => a.caregiverLooks(tk, memberId)).then(
            (r) => r.items,
            () => [],
          )
        : [];
      setGrants(g);
      setLooks(l);
      setHidden(false);
      setFailed(null);
    } catch (err) {
      if (err instanceof ApiRequestError && (err.status === 403 || err.status === 404)) setHidden(true);
      else setFailed(loadFailure('caregivers', err, t));
    }
  }, [offered, withToken, memberId, readsLooks, t]);
  useEffect(() => {
    // Asked on arrival and when the connection returns; set once the vault answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, offline]);

  if (!offered || hidden) return null;
  if (!grants) return failed ? <LoadFailed words={failed} onRetry={() => void load()} /> : null;
  if (!mine && grants.items.length === 0 && !grants.may_add && looks.length === 0) return null;

  const run = async (fn: Parameters<typeof withToken>[0], after: string): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    setProblem(null);
    setSaid(null);
    try {
      await withToken(fn);
      await load();
      setSaid(after);
      feel('done');
      return true;
    } catch (err) {
      setProblem(wordsFor(err, t));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const candidate = chosen ? (grants.candidates.find((c) => c.member_id === chosen) ?? null) : null;
  const whose = mine ? t('caregivers.your') : t('caregivers.theirs', { name });

  const name1 = async () => {
    if (!candidate) return;
    const ok = await run(
      (a, tk) => a.nameCaregiver(tk, memberId, candidate.member_id),
      mine
        ? t('caregivers.namedMine', { who: candidate.display_name })
        : t('caregivers.namedTheirs', { who: candidate.display_name, name }),
    );
    if (ok) setChosen(null);
  };

  const end = async () => {
    const g = ending;
    if (!g || busy) return;
    setBusy(true);
    setEndProblem(null);
    try {
      await withToken((a, tk) => a.revokeCaregiver(tk, g.person_member_id, g.caregiver_member_id));
    } catch (err) {
      setEndProblem(wordsFor(err, t));
      setBusy(false);
      return;
    }
    setEnding(null);
    setBusy(false);
    feel('done');
    setProblem(null);
    setSaid(endWords(g, mine, name, t).done);
    // What the caregiver sees changed: lists marking their papers look again.
    emit('documentChanged', '');
    await load();
  };

  const asked = ending ? endWords(ending, mine, name, t) : null;

  return (
    <View style={styles.section} testID={`caregivers-${memberId}`}>
      <Text variant="screen" role="header">
        {t('caregivers.title')}
      </Text>
      <Text variant="secondary" tone="soft">
        {mine ? t('caregivers.introMine') : t('caregivers.introTheirs', { name })}
      </Text>
      {offline ? (
        <Notice tone="warn" testID="caregivers-offline">
          {t('caregivers.needsConnection')}
        </Notice>
      ) : null}
      {said ? (
        <Notice tone="ok" testID="caregivers-said">
          {said}
        </Notice>
      ) : null}
      {problem ? (
        <Notice tone="warn" testID="caregivers-problem">
          {problem}
        </Notice>
      ) : null}
      {grants.items.length === 0 ? (
        <Text tone="soft" testID="caregivers-none">
          {t('caregivers.nobody')}
        </Text>
      ) : null}
      {grants.items.map((g) => (
        <View key={g.id} style={styles.card} testID={`caregiver-${g.caregiver_member_id}`}>
          <Text weight="600">{g.caregiver_name}</Text>
          <Text variant="secondary" tone="soft" testID={`caregiver-${g.caregiver_member_id}-words`}>
            {grantWords(g, mine, name, t)}
          </Text>
          <View style={styles.actions}>
            {g.may_keep ? (
              <Button
                size="small"
                label={t('caregivers.keep')}
                accessibilityLabel={t('caregivers.keepWho', { who: g.caregiver_name })}
                disabled={busy || offline}
                // It widens what they see to the Only me papers: asked first.
                onPress={() => {
                  setSaid(null);
                  setProblem(null);
                  setKeeping(g);
                }}
                testID={`caregiver-keep-${g.caregiver_member_id}`}
              />
            ) : null}
            {g.may_revoke || g.may_give_up ? (
              <Button
                size="small"
                kind="quiet"
                // The caregiver themselves (an owner may be one) gives it up; the question says the same.
                label={endLabel(g, t)}
                accessibilityLabel={
                  g.may_give_up
                    ? t('caregivers.giveUpOf', { name: g.person_name })
                    : t('caregivers.revokeWho', { who: g.caregiver_name })
                }
                disabled={busy || offline}
                onPress={() => {
                  setSaid(null);
                  setEndProblem(null);
                  setEnding(g);
                }}
                testID={`caregiver-end-${g.caregiver_member_id}`}
              />
            ) : null}
          </View>
        </View>
      ))}
      {grants.may_add ? (
        grants.candidates.length === 0 ? (
          <Text tone="soft" testID="caregivers-none-eligible">
            {t('caregivers.noneEligible')}
          </Text>
        ) : candidate ? (
          <View style={styles.card} testID="caregivers-new">
            <Text weight="600">{t('caregivers.willSee', { who: candidate.display_name, whose })}</Text>
            <Text variant="secondary" tone="soft">
              {mine ? t('caregivers.willSeeMine') : t('caregivers.willSeeTheirs', { name })}
            </Text>
            <Button
              label={t('caregivers.letThem')}
              busy={busy}
              disabled={offline}
              onPress={() => void name1()}
              testID="caregivers-name"
            />
            <Button
              kind="quiet"
              label={t('common.cancel')}
              disabled={busy}
              onPress={() => setChosen(null)}
              testID="caregivers-name-cancel"
            />
          </View>
        ) : (
          <Pressable
            testID="caregivers-choose"
            accessibilityRole="button"
            accessibilityLabel={mine ? t('caregivers.chooseMine') : t('caregivers.chooseTheirs', { name })}
            accessibilityHint={t('caregivers.chooseHint')}
            accessibilityState={{ disabled: busy || offline }}
            disabled={busy || offline}
            onPress={() => {
              setSaid(null);
              setProblem(null);
              setPicking(true);
            }}
            style={({ pressed }) => [styles.panel, pressed ? styles.pressed : null]}
          >
            <UserPlus color={colours.accent} size={20} accessibilityElementsHidden importantForAccessibility="no" />
            <Text weight="600" style={styles.flex}>
              {mine ? t('caregivers.chooseMine') : t('caregivers.chooseTheirs', { name })}
            </Text>
          </Pressable>
        )
      ) : null}
      {readsLooks ? (
        <View style={styles.looks} testID="caregivers-looks">
          <Text weight="700">{t('caregivers.whoLooked')}</Text>
          {looks.length === 0 ? (
            <Text variant="secondary" tone="soft" testID="caregivers-looks-none">
              {mine ? t('caregivers.nobodyLookedMine') : t('caregivers.nobodyLookedTheirs', { name })}
            </Text>
          ) : (
            looks.map((l, i) => {
              const words = caregiverLookWords(l);
              const when = relativeWords(l.at, zone);
              const id = l.document_id;
              return id ? (
                <Pressable
                  key={`${l.at}-${i}`}
                  testID={`caregivers-look-${i}`}
                  accessibilityRole="link"
                  accessibilityLabel={`${words}. ${when}`}
                  onPress={() => router.push({ pathname: '/document/[id]', params: { id } })}
                  style={({ pressed }) => [styles.look, pressed ? styles.pressed : null]}
                >
                  <Text tone="accent">{words}</Text>
                  <Text variant="small" tone="soft">
                    {when}
                  </Text>
                </Pressable>
              ) : (
                <View key={`${l.at}-${i}`} style={styles.look} testID={`caregivers-look-${i}`}>
                  <Text>{words}</Text>
                  <Text variant="small" tone="soft">
                    {when}
                  </Text>
                </View>
              );
            })
          )}
        </View>
      ) : null}
      <PickerSheet
        visible={picking}
        title={mine ? t('caregivers.chooseMine') : t('caregivers.chooseTheirs', { name })}
        options={grants.candidates.map((c) => ({ value: c.member_id, label: c.display_name }))}
        chosen={chosen ? [chosen] : []}
        onDone={([v]) => {
          setPicking(false);
          setChosen(v ?? null);
        }}
        onClose={() => setPicking(false)}
        testID="caregivers-picker"
        optionID="caregivers-person"
      />
      <ConfirmSheet
        visible={ending !== null}
        testID="caregivers-end-question"
        icon={HeartHandshake}
        title={asked?.title ?? ''}
        words={asked?.words ?? ''}
        confirmLabel={asked?.confirm ?? ''}
        busy={busy}
        problem={endProblem}
        onConfirm={() => void end()}
        onCancel={() => setEnding(null)}
        confirmID="caregivers-end-yes"
        cancelID="caregivers-end-cancel"
        problemID="caregivers-end-problem"
      />
      <ConfirmSheet
        visible={keeping !== null}
        testID="caregivers-keep-question"
        icon={HeartHandshake}
        title={t('caregivers.keepTitle', { who: keeping?.caregiver_name ?? '' })}
        words={t('caregivers.keepWords', { who: keeping?.caregiver_name ?? '' })}
        confirmLabel={t('caregivers.keepYes')}
        busy={busy}
        problem={problem}
        onConfirm={() => {
          const g = keeping;
          if (!g) return;
          void run(
            (a, tk) => a.keepCaregiver(tk, memberId, g.caregiver_member_id),
            t('caregivers.kept', { who: g.caregiver_name }),
          ).then((ok) => {
            if (ok) {
              setKeeping(null);
              emit('documentChanged', '');
            }
          });
        }}
        onCancel={() => setKeeping(null)}
        confirmID="caregivers-keep-yes"
        cancelID="caregivers-keep-cancel"
        problemID="caregivers-keep-problem"
      />
    </View>
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    section: { gap: sp(10) },
    flex: { flex: 1 },
    card: {
      gap: sp(4),
      paddingHorizontal: sp(14),
      paddingVertical: sp(10),
      borderRadius: radii.l,
      borderWidth: 1,
      borderColor: colours.border,
      backgroundColor: colours.surface,
    },
    actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: sp(8), marginTop: sp(4) },
    panel: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: sp(12),
      minHeight: 48,
      paddingHorizontal: sp(14),
      paddingVertical: sp(10),
      borderRadius: radii.l,
      borderWidth: 1,
      borderColor: colours.border,
      backgroundColor: colours.surface,
    },
    looks: { gap: sp(6) },
    look: { gap: 2, minHeight: 44, justifyContent: 'center' },
    pressed: { opacity: 0.8 },
  });
