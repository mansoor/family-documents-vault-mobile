import { NetworkError } from '@fdv/client';
import { wordsFor } from '../errors/words';
import { addDays, can, localToday, radii, type ReminderView } from '@fdv/shared';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { renewWords } from '../capture/renew-words';
import { offersNewScan, reminderHeadline } from '../documents/reminders';
import { Trash2 } from 'lucide-react-native';
import { useCapture } from '../state/capture';
import { emit, on } from '../state/events';
import { useVault } from '../state/vault';
import { Button, Notice, Text } from '../ui';
import { feel } from '../ui/feel';
import { ConfirmSheet } from '../ui/confirm';
import { Sheet } from '../ui/sheet';
import { sp } from '../ui/space';
import { useColours, useStyles, type Palette } from '../ui/theme';
import { familyZoneNow } from '../state/family-time';
import { LoadFailed, loadFailure, Placeholder } from '../ui/states';

/** Today, as the family's calendar has it (P5): snoozes are whole days. */
function today(): string {
  return localToday(familyZoneNow());
}

type Tab = 'now' | 'coming';

/**
 * Needs attention (4.12), behind the bell (R3), compact (R6): Now and
 * Coming up, one at a time, each a single card of rows. A row says what it
 * is and the date it is about, in its kind's words, where the vault says it
 * ("Due date: 10 Oct, in 7 days"); what is coming up says when it falls due
 * under that. Its actions are on the row: Scan the new one, for a document
 * running out (not a bill, which is paid, not replaced: 5.31), Done, and
 * Later, which asks for how long (a week, a month: REM-07). Put off, a row
 * says what the vault made of it: it stops a due date's snooze at the
 * date. Below, how many documents need details, where the vault counts.
 * The screen's name is the header's; it is not said again here.
 */
export default function AttentionScreen() {
  const styles = useStyles(makeStyles);
  const colours = useColours();
  const { t } = useTranslation();
  const router = useRouter();
  const { withToken, offline, who, caps } = useVault();
  const capture = useCapture();
  const [due, setDue] = useState<ReminderView[] | null>(null);
  const [upcoming, setUpcoming] = useState<ReminderView[]>([]);
  // How many documents need details: only where the vault counts (the Documents table).
  const [details, setDetails] = useState<number | null>(null);
  const [chosen, setChosen] = useState<Tab | null>(null);
  const [later, setLater] = useState<ReminderView | null>(null);
  // One somebody set themselves, removed: asked first.
  const [removing, setRemoving] = useState<ReminderView | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeProblem, setRemoveProblem] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [problem, setProblem] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const canAdd = who ? can(who.role, 'document.add') : false;
  // Viewers see reminders; putting them off or marking them done is not theirs.
  const canManage = who ? can(who.role, 'reminder.manage') : false;
  const counts = caps?.features.document_table === true;

  const load = useCallback(async () => {
    try {
      const [d, u, n] = await withToken((a, token) =>
        Promise.all([
          a.reminders(token, 'due'),
          a.reminders(token, 'upcoming'),
          counts
            ? a
                .documents(token, { sort: 'title', direction: 'asc', limit: 1, status: 'needs_info' })
                .then((r) => r.total ?? null)
                .catch(() => null)
            : Promise.resolve(null),
        ]),
      );
      setDue(d.items);
      setUpcoming(u.items);
      setDetails(n);
      setFailed(null);
    } catch (err) {
      // Offline: the banner says so, and what was last seen stays. Anything else, here (P5).
      setFailed(loadFailure('attention', err, t));
    }
  }, [withToken, t, counts]);

  useEffect(() => {
    // Loaded on arrival, and again when the connection returns or the vault
    // takes a capture; the state is set after the requests answer.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, capture.delivered, offline]);
  // Changed or moved to the Trash on its page (P8).
  useEffect(() => on('documentChanged', () => void load()), [load]);

  const act = async (fn: Parameters<typeof withToken>[0], felt = false) => {
    setProblem(null);
    try {
      const answer = await withToken(fn);
      // Put off: the row moves to what is coming up as the vault answered it
      // (its label says until when), before the lists are read again.
      if (isReminder(answer) && answer.status === 'snoozed') {
        setDue((d) => d?.filter((x) => x.id !== answer.id) ?? d);
        setUpcoming((u) => [answer, ...u.filter((x) => x.id !== answer.id)]);
      }
      if (felt) feel('done');
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
  const snooze = (r: ReminderView, days: number) => {
    setLater(null);
    void act((a, token) => a.snoozeReminder(token, r.id, addDays(today(), days)));
  };
  const done = (r: ReminderView) => act((a, token) => a.acknowledgeReminder(token, r.id), true);
  const removeIt = async () => {
    if (!removing) return;
    setRemoveBusy(true);
    setRemoveProblem(null);
    try {
      await withToken((a, token) => a.deleteReminder(token, removing.id));
      setRemoving(null);
      await load();
      emit('remindersChanged');
    } catch (err) {
      setRemoveProblem(wordsFor(err, t));
    } finally {
      setRemoveBusy(false);
    }
  };
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

  // Now, unless nothing is due and something is coming up; then whichever was chosen.
  const tab: Tab = chosen ?? (due && due.length === 0 && upcoming.length > 0 ? 'coming' : 'now');
  const rows = tab === 'now' ? (due ?? []) : upcoming;
  const nothingAtAll = due !== null && due.length === 0 && upcoming.length === 0;

  const row = (r: ReminderView, isDue: boolean, i: number) => {
    const title = r.document_title ?? t('document.untitled');
    const headline = reminderHeadline(r);
    return (
      <View key={r.id}>
        {i > 0 ? <View style={styles.sep} /> : null}
        <View style={styles.item} testID={`reminder-${r.id}`}>
          {/* Due: a warning's colour, and said in words to a screen reader. */}
          <View
            style={[styles.dot, isDue ? { backgroundColor: colours.warn } : styles.dotLater]}
            {...(isDue ? { accessible: true, accessibilityLabel: t('attention.dueNow') } : { accessible: false })}
          />
          <View style={styles.words}>
            <Pressable
              testID={`open-${r.id}`}
              accessibilityRole="button"
              accessibilityLabel={`${title}. ${headline}`}
              accessibilityHint={t('attention.openHint')}
              onPress={() => router.push({ pathname: '/document/[id]', params: { id: r.document_id } })}
              style={({ pressed }) => [styles.open, pressed ? styles.pressed : null]}
            >
              <Text weight="600">{title}</Text>
              <Text variant="secondary" tone={isDue ? 'warn' : 'soft'} weight="600">
                {headline}
              </Text>
              {/* Coming up: when it falls due, or until when it is put off, under the date it is about. */}
              {!isDue && r.about ? (
                <Text variant="secondary" tone="muted" testID={`when-${r.id}`}>
                  {r.label}
                </Text>
              ) : null}
              {/* One the person set themselves: its note, as they wrote it. */}
              {r.kind === 'manual' && r.note ? (
                <Text variant="secondary" tone="soft" testID={`note-${r.id}`}>
                  {r.note}
                </Text>
              ) : null}
            </Pressable>
            {(isDue && canRenew(r)) || canManage ? (
              <View style={styles.actions}>
                {isDue && canRenew(r) ? (
                  <Button
                    size="small"
                    label={t('attention.scanNew')}
                    onPress={() => void scanNew(r)}
                    testID={`scan-new-${r.document_id}`}
                  />
                ) : null}
                {canManage ? (
                  <Button
                    size="small"
                    kind="quiet"
                    label={t('attention.done')}
                    disabled={offline}
                    onPress={() => void done(r)}
                    testID={`done-${r.id}`}
                  />
                ) : null}
                {canManage && r.kind === 'manual' ? (
                  <Button
                    size="small"
                    kind="quiet"
                    label={t('attention.remove')}
                    accessibilityLabel={t('attention.removeFor', { title })}
                    disabled={offline}
                    onPress={() => {
                      setRemoveProblem(null);
                      setRemoving(r);
                    }}
                    testID={`remove-${r.id}`}
                  />
                ) : null}
                {canManage ? (
                  <Button
                    size="small"
                    kind="quiet"
                    label={t('attention.later')}
                    accessibilityLabel={t('attention.laterFor', { title })}
                    hint={t('attention.snoozeHint')}
                    disabled={offline}
                    onPress={() => setLater(r)}
                    testID={`later-${r.id}`}
                  />
                ) : null}
              </View>
            ) : null}
          </View>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={[]}>
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
        {failed ? <LoadFailed words={failed} onRetry={() => void load()} /> : null}
        {!due && !failed && !offline ? <Placeholder rows={2} /> : null}
        {nothingAtAll ? (
          <Text tone="soft" testID="attention-calm">
            {t('attention.calm')}
          </Text>
        ) : null}
        {due && !nothingAtAll ? (
          <View style={styles.seg} accessibilityRole="tablist">
            {(['now', 'coming'] as const).map((which) => (
              <Pressable
                key={which}
                testID={`attention-tab-${which}`}
                accessibilityRole="tab"
                accessibilityLabel={
                  which === 'now'
                    ? t('attention.now', { count: due.length })
                    : t('attention.coming', { count: upcoming.length })
                }
                accessibilityState={{ selected: tab === which }}
                hitSlop={6}
                onPress={() => setChosen(which)}
                style={[styles.segButton, tab === which ? styles.segOn : null]}
              >
                <Text variant="secondary" weight="600" tone={tab === which ? 'ink' : 'soft'} role="text">
                  {which === 'now'
                    ? t('attention.now', { count: due.length })
                    : t('attention.coming', { count: upcoming.length })}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {due && !nothingAtAll && rows.length === 0 ? (
          <Text tone="soft" testID="attention-empty">
            {t(tab === 'now' ? 'attention.nothingNow' : 'attention.nothingComing')}
          </Text>
        ) : null}
        {rows.length > 0 ? (
          <View style={styles.card} testID={`attention-${tab}`}>
            {rows.map((r, i) => row(r, tab === 'now', i))}
          </View>
        ) : null}
        {details ? (
          <View style={[styles.card, styles.details]} testID="attention-details">
            <Text weight="700">{t('attention.details', { count: details })}</Text>
            <Text variant="secondary" tone="soft">
              {t('attention.detailsWhy')}
            </Text>
            <View style={styles.actions}>
              <Button
                size="small"
                kind="quiet"
                label={t('attention.review')}
                onPress={() => router.push({ pathname: '/documents', params: { status: 'needs_info' } })}
                testID="attention-review"
              />
            </View>
          </View>
        ) : null}
      </ScrollView>
      <ConfirmSheet
        visible={removing !== null}
        testID="remove-question"
        icon={Trash2}
        title={t('attention.removeTitle')}
        words={t('attention.removeWords', { title: removing?.document_title ?? t('document.untitled') })}
        confirmLabel={t('attention.removeYes')}
        busy={removeBusy}
        problem={removeProblem}
        onConfirm={() => void removeIt()}
        onCancel={() => setRemoving(null)}
        confirmID="remove-yes"
        cancelID="remove-cancel"
        problemID="remove-problem"
      />
      <Sheet visible={later !== null} onClose={() => setLater(null)} outside testID="later-sheet">
        {later ? (
          <View style={styles.laterBody}>
            <Text variant="screen">{t('attention.laterTitle')}</Text>
            <Text variant="secondary" tone="soft">
              {later.document_title ?? t('document.untitled')}
            </Text>
            <Button
              kind="quiet"
              label={t('attention.week')}
              onPress={() => snooze(later, 7)}
              testID={`snooze-week-${later.id}`}
            />
            <Button
              kind="quiet"
              label={t('attention.month')}
              onPress={() => snooze(later, 30)}
              testID={`snooze-month-${later.id}`}
            />
            <Button kind="quiet" label={t('common.cancel')} onPress={() => setLater(null)} testID="later-cancel" />
          </View>
        ) : null}
      </Sheet>
    </SafeAreaView>
  );
}

/** A snooze's answer is the reminder as it now is; Done's may be the next one, or nothing. */
function isReminder(x: unknown): x is ReminderView {
  return typeof x === 'object' && x !== null && 'id' in x && 'status' in x && 'label' in x;
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colours.bg },
    page: { padding: sp(20), gap: sp(10) },
    seg: {
      flexDirection: 'row',
      backgroundColor: colours.border,
      borderRadius: radii.s,
      padding: 3,
      gap: 3,
    },
    segButton: { flex: 1, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
    segOn: { backgroundColor: colours.surface },
    card: {
      backgroundColor: colours.surface,
      borderRadius: radii.m,
      borderWidth: 1,
      borderColor: colours.border,
      overflow: 'hidden',
    },
    details: { padding: sp(12), gap: sp(4) },
    item: { flexDirection: 'row', gap: sp(10), paddingVertical: sp(10), paddingLeft: sp(12), paddingRight: sp(8) },
    sep: { height: StyleSheet.hairlineWidth, backgroundColor: colours.border, marginLeft: 30 },
    dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
    dotLater: { backgroundColor: colours.borderStrong },
    words: { flex: 1, gap: sp(6) },
    open: { minHeight: 44, justifyContent: 'center' },
    pressed: { opacity: 0.8 },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: sp(8) },
    laterBody: { gap: sp(10) },
  });
