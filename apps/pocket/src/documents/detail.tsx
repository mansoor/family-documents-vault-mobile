import { ApiRequestError, NetworkError } from '@fdv/client';
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
import { useCapture } from '../state/capture';
import { useEssentials } from '../state/essentials';
import { useStepUp } from '../state/step-up';
import { useVault } from '../state/vault';
import { Button, Card, Notice, StatusLine, Text } from '../ui';
import { latestOf } from './online';
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
  const essentials = useEssentials();
  const capture = useCapture();
  const [doc, setDoc] = useState<DocumentView | null>(null);
  const [versions, setVersions] = useState<VersionView[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [problem, setProblem] = useState<Problem>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [warning, setWarning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const kept = essentials.items.find((i) => i.id === id) ?? null;
  const shown = doc ?? kept?.document ?? null;
  const canEdit = who ? can(who.role, 'document.edit') : false;
  const canAdd = who ? can(who.role, 'document.add') : false;

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
    // Loaded on arrival; the state is set after the requests answer.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Kept on the phone: from there, asking nothing — the store is asked
  // (it may still be opening). Otherwise from the vault.
  const where = async () => ((await essentials.isKept(id)) ? { id } : { id, online: '1' });
  const showIt = async () => router.push({ pathname: '/show/[id]', params: await where() });
  const pages = async () => router.push({ pathname: '/essential/[id]', params: await where() });

  const setEssential = async (value: boolean) => {
    if (!doc) return;
    setNotice(null);
    if (offline) {
      setNotice(t('document.needsConnection'));
      return;
    }
    try {
      setDoc(await withToken((a, token) => a.updateDocument(token, id, { is_essential: value }, doc.etag)));
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 409) {
        // Changed meanwhile by somebody else: theirs is shown, not overwritten.
        setNotice(t('document.conflict'));
        await load();
      } else if (err instanceof NetworkError) setNotice(t('document.needsConnection'));
    }
  };

  const latest = latestOf(versions);
  const doSave = async () => {
    if (!latest) return;
    setWarning(false);
    setSaving(true);
    setNotice(null);
    try {
      const res = await guarded((a, token) => a.content(token, latest.id));
      if (!res) return; // not confirmed: nothing done
      await saveCopy(new Uint8Array(await res.arrayBuffer()), latest.filename, latest.mime);
    } catch (err) {
      setNotice(err instanceof NetworkError ? t('document.needsConnection') : t('document.saveFailed'));
    } finally {
      setSaving(false);
    }
  };
  const save = () => {
    // Said once: the copy is outside the vault.
    if (!warnedAboutCopies()) setWarning(true);
    else void doSave();
  };

  const addVersion = async () => {
    const outcome = await capture.renew(id);
    if (outcome === 'card') router.push('/capture');
  };

  if (!shown) {
    return (
      <View style={styles.page} testID="document">
        {problem === 'not_found' ? <Notice tone="warn">{t('document.notFound')}</Notice> : null}
        {problem === 'offline' ? <Notice tone="warn">{t('document.offline')}</Notice> : null}
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
      contentContainerStyle={styles.page}
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
        <Notice tone="warn" testID="document-notice">
          {notice}
        </Notice>
      ) : null}

      {primaryIsShow ? (
        <Button testID="document-show" label={t('document.show')} onPress={() => void showIt()} />
      ) : (
        <Button testID="document-save" label={t('document.saveCopy')} busy={saving} onPress={save} />
      )}
      <Button testID="document-pages" kind="quiet" label={t('document.showPages')} onPress={() => void pages()} />
      {primaryIsShow ? (
        <Button testID="document-save" kind="quiet" label={t('document.saveCopy')} busy={saving} onPress={save} />
      ) : null}
      {warning ? (
        <Card>
          <Text testID="document-save-warning">{t('document.saveWarning')}</Text>
          <Button
            testID="document-save-anyway"
            label={t('document.saveAnyway')}
            onPress={() => {
              markWarnedAboutCopies();
              void doSave();
            }}
          />
          <Button kind="quiet" label={t('document.saveCancel')} onPress={() => setWarning(false)} />
        </Card>
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

      {canEdit && doc ? (
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
            disabled={offline}
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
      {canAdd && doc ? (
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
