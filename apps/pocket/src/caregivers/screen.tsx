import { mayNameOwnCaregiver, radii, type CaregiverGrantView, type Member, type MyCaregivers } from '@fdv/shared';
import { useRouter } from 'expo-router';
import { ChevronRight, HeartHandshake } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { wordsFor } from '../errors/words';
import { emit } from '../state/events';
import { useVault } from '../state/vault';
import { Button, Notice, Text } from '../ui';
import { ConfirmSheet } from '../ui/confirm';
import { feel } from '../ui/feel';
import { sp } from '../ui/space';
import { LoadFailed, loadFailure, Placeholder } from '../ui/states';
import { useColours, useStyles, type Palette } from '../ui/theme';
import { CaregiversCard } from './card';
import { caregiversOn, endLabel, endWords } from './rules';

/**
 * More -> Caregivers (app 0.12.0; the vault's 0.9.0-dev.43, H1b), as the
 * web's Settings -> Caregivers: who can see the person's own medical papers
 * (their card), and whose papers they can see as a caregiver, each given up
 * when they like, asked first. An owner also finds each other person of the
 * family here — to name a caregiver for somebody without a sign-in, and to
 * see who looked at anybody's papers — on that person's page.
 */
export function CaregiversScreen() {
  const styles = useStyles(makeStyles);
  const colours = useColours();
  const { t } = useTranslation();
  const router = useRouter();
  const { withToken, offline, who, caps } = useVault();
  // Opened by a link on a vault without caregivers: said plainly, and nothing asked of it.
  const on = caregiversOn(caps);
  const [data, setData] = useState<{ me: Member | null; others: Member[]; mine: MyCaregivers } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [ending, setEnding] = useState<CaregiverGrantView | null>(null);
  const [endProblem, setEndProblem] = useState<string | null>(null);
  const owner = who?.role === 'owner';

  const load = useCallback(async () => {
    if (!on) return;
    try {
      const [members, mine] = await withToken((a, tk) => Promise.all([a.members(tk), a.myCaregivers(tk)]));
      setData({
        me: members.items.find((m) => m.is_me) ?? null,
        // The rest of the family, for an owner: not guests, and not those who have died.
        others: members.items.filter((m) => !m.is_me && (m.kind ?? 'family') === 'family' && !m.is_deceased),
        mine,
      });
      setFailed(null);
    } catch (err) {
      setFailed(loadFailure('caregivers', err, t));
    }
  }, [withToken, t, on]);
  useEffect(() => {
    // Loaded on arrival and when the connection returns; set once the vault answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, offline]);

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
    setSaid(endWords(g, false, g.person_name, t).done);
    // Their papers are no longer the person's to see: lists marking them look again.
    emit('documentChanged', '');
    await load();
  };
  const asked = ending ? endWords(ending, false, ending.person_name, t) : null;

  return (
    <ScrollView
      testID="caregivers"
      style={styles.screen}
      contentContainerStyle={styles.page}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load().finally(() => setRefreshing(false));
          }}
        />
      }
    >
      <Text variant="hero">{t('caregivers.title')}</Text>
      <Text variant="secondary" tone="soft">
        {t('caregivers.subtitle')}
      </Text>
      {!on ? (
        <Notice tone="info" testID="caregivers-not-here">
          {t('caregivers.notOnVault')}
        </Notice>
      ) : null}
      {failed ? <LoadFailed words={failed} onRetry={() => void load()} /> : null}
      {offline && !data ? (
        <Notice tone="warn" testID="caregivers-screen-offline">
          {t('caregivers.needsConnection')}
        </Notice>
      ) : null}
      {on && !data && !failed && !offline ? <Placeholder rows={3} /> : null}
      {data?.me && mayNameOwnCaregiver(who?.role) ? (
        <CaregiversCard memberId={data.me.id} name={data.me.display_name} mine owner={owner} />
      ) : null}
      {data && data.mine.for_others.length > 0 ? (
        <View style={styles.section} testID="caregivers-for-others">
          <Text variant="screen" role="header">
            {t('caregivers.forOthers')}
          </Text>
          {said ? (
            <Notice tone="ok" testID="caregivers-for-others-said">
              {said}
            </Notice>
          ) : null}
          {data.mine.for_others.map((g) => (
            <View key={g.id} style={styles.card} testID={`caring-for-${g.person_member_id}`}>
              <Text weight="600">{g.person_name}</Text>
              <Text variant="secondary" tone="soft">
                {g.confirmed ? t('caregivers.forOthersKept') : t('caregivers.forOthersNamed', { name: g.person_name })}
              </Text>
              <View style={styles.actions}>
                <Button
                  size="small"
                  kind="quiet"
                  label={t('caregivers.seeTheirs')}
                  accessibilityLabel={t('caregivers.seeTheirsOf', { name: g.person_name })}
                  onPress={() =>
                    router.push({ pathname: '/person/[id]', params: { id: g.person_member_id, name: g.person_name } })
                  }
                  testID={`caring-for-open-${g.person_member_id}`}
                />
                <Button
                  size="small"
                  kind="quiet"
                  label={endLabel(g, t)}
                  accessibilityLabel={t('caregivers.giveUpOf', { name: g.person_name })}
                  disabled={busy || offline}
                  onPress={() => {
                    setSaid(null);
                    setEndProblem(null);
                    setEnding(g);
                  }}
                  testID={`caring-for-end-${g.person_member_id}`}
                />
              </View>
            </View>
          ))}
        </View>
      ) : !said ? null : (
        <Notice tone="ok" testID="caregivers-for-others-said">
          {said}
        </Notice>
      )}
      {owner && data && data.others.length > 0 ? (
        <View style={styles.section} testID="caregivers-family">
          <Text variant="screen" role="header">
            {t('caregivers.family')}
          </Text>
          <Text variant="secondary" tone="soft">
            {t('caregivers.familyWords')}
          </Text>
          <View style={styles.group}>
            {data.others.map((m) => (
              <Pressable
                key={m.id}
                testID={`caregivers-family-${m.id}`}
                accessibilityRole="button"
                accessibilityLabel={m.display_name}
                accessibilityHint={m.role === null ? t('caregivers.noSignInHint') : t('caregivers.signInHint')}
                onPress={() => router.push({ pathname: '/person/[id]', params: { id: m.id, name: m.display_name } })}
                style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
              >
                <HeartHandshake color={colours.accent} size={20} accessibilityElementsHidden importantForAccessibility="no" />
                <View style={styles.flex}>
                  <Text weight="600">{m.display_name}</Text>
                  <Text variant="secondary" tone="soft">
                    {m.role === null ? t('caregivers.noSignInHint') : t('caregivers.signInHint')}
                  </Text>
                </View>
                <ChevronRight color={colours.inkMuted} size={20} accessibilityElementsHidden importantForAccessibility="no" />
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
      <ConfirmSheet
        visible={ending !== null}
        testID="caring-for-end-question"
        icon={HeartHandshake}
        title={asked?.title ?? ''}
        words={asked?.words ?? ''}
        confirmLabel={asked?.confirm ?? ''}
        busy={busy}
        problem={endProblem}
        onConfirm={() => void end()}
        onCancel={() => setEnding(null)}
        confirmID="caring-for-end-yes"
        cancelID="caring-for-end-cancel"
        problemID="caring-for-end-problem"
      />
    </ScrollView>
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    screen: { backgroundColor: colours.bg },
    page: { padding: sp(20), gap: sp(16) },
    section: { gap: sp(10) },
    flex: { flex: 1, gap: 2 },
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
    group: {
      backgroundColor: colours.surface,
      borderRadius: radii.l,
      borderWidth: 1,
      borderColor: colours.border,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: sp(12),
      paddingHorizontal: sp(14),
      paddingVertical: sp(12),
      minHeight: 52,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colours.border,
    },
    pressed: { opacity: 0.8 },
  });
