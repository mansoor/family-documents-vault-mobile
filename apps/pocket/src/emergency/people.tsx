import { ApiRequestError } from '@fdv/client';
import { radii, type EmergencyView, type Member } from '@fdv/shared';
import { useRouter } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useVault } from '../state/vault';
import { Button, Notice, Text } from '../ui';
import { sp } from '../ui/space';
import { LoadFailed, loadFailure, Placeholder } from '../ui/states';
import { useColours, useStyles, type Palette } from '../ui/theme';
import { sections } from './rules';

interface Row {
  member: Member;
  /** What is on their page, in a few words: its parts' names. */
  summary: string;
}

/**
 * Emergency information from More (app 0.15.0): the family whose page the
 * person may read — themselves first — each opening it. The vault is asked
 * for each person's page; one it does not show them is left out, as there
 * is none for them. What the pages say stays in this screen's memory, for
 * the summary, and is never kept.
 */
export function EmergencyPeople() {
  const styles = useStyles(makeStyles);
  const colours = useColours();
  const { t } = useTranslation();
  const router = useRouter();
  const { withToken, offline } = useVault();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  // Some pages could not be read: the rest are listed, and this says so, with Try again.
  const [someFailed, setSomeFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const members = (await withToken((a, tk) => a.members(tk))).items.filter(
        (m) => (m.kind ?? 'family') === 'family' && !m.is_deceased,
      );
      // Each person's page on its own: one that fails leaves the others listed (the review of 0.15.0).
      const pages = await Promise.allSettled(
        members.map((m) => withToken((a, tk) => a.emergencyOf(tk, m.id))),
      );
      const found: Row[] = [];
      let missed = 0;
      members.forEach((m, i) => {
        const r = pages[i];
        if (!r) return;
        if (r.status === 'rejected') {
          // Not shown to them: none for them, said nowhere. Anything else is counted.
          if (!(r.reason instanceof ApiRequestError && r.reason.status === 404)) missed += 1;
          return;
        }
        const v: EmergencyView = r.value;
        const parts = sections(v, t).filter((p) => p.key !== 'date_of_birth');
        found.push({
          member: m,
          summary: parts.length ? parts.map((p) => p.label).join(', ') : t('emergency.empty'),
        });
      });
      // The person themselves first, then the family as the vault lists them.
      found.sort((a, b) => Number(b.member.is_me) - Number(a.member.is_me));
      // Nothing answered at all, and not for want of a connection: said as a failure, as a list's is.
      if (missed > 0 && missed === members.length) {
        const words = loadFailure('emergency', (pages.find((x) => x.status === 'rejected') as PromiseRejectedResult).reason, t);
        if (words) {
          setFailed(words);
          return;
        }
      }
      setRows(found);
      setSomeFailed(missed > 0);
      setFailed(null);
    } catch (err) {
      // Offline: said below. Anything else, with Try again.
      setFailed(loadFailure('emergency', err, t));
    }
  }, [withToken, t]);

  useEffect(() => {
    // Asked on arrival and when the connection returns; set once the vault answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, offline]);

  return (
    <ScrollView
      testID="emergency-people"
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
      <Text variant="secondary" tone="soft">
        {t('emergency.peopleWords')}
      </Text>
      {offline ? (
        <Notice tone="warn" testID="emergency-people-offline">
          {t('emergency.needsConnection')}
        </Notice>
      ) : null}
      {failed ? <LoadFailed words={failed} onRetry={() => void load()} /> : null}
      {!rows && !failed && !offline ? <Placeholder rows={3} /> : null}
      {someFailed ? (
        <Notice tone="warn" testID="emergency-people-some-failed">
          <Text>{t('emergency.someFailed')}</Text>
          <Button kind="quiet" label={t('common.tryAgain')} onPress={() => void load()} testID="emergency-people-retry" />
        </Notice>
      ) : null}
      {rows && rows.length === 0 && !someFailed ? (
        <Text tone="soft" testID="emergency-people-none">
          {t('emergency.nobody')}
        </Text>
      ) : null}
      {rows && rows.length > 0 ? (
        <View style={styles.card}>
          {rows.map((r, i) => {
            const name = r.member.is_me ? t('people.you', { name: r.member.display_name }) : r.member.display_name;
            return (
              <View key={r.member.id}>
                {i > 0 ? <View style={styles.sep} /> : null}
                <Pressable
                  testID={`emergency-person-${r.member.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${name}. ${r.summary}`}
                  onPress={() =>
                    router.push({ pathname: '/emergency/[id]', params: { id: r.member.id, name: r.member.display_name } })
                  }
                  style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
                >
                  <View style={styles.flex}>
                    <Text weight="600">{name}</Text>
                    <Text variant="secondary" tone="soft">
                      {r.summary}
                    </Text>
                  </View>
                  <ChevronRight color={colours.inkMuted} size={20} accessibilityElementsHidden importantForAccessibility="no" />
                </Pressable>
              </View>
            );
          })}
        </View>
      ) : null}
    </ScrollView>
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    page: { padding: sp(20), gap: sp(12) },
    flex: { flex: 1, gap: 2 },
    card: {
      backgroundColor: colours.surface,
      borderRadius: radii.m,
      borderWidth: 1,
      borderColor: colours.border,
      overflow: 'hidden',
    },
    sep: { height: StyleSheet.hairlineWidth, backgroundColor: colours.border },
    row: { flexDirection: 'row', alignItems: 'center', gap: sp(10), minHeight: 52, paddingHorizontal: sp(12), paddingVertical: sp(8) },
    pressed: { opacity: 0.8 },
  });
