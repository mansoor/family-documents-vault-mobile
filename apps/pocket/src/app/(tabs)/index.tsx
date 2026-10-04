import { ApiRequestError, isSessionOver } from '@fdv/client';
import {
  can,
  colours,
  formatDate,
  radii,
  shareEndWords,
  type DocumentView,
  type IdentityAudienceView,
  type Member,
  type ReminderView,
  type ResetNotice,
} from '@fdv/shared';
import { Image } from 'expo-image';
import { Link, useRouter } from 'expo-router';
import { Settings as SettingsIcon } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { QueueRow, withoutWords } from '../../capture/queue-row';
import { useBeginCapture } from '../../capture/add-button';
import { offersNewScan, reminderHeadline } from '../../documents/reminders';
import { wordsFor } from '../../errors/words';
import { OnThisPhone } from '../../essentials/ui';
import { useEssentials } from '../../state/essentials';
import { extra } from '../../config';
import { useCapture, type SavedNote } from '../../state/capture';
import { on } from '../../state/events';
import { useStepUp } from '../../state/step-up';
import { useVault } from '../../state/vault';
import { Button, Card, Notice, StatusLine, Text } from '../../ui';

interface HomeData {
  due: ReminderView[];
  recent: DocumentView[];
  /** Documents filed without saying what they are. */
  unnamed: number;
  token: string;
  /** An owner made a link to reset this person's password (5.29), until they say they saw it. */
  resetNotice: ResetNotice | null;
  /** A wider audience for identity details, waiting its notice (5.26, A34): everybody is told. */
  widening: IdentityAudienceView['pending'];
}

/**
 * What the vault may not answer without the request being wrong: an older
 * vault, or one busy for a moment, leaves that part of Home out. A session
 * that is over, or no connection, is still everybody's business.
 */
const optional = <T,>(p: Promise<T>): Promise<T | null> =>
  p.catch((err: unknown) => {
    if (err instanceof ApiRequestError && !isSessionOver(err)) return null;
    throw err;
  });

/**
 * Home: what needs attention, and what came in lately. It shows what it
 * last had when the vault cannot be reached, under a plain banner. Above
 * them, what the person must be told (5.31): that an owner made a link to
 * reset their password, and what was added to their sign-in since; and
 * that more people will soon see their identity details.
 */
export default function Home() {
  const { t } = useTranslation();
  const { caps, vault, offline, notice, withToken, api, who } = useVault();
  const capture = useCapture();
  const [data, setData] = useState<HomeData | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // A document is added with the tab bar's + (a file, the camera or a
  // picture); here, a renewal's scanner that cannot start is said.
  const { scannerFailed, setScannerFailed } = useBeginCapture();
  const [othersKept, setOthersKept] = useState(false);
  const [members, setMembers] = useState<Member[] | null>(null);
  const canAdd = who ? can(who.role, 'document.add') : false;
  const identityOn = caps?.features.member_identity === true;
  const needsYou = capture.queue.some((i) => i.state === 'needs_you');

  // The family as last seen, for putting a refused scan right.
  useEffect(() => {
    if (!needsYou) return;
    let cancelled = false;
    void capture.cardData().then((d) => {
      if (!cancelled) setMembers(d?.members ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [needsYou, capture]);

  const load = useCallback(async () => {
    try {
      const next = await withToken(async (a, token) => {
        // The vault filters by status after it takes a page, so every page
        // is read: a scan skipped long ago still needs its name.
        const unnamedCount = async () => {
          let n = 0;
          let cursor: string | undefined;
          for (let page = 0; page < 25; page += 1) {
            const r = await a.documents(token, { status: 'needs_info', limit: 200, ...(cursor ? { cursor } : {}) });
            n += r.items.filter((d) => !d.type_key).length;
            if (!r.has_more || !r.next_cursor) break;
            cursor = r.next_cursor;
          }
          return n;
        };
        const [due, recent, unnamed, me, audience] = await Promise.all([
          a.reminders(token, 'due'),
          a.documents(token, { limit: 20 }),
          unnamedCount(),
          optional(a.me(token)),
          identityOn ? optional(a.identityAudience(token)) : Promise.resolve(null),
        ]);
        return {
          due: due.items,
          recent: recent.items,
          unnamed,
          token,
          resetNotice: me?.reset_notice ?? null,
          widening: audience?.pending ?? null,
        };
      });
      setData(next);
    } catch {
      // Offline or signed out: the banner or the sign-in screen says so.
    }
  }, [withToken, identityOn]);

  useEffect(() => {
    // Loading on arrival, and again each time the vault takes a capture:
    // the state is set after the requests answer, not synchronously, which
    // is what the rule is about.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, capture.delivered]);
  // Put off or done on Needs attention: Home's list looks again.
  useEffect(() => on('remindersChanged', () => void load()), [load]);
  // The vault pushed that something about the person's details is changing.
  useEffect(() => on('noticesChanged', () => void load()), [load]);

  const [renewProblem, setRenewProblem] = useState<string | null>(null);
  const renew = async (documentId: string) => {
    setRenewProblem(null);
    const outcome = await capture.renew(documentId);
    if (outcome === 'failed') setScannerFailed(true);
    else if (outcome === 'too_big') setRenewProblem(t('capture.tooBig'));
    else if (outcome === 'no_space') setRenewProblem(t('capture.noSpace'));
    else if (outcome === 'queue_unavailable') setRenewProblem(t('capture.queueUnavailable'));
    else if (outcome === 'unreadable' || outcome === 'too_many_pages') setRenewProblem(t('capture.unreadable'));
  };
  // "Scan the new one": once per document, not for a teen (who can renew
  // only their own, which Home cannot tell), and not while a new version of
  // it is already waiting to go.
  const renewing = new Set(capture.queue.filter((i) => i.kind === 'version').map((i) => i.target));
  const canRenew = (r: ReminderView, index: number, due: ReminderView[]) =>
    canAdd &&
    who?.role !== 'teen' &&
    !renewing.has(r.document_id) &&
    offersNewScan(r) &&
    due.findIndex((x) => x.document_id === r.document_id && offersNewScan(x)) === index;

  const essentials = useEssentials();
  const refresh = async () => {
    setRefreshing(true);
    // The Essentials kept on the phone are brought up to date too.
    await Promise.all([load(), essentials.sync()]);
    setRefreshing(false);
  };

  const name = caps?.branding.display_name ?? vault?.displayName ?? '';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <FlatList
        testID="home-list"
        data={data?.recent ?? []}
        keyExtractor={(d) => d.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
        contentContainerStyle={styles.page}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <Text variant="hero" style={styles.flex}>
                {name}
              </Text>
              <Link href="/settings" asChild>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('home.settings')}
                  hitSlop={12}
                  style={styles.iconButton}
                >
                  <SettingsIcon color={colours.inkSoft} size={24} />
                </Pressable>
              </Link>
            </View>
            {notice === 'stranger' ? (
              <Notice tone="danger" testID="home-stranger">
                {t('connect.stranger', { host: vault?.origin.replace(/^https?:\/\//, '') ?? '' })}
              </Notice>
            ) : notice === 'wifi_only' ? (
              <Notice tone="warn" testID="home-wifi-only">
                {t('connect.refuseMobileData')}
              </Notice>
            ) : offline ? (
              <Notice tone="warn" testID="home-offline">
                {t('home.offline')}
              </Notice>
            ) : null}
            {capture.saved ? <SavedLine text={savedWords(capture.saved, t)} onDismiss={capture.dismissSaved} /> : null}
            {capture.filedWithout.length > 0 ? (
              <FiledWithoutLine lines={capture.filedWithout.map((f) => withoutWords(f, t, true))} />
            ) : null}
            {renewProblem ? (
              <Notice tone="danger" testID="home-renew-problem">
                {renewProblem}
              </Notice>
            ) : null}
            {scannerFailed ? (
              <Notice tone="warn" testID="home-scanner-failed">
                {t('home.scannerFailed')}
              </Notice>
            ) : null}
            {capture.others.length > 0 && !othersKept ? (
              <Notice tone="warn" testID="home-others" announce={t('home.others', { count: capture.others.length })}>
                <Text>{t('home.others', { count: capture.others.length })}</Text>
                <Button
                  label={t('home.removeThem', { count: capture.others.length })}
                  kind="danger"
                  onPress={() => void capture.removeMany(capture.others.map((i) => i.id))}
                  testID="home-others-remove"
                />
                <Button
                  label={t('home.keepThem', { count: capture.others.length })}
                  kind="quiet"
                  onPress={() => setOthersKept(true)}
                />
              </Notice>
            ) : null}
            {capture.queue.length > 0 ? (
              <View style={styles.queue}>
                <Text variant="screen">{t('home.queueTitle')}</Text>
                {capture.queue.map((item) => (
                  <QueueRow
                    key={item.id}
                    item={item}
                    offline={offline}
                    limit={caps?.limits.max_upload_bytes ?? null}
                    members={members}
                    me={who?.member_id ?? null}
                    onRemove={() => void capture.remove(item.id)}
                    onRetry={(metadata) => void capture.retry(item.id, metadata)}
                  />
                ))}
              </View>
            ) : null}
            {data?.resetNotice ? <ResetNoticeCard notice={data.resetNotice} onSeen={() => void load()} /> : null}
            {data?.widening ? <WideningNotice pending={data.widening} memberId={who?.member_id ?? null} /> : null}
            <OnThisPhone />
            <Text variant="screen">{t('home.attentionTitle')}</Text>
            {data && data.unnamed > 0 ? (
              <Text weight="600" tone="warn" testID="home-unnamed">
                {t('home.needName', { count: data.unnamed })}
              </Text>
            ) : null}
            {data && data.due.length === 0 && data.unnamed === 0 ? (
              <Text tone="soft" testID="home-calm">
                {t('home.calm')}
              </Text>
            ) : null}
            {data?.due.map((r, i, due) => (
              <Card key={r.id} style={styles.dueCard}>
                <Text weight="600">{r.document_title ?? t('home.untitled')}</Text>
                <Text variant="secondary" tone="warn" weight="600">
                  {reminderHeadline(r)}
                </Text>
                {canRenew(r, i, due) ? (
                  <Button
                    label={t('home.renew')}
                    kind="quiet"
                    hint={t('home.renewHint')}
                    onPress={() => void renew(r.document_id)}
                    testID={`renew-${r.document_id}`}
                  />
                ) : null}
              </Card>
            ))}
            <Text variant="screen" style={styles.recentTitle}>
              {t('home.recentTitle')}
            </Text>
            {data && data.recent.length === 0 ? (
              <Text tone="soft" testID="home-none">
                {t(canAdd ? 'home.none' : 'home.noneViewer')}
              </Text>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <DocumentRow
            doc={item}
            token={data?.token ?? null}
            thumb={api && item.latest_version_id ? api.thumbnailUrl(item.latest_version_id) : null}
          />
        )}
      />
      {/* The e2e build only, always on the screen: a flow's markers. */}
      {extra.fixtures ? (
        <View style={styles.e2eMarkers}>
          {/* Tells a flow the card is kept, before it goes offline. */}
          {capture.cardKept ? <View testID="e2e-card-kept" collapsable={false} style={styles.e2eMarker} /> : null}
          {/* What a failed flow's view dump should say. */}
          <View
            testID="e2e-state"
            accessible
            accessibilityLabel={`queue ${capture.storeOpen ? 'open' : 'closed'}, card ${capture.cardKept ? 'kept' : 'not kept'}`}
            collapsable={false}
            style={styles.e2eMarker}
          />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

/** A day in words: "3 Oct 2026". */
const dayOf = (at: string) => formatDate({ date: at.slice(0, 10), precision: 'day' });

/**
 * An owner was given a one-time link to set this person's password (5.29),
 * and what was added to their sign-in since it was used — by whoever used
 * it, perhaps. Said until the person says they saw it. The password is
 * changed in the browser: the phone has no way to.
 */
function ResetNoticeCard(props: { notice: ResetNotice; onSeen: () => void }) {
  const { t } = useTranslation();
  const { guarded } = useStepUp();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const n = props.notice;
  const added = [
    ...(n.passkeys_since ?? []).map((k) =>
      k.label
        ? t('home.resetPasskey', { label: k.label, day: dayOf(k.added_at) })
        : t('home.resetPasskeyUnnamed', { day: dayOf(k.added_at) }),
    ),
    ...(n.two_step_since ? [t('home.resetTwoStep', { day: dayOf(n.two_step_since) })] : []),
    ...(n.links_since ?? []).map((l) =>
      l.title
        ? t('home.resetLink', { title: l.title, day: dayOf(l.made_at) })
        : t('home.resetLinkUntitled', { day: dayOf(l.made_at) }),
    ),
  ];
  const seen = async () => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const done = await guarded((a, token) => a.dismissResetNotice(token));
      if (done !== null) props.onSeen();
    } catch (err) {
      setProblem(wordsFor(err, t));
    } finally {
      setBusy(false);
    }
  };
  const title = t('home.resetTitle');
  return (
    <Notice tone="warn" testID="home-reset-notice" announce={title}>
      <Text weight="700" role="header">
        {title}
      </Text>
      <Text>{t('home.resetBody', { day: dayOf(n.at), by: n.by ?? t('home.resetSomeone') })}</Text>
      {added.length > 0 ? (
        <>
          <Text>{t('home.resetAdded')}</Text>
          {added.map((a, i) => (
            <Text key={i} testID="home-reset-added">{`• ${a}`}</Text>
          ))}
          <Text>{t('home.resetAddedAfter')}</Text>
        </>
      ) : null}
      {problem ? (
        <Text tone="danger" role="alert">
          {problem}
        </Text>
      ) : null}
      <Button
        label={t('home.resetSeen')}
        kind="quiet"
        busy={busy}
        onPress={() => void seen()}
        testID="home-reset-seen"
      />
    </Notice>
  );
}

/**
 * More people will see the person's identity details once a widening's
 * notice runs out (5.26, A34): when, on this phone's clock, and who. Marking
 * fields Only me is done in the browser; a viewer, who marks nothing, is
 * told to ask an owner.
 */
function WideningNotice(props: { pending: NonNullable<IdentityAudienceView['pending']>; memberId: string | null }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { who } = useVault();
  const at = new Date(props.pending.notice_until);
  let when: string;
  try {
    when = shareEndWords(at, Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', { weekday: false });
  } catch {
    when = shareEndWords(at, 'UTC', { weekday: false });
  }
  const whom = props.pending.to === 'family' ? t('home.wideningFamily') : t('home.wideningAdults');
  const words = t('home.widening', { when, who: whom });
  const memberId = props.memberId;
  return (
    <Notice tone="info" testID="home-widening" announce={words}>
      <Text weight="600">{words}</Text>
      <Text tone="soft">{who?.role === 'viewer' ? t('home.wideningViewer') : t('home.wideningMark')}</Text>
      {memberId ? (
        <Button
          label={t('home.wideningLook')}
          kind="quiet"
          onPress={() => router.push({ pathname: '/person/[id]', params: { id: memberId } })}
          testID="home-widening-look"
        />
      ) : null}
    </Notice>
  );
}

/** What Home says once a capture is safe on the phone. */
function savedWords(note: SavedNote, t: TFunction): string {
  if (note.offline) return t('home.savedOffline');
  if (note.renewal) return t('home.savedRenewal');
  if (note.unnamed) return t('home.savedSkipped');
  if (note.reminder) return t('home.savedReminder', { reminder: note.reminder });
  if (note.noExpiry) return t('home.savedNoExpiry');
  return t('home.savedDetails');
}

function SavedLine(props: { text: string; onDismiss: () => void }) {
  const { t } = useTranslation();
  return (
    <Notice tone="ok" testID="home-saved" announce={props.text}>
      <Text>{props.text}</Text>
      <Button label={t('home.dismiss')} kind="quiet" onPress={props.onDismiss} testID="home-saved-dismiss" />
    </Notice>
  );
}

/** Scans the vault took without a detail their kind no longer asks for: said once they are in. */
function FiledWithoutLine(props: { lines: string[] }) {
  const { t } = useTranslation();
  const capture = useCapture();
  return (
    <Notice tone="warn" testID="home-filed-without" announce={props.lines.join(' ')}>
      {props.lines.map((line, i) => (
        <Text key={i}>{line}</Text>
      ))}
      <Button
        label={t('home.dismiss')}
        kind="quiet"
        onPress={capture.dismissFiledWithout}
        testID="home-filed-without-dismiss"
      />
    </Notice>
  );
}

function DocumentRow(props: { doc: DocumentView; token: string | null; thumb: string | null }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { doc } = props;
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
      accessibilityRole="button"
      accessibilityLabel={doc.title ?? t('home.needsAName')}
      testID={`doc-row-${doc.id}`}
      onPress={() => router.push({ pathname: '/document/[id]', params: { id: doc.id } })}
    >
      <View style={styles.thumb}>
        {props.thumb && props.token ? (
          <Image
            source={{ uri: props.thumb, headers: { authorization: `Bearer ${props.token}` } }}
            // Held in memory only: a document's picture never lands in the
            // phone's disk cache.
            cachePolicy="memory"
            style={styles.thumbImage}
            contentFit="cover"
            accessibilityIgnoresInvertColors
          />
        ) : null}
      </View>
      <View style={styles.flex}>
        <Text weight="600">{doc.title ?? t('home.needsAName')}</Text>
        <StatusLine status={doc.status} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  e2eMarkers: { position: 'absolute', left: 0, bottom: 0, flexDirection: 'row' },
  e2eMarker: { width: 1, height: 1 },
  safe: { flex: 1, backgroundColor: colours.bg },
  page: { padding: 20, gap: 10 },
  queue: { gap: 8 },
  needsYou: { gap: 6, borderColor: colours.danger },
  pressed: { opacity: 0.8 },
  header: { gap: 12, marginBottom: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1 },
  iconButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  dueCard: { gap: 4, borderColor: colours.warn },
  recentTitle: { marginTop: 12 },
  row: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    backgroundColor: colours.surface,
    borderRadius: radii.l,
    borderWidth: 1,
    borderColor: colours.border,
    padding: 10,
    minHeight: 72,
  },
  thumb: { width: 48, height: 64, borderRadius: radii.s, backgroundColor: colours.accentSoft, overflow: 'hidden' },
  thumbImage: { width: 48, height: 64 },
});
