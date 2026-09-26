import { ApiRequestError, NetworkError } from '@fdv/client';
import { wordsFor } from '../errors/words';
import {
  can,
  colours,
  formatDate,
  radii,
  whenWords,
  type DocumentView,
  type Member,
  type VersionView,
} from '@fdv/shared';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { renewWords } from '../capture/renew-words';
import { holdForShow } from '../show/handoff';
import { useCapture } from '../state/capture';
import { useEssentials } from '../state/essentials';
import { useLock } from '../state/lock';
import { useStepUp } from '../state/step-up';
import { useVault } from '../state/vault';
import { Button, Notice, StatusLine, Text } from '../ui';
import { latestOf, openOnline } from './online';
import { markWarnedAboutCopies, saveCopy, warnedAboutCopies } from './save-copy';

type Problem = 'offline' | 'not_found' | null;

/**
 * A document (4.12). Its primary action is Show for an Essential, Save a
 * copy for everything else. Its pages come from the phone when it is kept
 * there (without asking anything), otherwise from the vault, confirming it
 * is you if the vault asks. Then its details, its status and who can see
 * it; the Essential switch (online only: a change made meanwhile by
 * somebody else is shown, not overwritten); and its versions, with a new
 * one scanned in.
 */
export function DocumentDetail(props: { id: string }) {
  const { id } = props;
  const { t } = useTranslation();
  const router = useRouter();
  const { withToken, offline, who } = useVault();
  const { guarded } = useStepUp();
  // The last control clears the gesture bar (0.2.0), as in Settings.
  const insets = useSafeAreaInsets();
  const essentials = useEssentials();
  const capture = useCapture();
  const lock = useLock();
  const [doc, setDoc] = useState<DocumentView | null>(null);
  const [versions, setVersions] = useState<VersionView[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [problem, setProblem] = useState<Problem>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  const [warning, setWarning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const warn = useCallback((text: string) => setNotice({ tone: 'warn', text }), []);

  const kept = essentials.items.find((i) => i.id === id) ?? null;
  const shown = doc ?? kept?.document ?? null;
  // A teen changes only their own; the vault refuses the rest.
  const mine = !!who && shown?.owner_member_id === who.member_id;
  const mayChange = !!who && can(who.role, 'document.edit') && (who.role !== 'teen' || mine);
  const renewing = capture.queue.some((i) => i.kind === 'version' && i.target === id);
  const mayAddVersion = !!who && can(who.role, 'document.add') && (who.role !== 'teen' || mine) && !renewing;

  const load = useCallback(async () => {
    try {
      const [d, v, m] = await withToken((a, token) =>
        Promise.all([a.document(token, id), a.versions(token, id), a.members(token).catch(() => ({ items: [] }))]),
      );
      setDoc(d);
      setVersions(v.items);
      setMembers(m.items);
      setProblem(null);
    } catch (err) {
      if (err instanceof ApiRequestError && (err.status === 404 || err.code === 'not_found')) setProblem('not_found');
      else if (err instanceof NetworkError) setProblem('offline');
    }
  }, [withToken, id]);

  useEffect(() => {
    // Loaded on arrival, again when the connection returns and when the
    // vault takes a capture; the state is set after the requests answer.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, offline, capture.delivered]);

  const latest = latestOf(versions);
  /**
   * The copy kept on the phone, when it is the current one (or there is no
   * way to know better, offline): from there, asking nothing. The store
   * itself is asked, as it may still be opening.
   */
  const keptIsCurrent = async () => {
    const kept = await essentials.keptVersion(id);
    return !!kept && (offline || !latest || latest.id === kept);
  };

  // Show mode never asks anybody to confirm it is them: for a copy not kept
  // here, the pages are confirmed and fetched first, and handed over.
  const showIt = async () => {
    setNotice(null);
    if (await keptIsCurrent()) {
      router.push({ pathname: '/show/[id]', params: { id } });
      return;
    }
    if (offline) return warn(t('document.needsConnection'));
    setPreparing(true);
    try {
      const copy = await openOnline(withToken, guarded, id);
      if (copy === null) return warn(t('document.pageFailed'));
      if (copy === 'unconfirmed') return warn(t('document.notConfirmed'));
      const uris: string[] = [];
      for (let n = 1; n <= copy.pages; n += 1) {
        const uri = await copy.page(n);
        if (uri === null) return warn(t('document.notConfirmed'));
        uris.push(uri);
      }
      holdForShow(id, { ...copy, page: async (n) => uris[n - 1] ?? null });
      router.push({ pathname: '/show/[id]', params: { id, online: '1' } });
    } catch (err) {
      warn(err instanceof NetworkError ? t('document.needsConnection') : t('document.pageFailed'));
    } finally {
      setPreparing(false);
    }
  };
  const pages = async () =>
    router.push({ pathname: '/essential/[id]', params: (await keptIsCurrent()) ? { id } : { id, online: '1' } });

  const setEssential = async (value: boolean) => {
    if (!doc || toggling) return;
    setNotice(null);
    if (offline) return warn(t('document.needsConnection'));
    setToggling(true);
    try {
      // Turning Essential off takes a check away, so a vault of 0.5.3 or
      // later asks who it is first; not confirmed, nothing changes.
      const saved = await guarded((a, token) => a.updateDocument(token, id, { is_essential: value }, doc.etag));
      if (saved) setDoc(saved);
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 409) {
        // Changed meanwhile by somebody else: theirs is shown, not overwritten.
        warn(t('document.conflict'));
        await load();
      } else if (err instanceof NetworkError) warn(t('document.needsConnection'));
      else warn(wordsFor(err, t, 'document.failed'));
    } finally {
      setToggling(false);
    }
  };

  const doSave = async () => {
    if (!latest) return;
    setWarning(false);
    setSaving(true);
    setNotice(null);
    try {
      const res = await guarded((a, token) => a.content(token, latest.id));
      if (!res) return; // not confirmed: nothing done
      await saveCopy(new Uint8Array(await res.arrayBuffer()), latest.filename, latest.mime, { away: lock.away });
      // Warned once a copy has really gone out, not before.
      markWarnedAboutCopies();
    } catch (err) {
      warn(err instanceof NetworkError ? t('document.needsConnection') : t('document.saveFailed'));
    } finally {
      setSaving(false);
    }
  };
  const save = () => {
    setNotice(null);
    // Nothing to save from here without the vault: said, and the warning kept for when there is.
    if (offline || !latest) return warn(t('document.needsConnection'));
    if (!warnedAboutCopies()) setWarning(true);
    else void doSave();
  };

  const addVersion = async () => {
    setNotice(null);
    const outcome = await capture.renew(id);
    if (outcome === 'card') router.push('/capture');
    else setNotice(renewWords(outcome, t));
  };

  if (!shown) {
    return (
      <View style={styles.page} testID="document">
        {problem === 'not_found' ? <Notice tone="warn">{t('document.notFound')}</Notice> : null}
        {problem === 'offline' ? (
          <Notice tone="warn">
            <Text>{t('document.offline')}</Text>
            <Button kind="quiet" label={t('document.tryAgain')} onPress={() => void load()} testID="document-retry" />
          </Notice>
        ) : null}
      </View>
    );
  }

  const owner = members.find((m) => m.id === shown.owner_member_id);
  const facts: [string, string | null][] = [
    [t('document.owner'), owner?.display_name ?? null],
    [t('document.issuedBy'), shown.issued_by ?? null],
    [t('document.issued'), shown.issued ? formatDate(shown.issued) : null],
    [t('document.expires'), shown.expires ? formatDate(shown.expires) : null],
  ];
  const primaryIsShow = shown.is_essential;

  return (
    <ScrollView
      testID="document"
      contentContainerStyle={[styles.page, { paddingBottom: 20 + insets.bottom }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refreshNow()} />}
    >
      <Text variant="hero">{shown.title ?? t('document.untitled')}</Text>
      <StatusLine status={shown.status} />
      <View style={styles.chip} testID="document-visibility">
        <Text variant="secondary" weight="600">
          {t(`document.visibility_${shown.visibility}`)}
        </Text>
      </View>
      {problem === 'offline' || offline ? (
        <Notice tone="warn" testID="document-offline">
          {t('document.offline')}
        </Notice>
      ) : null}
      {notice ? (
        <Notice tone={notice.tone} testID="document-notice">
          {notice.text}
        </Notice>
      ) : null}

      {primaryIsShow ? (
        <Button testID="document-show" label={t('document.show')} busy={preparing} onPress={() => void showIt()} />
      ) : (
        <Button testID="document-save" label={t('document.saveCopy')} busy={saving} onPress={save} />
      )}
      <Button testID="document-pages" kind="quiet" label={t('document.showPages')} onPress={() => void pages()} />
      {primaryIsShow ? (
        <Button testID="document-save" kind="quiet" label={t('document.saveCopy')} busy={saving} onPress={save} />
      ) : null}
      {warning ? (
        <Notice tone="warn" announce={t('document.saveWarning')}>
          <Text testID="document-save-warning">{t('document.saveWarning')}</Text>
          <Button testID="document-save-anyway" label={t('document.saveAnyway')} onPress={() => void doSave()} />
          <Button kind="quiet" label={t('document.saveCancel')} onPress={() => setWarning(false)} />
        </Notice>
      ) : null}

      <Text variant="screen">{t('document.facts')}</Text>
      {facts
        .filter(([, value]) => value)
        .map(([label, value]) => (
          <View key={label} style={styles.fact}>
            <Text tone="soft" variant="secondary">
              {label}
            </Text>
            <Text>{value}</Text>
          </View>
        ))}

      {mayChange && doc ? (
        <View style={styles.switchRow}>
          <View style={styles.flex}>
            <Text weight="600">{t('document.essential')}</Text>
            <Text tone="soft" variant="secondary">
              {t('document.essentialHint')}
            </Text>
          </View>
          <Switch
            testID="document-essential"
            accessibilityLabel={t('document.essential')}
            value={doc.is_essential}
            disabled={offline || toggling}
            onValueChange={(v) => void setEssential(v)}
            trackColor={{ true: colours.accent, false: colours.border }}
          />
        </View>
      ) : null}

      <Text variant="screen">{t('document.versions')}</Text>
      {[...versions]
        .sort((x, y) => y.version_no - x.version_no)
        .map((v) => (
          <View key={v.id} style={styles.fact} testID={`version-${v.version_no}`}>
            <Text weight="600">
              {v.filename}
              {v.id === latest?.id ? ` · ${t('document.current')}` : ''}
            </Text>
            <Text tone="soft" variant="secondary">
              {t('document.versionAdded', { when: whenWords(v.uploaded_at) })}
            </Text>
          </View>
        ))}
      {mayAddVersion && doc ? (
        <Button
          testID="document-add-version"
          kind="quiet"
          label={t('document.addVersion')}
          onPress={() => void addVersion()}
        />
      ) : null}
    </ScrollView>
  );

  async function refreshNow() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }
}

const styles = StyleSheet.create({
  page: { padding: 20, gap: 12 },
  chip: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: colours.accentSoft,
  },
  fact: { gap: 2 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56 },
  flex: { flex: 1 },
});
