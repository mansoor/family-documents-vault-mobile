import { ApiRequestError, isSessionOver } from '@fdv/client';
import {
  can,
  type Capabilities,
  type DocumentView,
  type IdentityAudienceView,
  type Member,
  type ReminderView,
  type ResetNotice,
} from '@fdv/shared';
import { useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { AppState, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AccessNotice, myAccess, type MyAccess } from '../../access/access';
import { QueueRow, withoutWords } from '../../capture/queue-row';
import { useBeginCapture } from '../../capture/add-button';
import { offersNewScan } from '../../documents/reminders';
import { wordsFor } from '../../errors/words';
import { OnThisPhone } from '../../essentials/ui';
import { waitingInInbox } from '../../queue/inbox';
import { useEssentials } from '../../state/essentials';
import { extra } from '../../config';
import { useCapture, type SavedNote } from '../../state/capture';
import { on } from '../../state/events';
import { useStepUp } from '../../state/step-up';
import { useVault } from '../../state/vault';
import { Button, Notice, Text } from '../../ui';
import { DocumentRow, rowPlace } from '../../documents/row';
import { countAlert, reminderAlert, type HomeAlert } from '../../home/alerts';
import { AlertCards } from '../../home/alert-cards';
import { Counts, ESSENTIALS_SHOWN, EssentialsLine, EssentialsSection, type HomeCounts } from '../../home/glance';
import { sp } from '../../ui/space';
import { VaultRead } from '../../capture/vault-read';
import { useStyles, type Palette } from '../../ui/theme';
import { dayWords, endWords, useFamilyZone } from '../../state/family-time';
import { LoadFailed, loadFailure, Placeholder } from '../../ui/states';

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
  /** What an owner limited this person to, and a guest's end (5.33, 5.34). */
  access: MyAccess | null;
  /** At a glance (R4), where the vault counts: a vault with the Documents table. */
  counts: HomeCounts | null;
  /** The family's Essentials, above Recently added (the owner's ask of 11 Nov 2026). */
  essentials: DocumentView[];
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
 * Home (R4, the owner's redesign of 10 Nov 2026): what needs doing, as
 * alerts that can be hidden for a while; three numbers at a glance; the
 * Essentials kept on the phone; and the five documents added last. Nothing
 * says "nothing to do": the bell carries what is due.
 *
 * Earlier: what needs attention, and what came in lately. It shows what it
 * last had when the vault cannot be reached, under a plain banner. Above
 * them, what the person must be told (5.31): that an owner made a link to
 * reset their password, and what was added to their sign-in since; and
 * that more people will soon see their identity details. And what they can
 * see, when an owner limited it, and a guest's end (5.36).
 */
export default function Home() {
  const styles = useStyles(makeStyles);
  const { t } = useTranslation();
  const router = useRouter();
  const { caps, vault, offline, waiting, notice, withTokenQuick, api, who } = useVault();
  const capture = useCapture();
  const [data, setData] = useState<HomeData | null>(null);
  // A failure that is not the connection (P5): said, with Try again.
  const [failed, setFailed] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // A document is added with the tab bar's + (a file, the camera or a
  // picture); here, a renewal's scanner that cannot start is said.
  const { scannerFailed, setScannerFailed } = useBeginCapture();
  const [othersKept, setOthersKept] = useState(false);
  const [members, setMembers] = useState<Member[] | null>(null);
  const canAdd = who ? can(who.role, 'document.add') : false;
  const identityOn = caps?.features.member_identity === true;
  const counted = caps?.features.document_table === true;
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
      // Never waits out a renewal turned away for too many tries (I5-4): what
      // Home last had stays, under the banner.
      const next = await withTokenQuick(async (a, token) => {
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
        // How many: the table's total for a column sort, one row asked for (0.6.0);
        // documents without the notes where the vault leaves them out (the owner's tidy-up of 11 Nov 2026).
        const apart = caps?.features.notes_apart === true ? { notes: 'exclude' as const } : {};
        const total = async (status?: 'expiring_soon' | 'needs_info') =>
          (await a.documents(token, { sort: 'title', direction: 'asc', limit: 1, ...apart, ...(status ? { status } : {}) }))
            .total ?? 0;
        // And how many notes, where the vault keeps them: the newest it lists, and more when it says so.
        const noteCount = async (): Promise<HomeCounts['notes']> => {
          if (caps?.features.notes !== true) return null;
          const r = await a.notes(token);
          return { n: r.items.length, more: r.truncated };
        };
        const glance = async (): Promise<HomeCounts | null> => {
          if (!counted) return null;
          const [all, expiring, details, notes, people, collections] = await Promise.all([
            total(),
            total('expiring_soon'),
            total('needs_info'),
            noteCount().catch(() => null),
            a.members(token).then(
              (r) => r.items.length,
              () => null,
            ),
            caps?.features.collections === true
              ? a.collections(token).then(
                  (r) => r.items.length,
                  () => null,
                )
              : Promise.resolve(null),
          ]);
          return { total: all, expiring, details, notes, people, collections };
        };
        const [due, recent, unnamed, me, audience, counts, essentials] = await Promise.all([
          a.reminders(token, 'due'),
          a.documents(token, { limit: 5 }),
          unnamedCount(),
          optional(a.me(token)),
          identityOn ? optional(a.identityAudience(token)) : Promise.resolve(null),
          optional(glance()),
          // The Essentials, newest first: six at most, and See all for the rest.
          optional(a.documents(token, { essential: true, limit: ESSENTIALS_SHOWN + 1 })),
        ]);
        return {
          due: due.items,
          recent: recent.items,
          unnamed,
          token,
          resetNotice: me?.reset_notice ?? null,
          widening: audience?.pending ?? null,
          // A guest's end is said on the family's clock, which the profile knows.
          access: await myAccess(me, async () => (await optional(a.profile(token)))?.timezone),
          counts,
          // Only what says it is one: a vault that does not narrow by it lists everything.
          essentials: (essentials?.items ?? []).filter((d) => d.is_essential),
        };
      });
      setData(next);
      setFailed(null);
    } catch (err) {
      // Offline or signed out: the banner or the sign-in screen says so. Anything else, here.
      setFailed(loadFailure('home', err, t));
    }
  }, [withTokenQuick, identityOn, counted, caps?.features.notes, caps?.features.notes_apart, caps?.features.collections, t]);

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
  // Changed or moved to the Trash on its page (P8).
  useEffect(() => on('documentChanged', () => void load()), [load]);

  // How many of the person's own files wait in their Inbox (I5), where the
  // vault has batches and they may add documents: a viewer, and so a
  // guest, is never asked, and sees nothing. Asked on arrival, after each
  // send, each time Home is in view again, and when the app comes back to
  // the front — on its own, so none of these reloads the rest of Home.
  const inboxOn = caps?.features.batches === true && canAdd;
  const [inbox, setInbox] = useState<number | null>(null);
  const loadInbox = useCallback(async () => {
    if (!inboxOn) return;
    try {
      setInbox(await withTokenQuick((a, token) => waitingInInbox(a, token)));
    } catch (err) {
      // Refused (no longer one who adds, say): nothing to show. No answer: what it last said.
      if (err instanceof ApiRequestError) setInbox(null);
    }
  }, [inboxOn, withTokenQuick]);
  useEffect(() => {
    // Set when the vault answers, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadInbox();
  }, [loadInbox, capture.delivered]);
  const navigation = useNavigation();
  useEffect(() => navigation.addListener('focus', () => void loadInbox()), [navigation, loadInbox]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void loadInbox();
    });
    return () => sub.remove();
  }, [loadInbox]);

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
  const canRenewAt = (r: ReminderView, index: number, due: ReminderView[]) =>
    canAdd &&
    who?.role !== 'teen' &&
    !renewing.has(r.document_id) &&
    offersNewScan(r) &&
    due.findIndex((x) => x.document_id === r.document_id && offersNewScan(x)) === index;

  const essentials = useEssentials();
  const refresh = async () => {
    setRefreshing(true);
    // The Essentials kept on the phone are brought up to date too.
    await Promise.all([load(), loadInbox(), essentials.sync()]);
    setRefreshing(false);
  };

  // What needs doing, as alerts (R4): due reminders, documents with no name, files in the Inbox.
  const due = data?.due ?? [];
  const recent = (data?.recent ?? []).slice(0, 5);
  const alerts: HomeAlert[] = [
    ...due.map(reminderAlert),
    ...(data && data.unnamed > 0 ? [countAlert('unnamed', data.unnamed)] : []),
    ...(inboxOn && inbox !== null && inbox > 0 ? [countAlert('inbox', inbox)] : []),
  ];
  const canRenew = (alert: HomeAlert) => {
    const r = alert.reminder;
    return !!r && canRenewAt(r, due.indexOf(r), due);
  };

  return (
    <SafeAreaView style={styles.safe} edges={[]}>
      <FlatList
        testID="home-list"
        // The five added last (R4); See all opens Documents.
        data={recent}
        keyExtractor={(d) => d.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
        contentContainerStyle={styles.page}
        ListHeaderComponent={
          <View style={styles.header}>
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
            {waiting !== null ? (
              <Notice tone="info" testID="home-waiting">
                {t('home.vaultWait', { count: waiting })}
              </Notice>
            ) : null}
            {capture.saved ? (
              <SavedLine
                text={savedWords(capture.saved, t, caps)}
                onDismiss={capture.dismissSaved}
                {...(capture.saved.renewalSent && capture.saved.renews && caps?.features.version_details === true
                  ? { renews: capture.saved.renews }
                  : {})}
              />
            ) : null}
            {/* What the vault read of a scan sent to the Inbox (P3), where it can say. */}
            {capture.saved?.inboxItem && caps?.features.batch_review === true ? (
              <VaultRead
                key={capture.saved.inboxItem.item}
                batch={capture.saved.inboxItem.batch}
                item={capture.saved.inboxItem.item}
              />
            ) : null}
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
            {data?.access ? <AccessNotice access={data.access} /> : null}
            {vault && who ? (
              <AlertCards
                alerts={alerts}
                who={`${vault.origin}|${who.member_id}`}
                canRenew={canRenew}
                onRenew={(id) => void renew(id)}
                inboxOrigin={vault.origin}
              />
            ) : null}
            <OnThisPhone />
            {data?.counts ? <Counts counts={data.counts} /> : null}
            {/* The Essentials, from the vault; without a connection, those kept on this phone. */}
            {data ? (
              <EssentialsSection docs={data.essentials} token={data.token} />
            ) : (
              <EssentialsLine />
            )}
            {/* Home has what it asked for: what a test or a flow waits for, now that
                nothing says "nothing to do" (R4). */}
            <View style={styles.recentHead} {...(data ? { testID: 'home-ready' } : {})}>
              <Text variant="screen" style={styles.flex}>
                {t('home.recentTitle')}
              </Text>
              <Button
                kind="quiet"
                label={t('home.allDocuments')}
                onPress={() => router.push('/documents')}
                testID="home-all-documents"
              />
            </View>
            {failed ? <LoadFailed words={failed} onRetry={() => void load()} /> : null}
            {!data && !failed && !offline ? <Placeholder /> : null}
            {data && data.recent.length === 0 ? (
              <Text tone="soft" testID="home-none">
                {t(canAdd ? 'home.none' : 'home.noneViewer')}
              </Text>
            ) : null}
          </View>
        }
        renderItem={({ item, index }) => (
          <DocumentRow
            id={item.id}
            title={item.title}
            type_key={item.type_key}
            note_name={item.note_name}
            status={item.status}
            doc={item}
            place={rowPlace(index, recent.length)}
            // A note with no title is named by its first words (0.9.0); a scan with none needs a name.
            untitled={t('home.needsAName')}
            thumb={
              api && data?.token && item.latest_version_id
                ? { uri: api.thumbnailUrl(item.latest_version_id), token: data.token }
                : null
            }
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

/**
 * The day a moment fell on, on the family's calendar (P5), in words: "3 Oct
 * 2026", as the web says it, never the UTC day.
 */
const dayOf = (at: string, zone: string) => dayWords(at, zone);

/**
 * An owner was given a one-time link to set this person's password (5.29),
 * and what was added to their sign-in since it was used — by whoever used
 * it, perhaps. Said until the person says they saw it. The password is
 * changed in the browser: the phone has no way to.
 */
function ResetNoticeCard(props: { notice: ResetNotice; onSeen: () => void }) {
  const { t } = useTranslation();
  const zone = useFamilyZone();
  const { guarded } = useStepUp();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const n = props.notice;
  const added = [
    ...(n.passkeys_since ?? []).map((k) =>
      k.label
        ? t('home.resetPasskey', { label: k.label, day: dayOf(k.added_at, zone) })
        : t('home.resetPasskeyUnnamed', { day: dayOf(k.added_at, zone) }),
    ),
    ...(n.two_step_since ? [t('home.resetTwoStep', { day: dayOf(n.two_step_since, zone) })] : []),
    ...(n.links_since ?? []).map((l) =>
      l.title
        ? t('home.resetLink', { title: l.title, day: dayOf(l.made_at, zone) })
        : t('home.resetLinkUntitled', { day: dayOf(l.made_at, zone) }),
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
      <Text>{t('home.resetBody', { day: dayOf(n.at, zone), by: n.by ?? t('home.resetSomeone') })}</Text>
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
  const zone = useFamilyZone();
  const at = new Date(props.pending.notice_until);
  // On the family's clock, and its zone named where the phone's reads otherwise (P5).
  const when = endWords(at, zone, { weekday: false });
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
function savedWords(note: SavedNote, t: TFunction, caps: Capabilities | null): string {
  const versionDetails = caps?.features.version_details === true;
  if (note.inbox) {
    // What the vault reads of it is shown below the line, where it can be filed (P3).
    if (note.inboxSent && note.inboxItem && caps?.features.batch_review === true) return t('home.savedInboxReading');
    if (note.inboxSent) return t('home.savedInbox');
    if (note.inboxFiled) return t('home.savedInboxFiled');
    return t(note.offline ? 'home.savedInboxOffline' : 'home.savedInboxSending');
  }
  if (note.offline) return t('home.savedOffline');
  // In the vault, which reads its pages: what they say is on the document's page (P2).
  if (note.renewal && note.renewalSent && versionDetails) return t('home.renewalIn');
  if (note.renewal) return t('home.savedRenewal');
  if (note.unnamed) return t('home.savedSkipped');
  if (note.reminder) return t('home.savedReminder', { reminder: note.reminder });
  if (note.noExpiry) return t('home.savedNoExpiry');
  return t('home.savedDetails');
}

function SavedLine(props: { text: string; onDismiss: () => void; renews?: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { renews } = props;
  return (
    <Notice tone="ok" testID="home-saved" announce={props.text}>
      <Text>{props.text}</Text>
      {renews ? (
        <Button
          label={t('home.renewalLook')}
          onPress={() => router.push({ pathname: '/document/[id]', params: { id: renews } })}
          testID="home-renewal-look"
        />
      ) : null}
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

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    e2eMarkers: { position: 'absolute', left: 0, bottom: 0, flexDirection: 'row' },
    e2eMarker: { width: 1, height: 1 },
    safe: { flex: 1, backgroundColor: colours.bg },
    page: { padding: sp(20) },
    queue: { gap: sp(8) },
    pressed: { opacity: 0.8 },
    header: { gap: sp(12), marginBottom: sp(10) },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: sp(4) },
    flex: { flex: 1 },
    iconButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    dueCard: { gap: sp(4), borderColor: colours.warn },
    inbox: { gap: sp(6) },
    recentHead: { marginTop: sp(12), flexDirection: 'row', alignItems: 'center', gap: sp(12) },
  });
