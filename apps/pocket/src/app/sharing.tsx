import {
  can,
  emailedToWords,
  ENDED_SHARING_KEPT_NOTE,
  endedSharingWords,
  radii,
  shareEndWords,
  shareUses,
  type RevealedShare,
  type RevealedUploadRequest,
  type Share,
  type UploadRequestView,
} from '@fdv/shared';
import { useRouter } from 'expo-router';
import { FileText, FolderOpen, Link2Off } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, ScrollView, Share as SystemShare, StyleSheet, View } from 'react-native';
import { copyForAMinute, nativeClipboard } from '../identity/clipboard';
import { ChangeLinkSheet } from '../sharing/change-link';
import { EmailTheLink } from '../sharing/email-link';
import { WhoOpened } from '../sharing/opens';
import { RequestRow, requestResumable, requestWorking, ShownRequest, takeSaid, waitingSaid } from '../sharing/requests';
import { useSensitiveConfirm } from '../sharing/sensitive-confirm';
import { Sheet } from '../ui/sheet';
import { wordsFor } from '../errors/words';
import { emit, on } from '../state/events';
import { useFamilyZone } from '../state/family-time';
import { useStepUp } from '../state/step-up';
import { useVault } from '../state/vault';
import { Button, Notice, Text } from '../ui';
import { ConfirmSheet } from '../ui/confirm';
import { feel } from '../ui/feel';
import { sp } from '../ui/space';
import { LoadFailed, loadFailure, Placeholder } from '../ui/states';
import { useColours, useStyles, type Palette } from '../ui/theme';

/** A link that can still be ended: live, opened as often as it allows (its page lasts), or paused. */
const LISTED: readonly Share['state'][] = ['active', 'used_up', 'paused'];

/** Links, or requests, that no longer work, shown before "Show N more" (the web's ENDED_SHOWN). */
export const ENDED_SHOWN = 20;

/**
 * Sharing (the owner's ask of 11 Nov 2026): every link the person may know
 * about that still works, or could again — a document's, a note's, a
 * collection's — newest first: what it gives, whom it is for, when it
 * stops, and how often it has been opened. End this link stops it at once,
 * asked first; it cannot be started again, only shared anew.
 *
 * Show the link (the owner's choice of 11 Nov 2026, a vault of
 * 0.9.0-dev.30): a link the person made since then, and its PIN or the
 * password the vault made up, shown again after confirming it is them —
 * to send it again, or copy it. Links made before are shown once only.
 * Email the link (0.9.0) beside them, where the vault can send it.
 *
 * Turn back on (a vault of 0.9.0-dev.41): a link a restore paused, for an
 * owner to say it still stands, as the web's After a restore does it. One
 * that gives a sensitive document asks first (H1a), in the vault's words.
 *
 * Change (a vault of 0.9.0-dev.49, LK): a link the person made — or, for an
 * owner, anybody's — changed on the form it was made with (change-link.tsx).
 *
 * As the web's Sharing since 0.9.0-dev.53 (RQ): the links that no longer
 * work under them, 20 and then Show N more, saying how long the household
 * keeps them; and, for whoever may ask for documents, the requests to send
 * documents, Working now and No longer working — Show the link, Change,
 * Turn back on for an owner after a restore, and End this request, asked
 * first. Ask for documents makes a new one, and Change changes one, on the
 * phone's own form (app 0.18.0; sharing/ask.tsx).
 *
 * Who opened it (app 0.17.0; the vault's 0.9.0-dev.51, H5): under a link
 * opened at least once, for its maker and the owners, a disclosure closed
 * at first — each opening's time and browser, never an address. Where the
 * vault emailed a link is said on its row for whoever sees it (dev.54).
 */
export default function SharingScreen() {
  const styles = useStyles(makeStyles);
  const colours = useColours();
  const { t } = useTranslation();
  const zone = useFamilyZone();
  const { withToken, offline, caps, vault, who } = useVault();
  const router = useRouter();
  // Only an owner turns back on what a restore paused (`restore.review`), on a
  // vault that asks first about a sensitive document's link (H1a): an older
  // one, which never asks, is left to the web's After a restore, as before.
  const owner = who ? can(who.role, 'restore.review') : false;
  const resumable = caps?.features.sensitive_protects === true && owner;
  const [resuming, setResuming] = useState<string | null>(null);
  const confirm = useSensitiveConfirm({
    title: t('sensitive.resumeTitle'),
    confirmLabel: t('sensitive.resumeYes'),
    id: 'sharing-resume-sensitive',
  });
  const revealOn = caps?.features.share_reveal === true;
  // A link shown again: what the vault gave back, until the sheet is closed.
  const [shown, setShown] = useState<{ share: Share; revealed: RevealedShare } | null>(null);
  const [revealing, setRevealing] = useState<string | null>(null);
  const [copied, setCopied] = useState<'link' | 'secret' | null>(null);
  const { guarded } = useStepUp();
  const [items, setItems] = useState<Share[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [ending, setEnding] = useState<Share | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // A request changed on its own screen is said here once (0.18.0).
  const [said, setSaid] = useState<string | null>(waitingSaid);
  useEffect(() => void takeSaid(), []);
  // Change (LK): the link whose form is open.
  const changeOn = caps?.features.link_changes === true;
  const [changing, setChanging] = useState<Share | null>(null);
  const [allEnded, setAllEnded] = useState(false);
  // Requests to send documents (5.22, RQ): for whoever may ask for them.
  const asksOn = caps?.features.upload_requests === true && (who ? can(who.role, 'upload_request.create') : false);
  const [requests, setRequests] = useState<UploadRequestView[] | null>(null);
  const [requestsFailed, setRequestsFailed] = useState<string | null>(null);
  const [allAskedEnded, setAllAskedEnded] = useState(false);
  const [endingRequest, setEndingRequest] = useState<UploadRequestView | null>(null);
  const [requestBusy, setRequestBusy] = useState<string | null>(null);
  const [shownRequest, setShownRequest] = useState<{ request: UploadRequestView; revealed: RevealedUploadRequest } | null>(
    null,
  );
  // How long what no longer works is kept (RQ, `ended_sharing`): said beside it.
  const [kept, setKept] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await withToken((a, tk) => a.shares(tk));
      setItems([...r.items].sort((x, y) => y.created_at.localeCompare(x.created_at)));
      setFailed(null);
    } catch (err) {
      setFailed(loadFailure('sharing', err, t));
    }
  }, [withToken, t]);

  const loadRequests = useCallback(async () => {
    if (!asksOn) return;
    try {
      const r = await withToken((a, tk) => a.uploadRequests(tk));
      setRequests([...r.items].sort((x, y) => y.created_at.localeCompare(x.created_at)));
      setRequestsFailed(null);
    } catch (err) {
      setRequestsFailed(loadFailure('requests', err, t));
    }
  }, [asksOn, withToken, t]);

  const keptOn = caps?.features.ended_sharing === true;
  const loadKept = useCallback(async () => {
    if (!keptOn) return;
    try {
      const r = await withToken((a, tk) => a.endedSharing(tk));
      setKept(`${endedSharingWords(r.remove_after_days)} ${ENDED_SHARING_KEPT_NOTE}`);
    } catch {
      // Not said, then: the lists stand without it.
      setKept(null);
    }
  }, [keptOn, withToken]);

  useEffect(() => {
    // Loaded on arrival and when the connection returns; set once the vault answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    void loadRequests();
    void loadKept();
  }, [load, loadRequests, loadKept, offline]);
  // A link made meanwhile, from a document's or a collection's Share; a request emailed from its sheet.
  useEffect(() => on('sharesChanged', () => void load()), [load]);
  // Made or changed on the phone's form: said here once Sharing is in front again.
  useEffect(
    () =>
      on('requestsChanged', (words) => {
        if (words) {
          takeSaid();
          setProblem(null);
          setSaid(words);
        }
        void loadRequests();
      }),
    [loadRequests],
  );

  const what = (s: Share) =>
    s.collection_id ? (s.collection_name ?? t('sharing.aCollection')) : (s.document_title ?? t('document.untitled'));

  const reveal = async (s: Share) => {
    setRevealing(s.id);
    setProblem(null);
    setSaid(null);
    try {
      // Confirming it is them first, as the vault asks (reveal_share).
      const revealed = await guarded((a, tk) => a.revealShare(tk, s.id));
      if (!revealed) return;
      setCopied(null);
      setShown({ share: s, revealed });
    } catch (err) {
      setProblem(wordsFor(err, t));
    } finally {
      setRevealing(null);
    }
  };

  const resume = async (s: Share) => {
    setResuming(s.id);
    setProblem(null);
    setSaid(null);
    try {
      // Confirming it is them, as the vault asks; and, for a sensitive document, whether they mean it (H1a).
      const done = await confirm.ask((confirmed) =>
        guarded((a, tk) => a.resumeShare(tk, s.id, confirmed ? { confirm_sensitive: true } : {})),
      );
      if (!done) return;
      feel('done');
      setItems((xs) => xs?.map((x) => (x.id === done.id ? done : x)) ?? xs);
      setSaid(t(done.state === 'paused' ? 'sharing.stillPaused' : 'sharing.worksAgain', { what: what(s) }));
      emit('sharesChanged');
    } catch (err) {
      setProblem(wordsFor(err, t));
    } finally {
      setResuming(null);
    }
  };

  const end = async () => {
    if (!ending) return;
    setBusy(true);
    setProblem(null);
    try {
      const done = await guarded(async (a, tk) => {
        await a.revokeShare(tk, ending.id);
        return true;
      });
      if (!done) return;
      feel('done');
      // Under No longer working now, as the vault keeps it.
      setItems((xs) => xs?.map((x) => (x.id === ending.id ? { ...x, state: 'revoked' as const } : x)) ?? xs);
      setSaid(t('sharing.ended', { what: what(ending) }));
      setEnding(null);
      emit('sharesChanged');
    } catch (err) {
      setProblem(wordsFor(err, t));
    } finally {
      setBusy(false);
    }
  };

  const showRequest = async (r: UploadRequestView) => {
    setRequestBusy(`show:${r.id}`);
    setProblem(null);
    setSaid(null);
    try {
      // Confirming it is them first, as the vault asks (reveal_share).
      const revealed = await guarded((a, tk) => a.revealUploadRequest(tk, r.id));
      if (revealed) setShownRequest({ request: r, revealed });
    } catch (err) {
      setProblem(wordsFor(err, t));
    } finally {
      setRequestBusy(null);
    }
  };

  const resumeRequest = async (r: UploadRequestView) => {
    setRequestBusy(`resume:${r.id}`);
    setProblem(null);
    setSaid(null);
    try {
      const done = await guarded((a, tk) => a.resumeUploadRequest(tk, r.id));
      if (!done) return;
      feel('done');
      setRequests((xs) => xs?.map((x) => (x.id === done.id ? done : x)) ?? xs);
      // As the vault answered: its requester's sign-in may still hold it (5.28).
      const whom = done.requested_by_name ?? t('requests.whoeverAsked');
      setSaid(
        done.state !== 'paused'
          ? t('requests.worksAgain', { title: r.title })
          : done.paused_reason === 'locked'
            ? t('requests.onButLocked', { title: r.title, who: whom })
            : done.paused_reason === 'sign_in_paused'
              ? t('requests.onButSignIn', { title: r.title, who: whom })
              : t('requests.onButPaused', { title: r.title }),
      );
    } catch (err) {
      setProblem(wordsFor(err, t));
    } finally {
      setRequestBusy(null);
    }
  };

  const endRequest = async () => {
    if (!endingRequest) return;
    setBusy(true);
    setProblem(null);
    try {
      await withToken((a, tk) => a.revokeUploadRequest(tk, endingRequest.id));
      feel('done');
      setSaid(t('requests.ended', { title: endingRequest.title }));
      setEndingRequest(null);
      await loadRequests();
    } catch (err) {
      setProblem(wordsFor(err, t));
    } finally {
      setBusy(false);
    }
  };

  const live = (items ?? []).filter((s) => LISTED.includes(s.state));
  const endedAll = (items ?? []).filter((s) => !LISTED.includes(s.state));
  const ended = allEnded ? endedAll : endedAll.slice(0, ENDED_SHOWN);
  const askedLive = (requests ?? []).filter(requestWorking);
  const askedEndedAll = (requests ?? []).filter((r) => !requestWorking(r));
  const askedEnded = allAskedEnded ? askedEndedAll : askedEndedAll.slice(0, ENDED_SHOWN);

  const linkRow = (s: Share) => {
    const Icon = s.collection_id ? FolderOpen : FileText;
    const lines = [
      s.recipient_label ? t('sharing.for', { who: s.recipient_label }) : null,
      t(s.state === 'paused' ? 'sharing.paused' : 'sharing.ends', {
        end: shareEndWords(new Date(s.expires_at), zone),
      }),
      shareUses(s),
      // Where the vault emailed it, masked, for whoever sees the link (0.9.0-dev.54).
      s.emailed_to ? emailedToWords(s.emailed_to, s.emailed_by_name, s.mine) : null,
      s.created_by_name ? t('sharing.by', { who: s.created_by_name }) : null,
    ].filter((x): x is string => !!x);
    return (
      <View style={styles.row} testID={`sharing-${s.id}`} key={s.id}>
        <View style={styles.head}>
          <View style={styles.icon}>
            <Icon color={colours.accent} size={18} accessibilityElementsHidden importantForAccessibility="no" />
          </View>
          <View style={styles.words}>
            <Text weight="600">{what(s)}</Text>
            {lines.map((l) => (
              <Text key={l} variant="small" tone="soft">
                {l}
              </Text>
            ))}
            {/* Who opened it, when (H5): its maker's and an owner's, asked for when opened. */}
            <WhoOpened link={s} testID={`sharing-opens-${s.id}`} />
          </View>
        </View>
        <View style={styles.actions}>
          {resumable && s.state === 'paused' && s.paused_reason === 'restored' ? (
            <Button
              size="small"
              kind="quiet"
              label={t('sharing.resume')}
              accessibilityLabel={t('sharing.resumeFor', { what: what(s) })}
              busy={resuming === s.id}
              disabled={offline || resuming !== null}
              onPress={() => void resume(s)}
              testID={`sharing-resume-${s.id}`}
            />
          ) : null}
          {revealOn && s.revealable ? (
            <Button
              size="small"
              kind="quiet"
              label={t('sharing.show')}
              accessibilityLabel={t('sharing.showFor', { what: what(s) })}
              busy={revealing === s.id}
              disabled={offline || revealing !== null}
              onPress={() => void reveal(s)}
              testID={`sharing-show-${s.id}`}
            />
          ) : null}
          {changeOn && s.changeable === true ? (
            <Button
              size="small"
              kind="quiet"
              label={t('changeLink.button')}
              accessibilityLabel={t('changeLink.buttonFor', { what: what(s) })}
              disabled={offline}
              onPress={() => {
                setProblem(null);
                setSaid(null);
                setChanging(s);
              }}
              testID={`sharing-change-${s.id}`}
            />
          ) : null}
          <Button
            size="small"
            kind="quiet"
            label={t('sharing.end')}
            accessibilityLabel={t('sharing.endFor', { what: what(s) })}
            disabled={offline}
            onPress={() => {
              setProblem(null);
              setSaid(null);
              setEnding(s);
            }}
            testID={`sharing-end-${s.id}`}
          />
        </View>
      </View>
    );
  };

  /** A link that no longer works: what it was to, and what the vault says of it; nothing to do. */
  const endedRow = (s: Share) => {
    const Icon = s.collection_id ? FolderOpen : FileText;
    const lines = [
      s.recipient_label ? t('sharing.for', { who: s.recipient_label }) : null,
      s.summary || null,
      s.emailed_to ? emailedToWords(s.emailed_to, s.emailed_by_name, s.mine) : null,
      s.created_by_name ? t('sharing.by', { who: s.created_by_name }) : null,
    ].filter((x): x is string => !!x);
    return (
      <View style={styles.row} testID={`sharing-ended-${s.id}`} key={s.id}>
        <View style={styles.head}>
          <View style={[styles.icon, styles.iconEnded]}>
            <Icon color={colours.inkMuted} size={18} accessibilityElementsHidden importantForAccessibility="no" />
          </View>
          <View style={styles.words}>
            <Text weight="600">{what(s)}</Text>
            {lines.map((l) => (
              <Text key={l} variant="small" tone="soft">
                {l}
              </Text>
            ))}
            {/* Who opened it, when (H5): its maker's and an owner's, asked for when opened. */}
            <WhoOpened link={s} testID={`sharing-opens-${s.id}`} />
          </View>
        </View>
      </View>
    );
  };

  return (
    <>
      <ScrollView
        testID="sharing"
        style={styles.screen}
        contentContainerStyle={styles.page}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void Promise.all([load(), loadRequests(), loadKept()]).finally(() => setRefreshing(false));
            }}
          />
        }
      >
        <View style={styles.header}>
          <Text variant="secondary" tone="soft">
            {t(asksOn ? 'sharing.wordsWithRequests' : 'sharing.words')}
          </Text>
          {offline ? (
            <Notice tone="warn" testID="sharing-offline">
              {t('sharing.needsConnection')}
            </Notice>
          ) : null}
          {said ? (
            <Notice tone="ok" testID="sharing-said">
              {said}
            </Notice>
          ) : null}
          {problem && !ending && !endingRequest ? (
            <Notice tone="warn" testID="sharing-problem">
              {problem}
            </Notice>
          ) : null}
          {failed ? <LoadFailed words={failed} onRetry={() => void load()} /> : null}
          {!items && !failed && !offline ? <Placeholder rows={3} /> : null}
        </View>
        {items ? (
          <View style={styles.section} testID="sharing-live">
            <Text variant="title" style={styles.heading}>
              {t('sharing.workingNow')}
            </Text>
            {live.length === 0 ? (
              <Text tone="soft" testID="sharing-none">
                {t('sharing.none')}
              </Text>
            ) : null}
            {live.map(linkRow)}
          </View>
        ) : null}
        {ended.length > 0 ? (
          <View style={styles.section} testID="sharing-ended">
            <Text variant="title" style={styles.heading}>
              {t('sharing.noLongerWorking')}
            </Text>
            {kept ? (
              <Text variant="small" tone="soft" testID="sharing-kept">
                {kept}
              </Text>
            ) : null}
            {ended.map(endedRow)}
            {endedAll.length > ended.length ? (
              <Button
                kind="quiet"
                label={t('sharing.showMore', { count: endedAll.length - ended.length })}
                accessibilityLabel={t('sharing.showMoreLinks', { count: endedAll.length - ended.length })}
                onPress={() => setAllEnded(true)}
                testID="sharing-ended-more"
              />
            ) : null}
          </View>
        ) : null}
        {asksOn ? (
          <View style={styles.section} testID="requests">
            <Text variant="title" style={styles.heading}>
              {t('requests.title')}
            </Text>
            <Text variant="secondary" tone="soft">
              {t('requests.words')}
            </Text>
            <Button
              label={t('requests.ask')}
              disabled={offline}
              onPress={() => {
                setSaid(null);
                router.push('/ask');
              }}
              testID="requests-ask"
            />
            {requestsFailed ? <LoadFailed words={requestsFailed} onRetry={() => void loadRequests()} /> : null}
            {!requests && !requestsFailed && !offline ? <Placeholder rows={2} /> : null}
            {requests ? (
              <>
                <Text variant="secondary" weight="600">
                  {t('sharing.workingNow')}
                </Text>
                {askedLive.length === 0 ? (
                  <Text tone="soft" testID="requests-none">
                    {t('requests.none')}
                  </Text>
                ) : null}
                {askedLive.map((r) => (
                  <RequestRow
                    key={r.id}
                    request={r}
                    owner={owner}
                    zone={zone}
                    actions={{
                      disabled: offline || requestBusy !== null,
                      showing: requestBusy === `show:${r.id}`,
                      resuming: requestBusy === `resume:${r.id}`,
                      ...(changeOn && r.revealable === true ? { onShow: () => void showRequest(r) } : {}),
                      ...(changeOn && r.changeable === true
                        ? {
                            onChange: () => {
                              setSaid(null);
                              router.push({ pathname: '/ask/[id]', params: { id: r.id } });
                            },
                          }
                        : {}),
                      ...(requestResumable(r, owner) ? { onResume: () => void resumeRequest(r) } : {}),
                      onEnd: () => {
                        setProblem(null);
                        setSaid(null);
                        setEndingRequest(r);
                      },
                    }}
                  />
                ))}
                {askedEnded.length > 0 ? (
                  <View style={styles.section} testID="requests-ended">
                    <Text variant="secondary" weight="600">
                      {t('sharing.noLongerWorking')}
                    </Text>
                    {kept ? (
                      <Text variant="small" tone="soft">
                        {kept}
                      </Text>
                    ) : null}
                    {askedEnded.map((r) => (
                      <RequestRow key={r.id} request={r} owner={owner} zone={zone} />
                    ))}
                    {askedEndedAll.length > askedEnded.length ? (
                      <Button
                        kind="quiet"
                        label={t('sharing.showMore', { count: askedEndedAll.length - askedEnded.length })}
                        accessibilityLabel={t('sharing.showMoreRequests', {
                          count: askedEndedAll.length - askedEnded.length,
                        })}
                        onPress={() => setAllAskedEnded(true)}
                        testID="requests-ended-more"
                      />
                    ) : null}
                  </View>
                ) : null}
              </>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
      {shown ? (
        <ShownLink
          share={shown.share}
          revealed={shown.revealed}
          what={what(shown.share)}
          origin={vault?.origin ?? ''}
          copied={copied}
          onCopied={setCopied}
          onClose={() => setShown(null)}
        />
      ) : null}
      {changing ? (
        <ChangeLinkSheet
          link={changing}
          what={what(changing)}
          onClose={() => {
            setChanging(null);
            // Read again, so Change opened again starts from the link as the vault has it now.
            void load();
          }}
          onDone={(words) => {
            setChanging(null);
            setSaid(words);
            void load();
          }}
        />
      ) : null}
      {shownRequest ? (
        <ShownRequest
          request={shownRequest.request}
          revealed={shownRequest.revealed}
          origin={vault?.origin ?? ''}
          onClose={() => setShownRequest(null)}
        />
      ) : null}
      <ConfirmSheet
        visible={endingRequest !== null}
        testID="request-end-question"
        icon={Link2Off}
        title={t('requests.endTitle')}
        words={t('requests.endWords', { who: endingRequest?.recipient_label ?? t('requests.whoeverHasIt') })}
        confirmLabel={t('requests.endYes')}
        busy={busy}
        problem={problem}
        onConfirm={() => void endRequest()}
        onCancel={() => setEndingRequest(null)}
        confirmID="request-end-yes"
        cancelID="request-end-cancel"
        problemID="request-end-problem"
      />
      <ConfirmSheet
        visible={ending !== null}
        testID="sharing-end-question"
        icon={Link2Off}
        title={t('sharing.endTitle')}
        words={t('sharing.endWords', { what: ending ? what(ending) : '' })}
        confirmLabel={t('sharing.endYes')}
        busy={busy}
        problem={problem}
        onConfirm={() => void end()}
        onCancel={() => setEnding(null)}
        confirmID="sharing-end-yes"
        cancelID="sharing-end-cancel"
        problemID="sharing-end-problem"
      />
      {confirm.sheet}
    </>
  );
}

/** A link shown again, with its PIN or password: Send, Copy, Email where it can, and gone when closed. */
function ShownLink(props: {
  share: Share;
  revealed: RevealedShare;
  what: string;
  origin: string;
  copied: 'link' | 'secret' | null;
  onCopied: (what: 'link' | 'secret') => void;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const { t } = useTranslation();
  const { revealed } = props;
  const link = revealed.link_url ?? `${props.origin}/s#${revealed.link_token}`;
  const secret = revealed.pin ?? revealed.password ?? null;
  const clipboard = nativeClipboard();
  const copy = (what: 'link' | 'secret', text: string) => {
    if (clipboard && copyForAMinute(clipboard, text)) props.onCopied(what);
  };
  return (
    <Sheet visible onClose={props.onClose} testID="sharing-shown" keyboard tall>
      <ScrollView contentContainerStyle={styles.shown} keyboardShouldPersistTaps="handled">
        <Text variant="screen">{t('sharing.shownTitle', { what: props.what })}</Text>
        {props.share.recipient_label ? (
          <Text variant="secondary" tone="soft">
            {t('sharing.for', { who: props.share.recipient_label })}
          </Text>
        ) : null}
        <View style={styles.linkBox}>
          <Text testID="sharing-shown-link">
            {link}
          </Text>
        </View>
        {secret ? (
          <View style={styles.secret}>
            <Text variant="secondary" weight="600" tone="soft">
              {revealed.pin ? t('share.pin') : t('share.password')}
            </Text>
            <Text variant="title" testID="sharing-shown-secret">
              {secret}
            </Text>
          </View>
        ) : null}
        <Button label={t('share.send')} onPress={() => void SystemShare.share({ message: link })} testID="sharing-shown-send" />
        {clipboard ? (
          <Button
            kind="quiet"
            label={props.copied === 'link' ? t('share.copied') : t('share.copyLink')}
            onPress={() => copy('link', link)}
            testID="sharing-shown-copy-link"
          />
        ) : null}
        {clipboard && secret ? (
          <Button
            kind="quiet"
            label={
              props.copied === 'secret' ? t('share.copied') : revealed.pin ? t('share.copyPin') : t('share.copyPassword')
            }
            onPress={() => copy('secret', secret)}
            testID="sharing-shown-copy-secret"
          />
        ) : null}
        <EmailTheLink share={props.share} testID="sharing-shown-email" />
        <Button kind="quiet" label={t('share.done')} onPress={props.onClose} testID="sharing-shown-done" />
      </ScrollView>
    </Sheet>
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    screen: { backgroundColor: colours.bg },
    page: { padding: sp(20), gap: sp(8) },
    header: { gap: sp(10), marginBottom: sp(4) },
    section: { gap: sp(8) },
    heading: { marginTop: sp(8) },
    row: {
      gap: sp(8),
      padding: sp(12),
      borderRadius: radii.m,
      borderWidth: 1,
      borderColor: colours.border,
      backgroundColor: colours.surface,
    },
    head: { flexDirection: 'row', gap: sp(10), alignItems: 'flex-start' },
    icon: {
      width: 32,
      height: 32,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colours.accentSoft,
    },
    iconEnded: { backgroundColor: colours.bg },
    words: { flex: 1, gap: 2 },
    actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: sp(8) },
    shown: { gap: sp(12) },
    linkBox: {
      padding: sp(12),
      borderRadius: radii.m,
      borderWidth: 1,
      borderColor: colours.border,
      backgroundColor: colours.surface,
    },
    secret: { gap: 2 },
  });
