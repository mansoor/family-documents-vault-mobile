import { NetworkError } from '@fdv/client';
import { wordsFor } from '../../errors/words';
import { addDays, can, colours, localToday, type ReminderView } from '@fdv/shared';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { renewWords } from '../../capture/renew-words';
import { offersNewScan, reminderHeadline } from '../../documents/reminders';
import { useCapture } from '../../state/capture';
import { emit } from '../../state/events';
import { useVault } from '../../state/vault';
import { Button, Card, Notice, Text } from '../../ui';

/** Today, as the phone's calendar has it: snoozes are whole days. */
function today(): string {
  return localToday(Intl.DateTimeFormat().resolvedOptions().timeZone);
}

/**
 * Needs attention (4.12): what is due, and what is coming up. Each can be
 * put off a week or a month, or marked done (REM-07); a document running
 * out can have its new one scanned straight in — not a bill, which is paid,
 * not replaced (5.31). A row says the date it is about, in its kind's
 * words, where the vault says it ("Due date: 10 Oct, in 7 days"); what is
 * coming up says when it falls due under that. Put off, a row says what the
 * vault made of it: it stops a due date's snooze at the date.
 */
export default function AttentionScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { withToken, offline, who } = useVault();
  const capture = useCapture();
  const [due, setDue] = useState<ReminderView[] | null>(null);
  const [upcoming, setUpcoming] = useState<ReminderView[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [problem, setProblem] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  const canAdd = who ? can(who.role, 'document.add') : false;
  // Viewers see reminders; putting them off or marking them done is not theirs.
  const canManage = who ? can(who.role, 'reminder.manage') : false;

  const load = useCallback(async () => {
    try {
      const [d, u] = await withToken((a, token) =>
        Promise.all([a.reminders(token, 'due'), a.reminders(token, 'upcoming')]),
      );
      setDue(d.items);
      setUpcoming(u.items);
    } catch {
      // Offline: the banner says so, and what was last seen stays.
    }
  }, [withToken]);

  useEffect(() => {
    // Loaded on arrival, and again when the connection returns or the vault
    // takes a capture; the state is set after the requests answer.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, capture.delivered, offline]);

  const act = async (fn: Parameters<typeof withToken>[0]) => {
    setProblem(null);
    try {
      const answer = await withToken(fn);
      // Put off: the row moves to what is coming up as the vault answered it
      // (its label says until when), before the lists are read again.
      if (isReminder(answer) && answer.status === 'snoozed') {
        setDue((d) => d?.filter((x) => x.id !== answer.id) ?? d);
        setUpcoming((u) => [answer, ...u.filter((x) => x.id !== answer.id)]);
      }
      await load();
      emit('remindersChanged');
    } catch (err) {
      if (err instanceof NetworkError) setProblem({ tone: 'warn', text: t('attention.needsConnection') });
      else
        setProblem({
          tone: 'warn',
          text: wordsFor(err, t, 'attention.failed'),
        });
    }
  };
  const snooze = (r: ReminderView, days: number) =>
    act((a, token) => a.snoozeReminder(token, r.id, addDays(today(), days)));
  const done = (r: ReminderView) => act((a, token) => a.acknowledgeReminder(token, r.id));
  const scanNew = async (r: ReminderView) => {
    setProblem(null);
    const outcome = await capture.renew(r.document_id);
    if (outcome === 'card') router.push('/capture');
    else setProblem(renewWords(outcome, t));
  };
  // Not while its new version is already waiting to go; not for a teen or a viewer.
  const renewing = new Set(capture.queue.filter((i) => i.kind === 'version').map((i) => i.target));
  const canRenew = (r: ReminderView) =>
    canAdd && who?.role !== 'teen' && !renewing.has(r.document_id) && offersNewScan(r);

  const row = (r: ReminderView, isDue: boolean) => (
    <Card key={r.id} style={isDue ? styles.due : undefined}>
      <Text weight="600">{r.document_title ?? t('document.untitled')}</Text>
      <Text variant="secondary" tone={isDue ? 'warn' : 'soft'} weight="600">
        {reminderHeadline(r)}
      </Text>
      {/* Coming up: when it falls due, or until when it is put off, under the date it is about. */}
      {!isDue && r.about ? (
        <Text variant="secondary" tone="muted" testID={`when-${r.id}`}>
          {r.label}
        </Text>
      ) : null}
      {canManage ? (
        <View style={styles.actions}>
          <Button
            kind="quiet"
            label={t('attention.week')}
            hint={t('attention.snoozeHint')}
            disabled={offline}
            onPress={() => void snooze(r, 7)}
            testID={`snooze-week-${r.id}`}
          />
          <Button
            kind="quiet"
            label={t('attention.month')}
            hint={t('attention.snoozeHint')}
            disabled={offline}
            onPress={() => void snooze(r, 30)}
            testID={`snooze-month-${r.id}`}
          />
          <Button
            kind="quiet"
            label={t('attention.done')}
            disabled={offline}
            onPress={() => void done(r)}
            testID={`done-${r.id}`}
          />
        </View>
      ) : null}
      {isDue && canRenew(r) ? (
        <Button
          kind="quiet"
          label={t('attention.scanNew')}
          onPress={() => void scanNew(r)}
          testID={`scan-new-${r.document_id}`}
        />
      ) : null}
      <Button
        kind="quiet"
        label={t('document.facts')}
        onPress={() => router.push({ pathname: '/document/[id]', params: { id: r.document_id } })}
        testID={`open-${r.id}`}
      />
    </Card>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        testID="attention"
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
        <Text variant="hero">{t('attention.title')}</Text>
        {offline ? (
          <Notice tone="warn" testID="attention-offline">
            {t('home.offline')}
          </Notice>
        ) : null}
        {problem ? (
          <Notice tone={problem.tone} testID="attention-notice">
            {problem.text}
          </Notice>
        ) : null}
        {due && due.length === 0 && upcoming.length === 0 ? (
          <Text tone="soft" testID="attention-calm">
            {t('attention.calm')}
          </Text>
        ) : null}
        {due && due.length > 0 ? <Text variant="screen">{t('attention.due')}</Text> : null}
        {due?.map((r) => row(r, true))}
        {upcoming.length > 0 ? <Text variant="screen">{t('attention.upcoming')}</Text> : null}
        {upcoming.map((r) => row(r, false))}
      </ScrollView>
    </SafeAreaView>
  );
}

/** A snooze's answer is the reminder as it now is; Done's may be the next one, or nothing. */
function isReminder(x: unknown): x is ReminderView {
  return typeof x === 'object' && x !== null && 'id' in x && 'status' in x && 'label' in x;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colours.bg },
  page: { padding: 20, gap: 10 },
  due: { borderColor: colours.warn },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
});
