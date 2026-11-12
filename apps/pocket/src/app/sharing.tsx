import { radii, shareEndWords, shareUses, type RevealedShare, type Share } from '@fdv/shared';
import { FileText, FolderOpen, Link2Off } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, RefreshControl, ScrollView, Share as SystemShare, StyleSheet, View } from 'react-native';
import { copyForAMinute, nativeClipboard } from '../identity/clipboard';
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
 */
export default function SharingScreen() {
  const styles = useStyles(makeStyles);
  const colours = useColours();
  const { t } = useTranslation();
  const zone = useFamilyZone();
  const { withToken, offline, caps, vault } = useVault();
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
  const [said, setSaid] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await withToken((a, tk) => a.shares(tk));
      setItems(
        r.items
          .filter((s) => LISTED.includes(s.state))
          .sort((x, y) => y.created_at.localeCompare(x.created_at)),
      );
      setFailed(null);
    } catch (err) {
      setFailed(loadFailure('sharing', err, t));
    }
  }, [withToken, t]);

  useEffect(() => {
    // Loaded on arrival and when the connection returns; set once the vault answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, offline]);
  // A link made meanwhile, from a document's or a collection's Share.
  useEffect(() => on('sharesChanged', () => void load()), [load]);

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
      setItems((xs) => xs?.filter((x) => x.id !== ending.id) ?? xs);
      setSaid(t('sharing.ended', { what: what(ending) }));
      setEnding(null);
      emit('sharesChanged');
    } catch (err) {
      setProblem(wordsFor(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <FlatList
        testID="sharing"
        style={styles.screen}
        contentContainerStyle={styles.page}
        data={items ?? []}
        keyExtractor={(s) => s.id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load().finally(() => setRefreshing(false));
            }}
          />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <Text variant="secondary" tone="soft">
              {t('sharing.words')}
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
            {problem && !ending ? (
              <Notice tone="warn" testID="sharing-problem">
                {problem}
              </Notice>
            ) : null}
            {failed ? <LoadFailed words={failed} onRetry={() => void load()} /> : null}
            {!items && !failed && !offline ? <Placeholder rows={3} /> : null}
            {items && items.length === 0 ? (
              <Text tone="soft" testID="sharing-none">
                {t('sharing.none')}
              </Text>
            ) : null}
          </View>
        }
        renderItem={({ item: s }) => {
          const Icon = s.collection_id ? FolderOpen : FileText;
          const lines = [
            s.recipient_label ? t('sharing.for', { who: s.recipient_label }) : null,
            t(s.state === 'paused' ? 'sharing.paused' : 'sharing.ends', {
              end: shareEndWords(new Date(s.expires_at), zone),
            }),
            shareUses(s),
            s.created_by_name ? t('sharing.by', { who: s.created_by_name }) : null,
          ].filter((x): x is string => !!x);
          return (
            <View style={styles.row} testID={`sharing-${s.id}`}>
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
                </View>
              </View>
              <View style={styles.actions}>
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
        }}
      />
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
    </>
  );
}

/** A link shown again, with its PIN or password: Send, Copy, and gone when closed. */
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
    <Sheet visible onClose={props.onClose} testID="sharing-shown" tall>
      <ScrollView contentContainerStyle={styles.shown}>
        <Text variant="screen">{t('sharing.shownTitle', { what: props.what })}</Text>
        {props.share.recipient_label ? (
          <Text variant="secondary" tone="soft">
            {t('sharing.for', { who: props.share.recipient_label })}
          </Text>
        ) : null}
        <View style={styles.linkBox}>
          <Text selectable testID="sharing-shown-link">
            {link}
          </Text>
        </View>
        {secret ? (
          <View style={styles.secret}>
            <Text variant="secondary" weight="600" tone="soft">
              {revealed.pin ? t('share.pin') : t('share.password')}
            </Text>
            <Text variant="title" selectable testID="sharing-shown-secret">
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
    words: { flex: 1, gap: 2 },
    actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: sp(8) },
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
