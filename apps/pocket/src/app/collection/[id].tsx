import { ApiRequestError } from '@fdv/client';
import {
  can,
  documentName,
  sharedOutsideWords,
  type CollectionChecklist,
  type CollectionDetail,
  type CollectionItemView,
} from '@fdv/shared';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ellipsis, Info, Pencil, Share2, Trash2 } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { AddDocuments } from '../../collections/add';
import { checklistOffered, ChecklistPanel, keptChecklist, takeChecklistDone } from '../../collections/checklist';
import { CollectionForm } from '../../collections/collection-form';
import { ConfirmSheet } from '../../ui/confirm';
import { MenuRow } from '../../ui/menu-row';
import { Sheet } from '../../ui/sheet';
import { IconButton } from '../../ui/icon-button';
import { ShareSheet } from '../../sharing/share-sheet';
import { audienceKey, mayChangeCollection } from '../../collections/rules';
import { DocumentRow, rowPlace } from '../../documents/row';
import { wordsFor } from '../../errors/words';
import { emit, on } from '../../state/events';
import { useVault } from '../../state/vault';
import { Button, Notice, Text } from '../../ui';
import { sp } from '../../ui/space';
import { LoadFailed, loadFailure, Placeholder } from '../../ui/states';
import { useColours, useStyles, type Palette } from '../../ui/theme';

/**
 * A collection's page (P9): who it is for, whether it is shared outside the
 * family, and the documents in it the person may see, 50 at a time, in the
 * order they were put there. Its maker puts more in with Add documents and
 * takes one out with Remove from this collection in the row's ⋯. A
 * collection never widens who sees a document, and the page says so.
 * Its maker changes its name, words and audience with the pencil in the
 * header, and deletes it with the bin there, asked first (the gaps review,
 * 11 Nov 2026): its documents stay where they are.
 *
 * Where the vault has it (app 0.8.0, the vault's C1), its maker fills it
 * from a checklist — Fill from a checklist, beside Add documents — and a
 * checklist kept on it is one line under them, saying how it stands, for
 * the family who see it.
 */
export default function CollectionScreen() {
  const styles = useStyles(makeStyles);
  const colours = useColours();
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { withToken, offline, who, api, caps } = useVault();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteProblem, setDeleteProblem] = useState<string | null>(null);
  const [detail, setDetail] = useState<CollectionDetail | null>(null);
  const [items, setItems] = useState<CollectionItemView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [said, setSaid] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  // Which asking is current: an answer to an older one is let go.
  const asking = useRef(0);
  // The checklist kept on it (app 0.8.0), where the vault has them.
  const checklistOn = checklistOffered(caps, who?.role);
  const [checklist, setChecklist] = useState<CollectionChecklist | null>(null);

  const first = (d: CollectionDetail) => {
    setDetail(d);
    setItems(d.items);
    setCursor(d.next_cursor);
    setMore(d.has_more && !!d.next_cursor);
  };

  const load = useCallback(async () => {
    const n = ++asking.current;
    try {
      const d = await withToken((a, tk) => {
        setToken(tk);
        return a.getCollection(tk, id);
      });
      if (n !== asking.current) return;
      first(d);
      setFailed(null);
      setGone(false);
    } catch (err) {
      if (n !== asking.current) return;
      if (err instanceof ApiRequestError && (err.status === 404 || err.status === 403)) setGone(true);
      else setFailed(loadFailure('collection', err, t));
    }
  }, [withToken, id, t]);

  useEffect(() => {
    // Loaded on arrival and when the connection returns; set once the vault answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, offline]);
  // A document changed or moved to the Trash on its page: the first page again.
  useEffect(() => on('documentChanged', () => void load()), [load]);

  /** The checklist kept on it, matched again now; none said if it can't be read (Fill from a checklist says why). */
  const loadChecklist = useCallback(async () => {
    if (!checklistOn) return;
    try {
      setChecklist(await withToken((a, tk) => a.collectionChecklist(tk, id)));
    } catch {
      setChecklist(null);
    }
  }, [checklistOn, withToken, id]);
  useEffect(() => {
    // Set once the vault answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadChecklist();
  }, [loadChecklist, offline]);
  // Filled from its checklist, kept or cleared: the page again, and what was done said.
  useEffect(() => {
    const said = () => {
      const words = takeChecklistDone(id);
      if (words) setSaid({ tone: 'ok', text: words });
    };
    // Back from the checklist's screen after this page was let go.
    said();
    return on('checklistChanged', (changed) => {
      if (changed !== id) return;
      said();
      void load();
      void loadChecklist();
    });
  }, [id, load, loadChecklist]);

  /** The next 50; a page whose place has gone (422) starts again from the top. */
  const loadMore = async () => {
    if (!more || !cursor || loadingMore) return;
    const n = asking.current;
    setLoadingMore(true);
    try {
      const page = await withToken((a, tk) => a.getCollection(tk, id, { cursor }));
      if (n !== asking.current) return;
      setItems((had) => [...had, ...page.items]);
      setCursor(page.next_cursor);
      setMore(page.has_more && !!page.next_cursor);
    } catch (err) {
      if (n !== asking.current) return;
      if (err instanceof ApiRequestError && err.status === 422) void load();
      else setFailed(loadFailure('collection', err, t));
    } finally {
      setLoadingMore(false);
    }
  };

  const mayChange = !!detail && mayChangeCollection(who?.role, detail);
  // Deleted by its maker, whatever their role now.
  const mayDelete = !!detail && detail.mine;
  // Shared outside the family (5.19), by an owner or an adult, never an Only me collection.
  const mayShare =
    !!detail && !!who && can(who.role, 'document.share') && caps?.features.collection_shares === true && detail.audience !== 'only_me';
  const [sharing, setSharing] = useState(false);
  // The ⋯ (Share, Delete) and the ⓘ beside who it is for (the owner's tidy-up of 11 Nov 2026).
  const [menuOpen, setMenuOpen] = useState(false);
  const [about, setAbout] = useState(false);
  const hasMenu = (mayShare || mayDelete) && !offline;

  const deleteIt = async () => {
    setDeleteBusy(true);
    setDeleteProblem(null);
    try {
      await withToken((a, tk) => a.deleteCollection(tk, id));
      setDeleting(false);
      emit('collectionChanged', id);
      router.back();
    } catch (err) {
      setDeleteProblem(wordsFor(err, t));
    } finally {
      setDeleteBusy(false);
    }
  };

  const remove = (docId: string, title: string) => async (): Promise<string | null> => {
    try {
      await withToken((a, tk) => a.removeFromCollection(tk, id, docId));
    } catch (err) {
      return wordsFor(err, t);
    }
    setItems((had) => had.filter((i) => i.document.id !== docId));
    setDetail((d) => (d ? { ...d, item_count: Math.max(0, d.item_count - 1) } : d));
    setSaid({ tone: 'ok', text: t('collection.removed', { title, name: detail?.name ?? '' }) });
    emit('collectionChanged', id);
    return null;
  };

  if (!detail) {
    return (
      <View style={styles.page} testID="collection">
        {gone ? <Notice tone="warn">{t('collection.gone')}</Notice> : null}
        {failed ? <LoadFailed words={failed} onRetry={() => void load()} /> : null}
        {offline && !failed && !gone ? (
          <Notice tone="warn" testID="collection-offline">
            {t('collections.needsConnection')}
          </Notice>
        ) : null}
        {!failed && !gone && !offline ? <Placeholder rows={3} /> : null}
      </View>
    );
  }

  const audience = t(audienceKey(detail.audience));
  const kept = checklistOn ? keptChecklist(checklist) : null;
  // Filled from a checklist by its maker, online.
  const mayFill = mayChange && checklistOn && !offline;
  const fill = () => {
    setSaid(null);
    router.push({ pathname: '/checklist/[id]', params: { id: detail.id } });
  };
  return (
    <FlatList
      testID="collection"
      style={styles.screen}
      contentContainerStyle={styles.page}
      data={items}
      keyExtractor={(i) => i.document.id}
      onEndReachedThreshold={0.5}
      onEndReached={() => void loadMore()}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void Promise.all([load(), loadChecklist()]).finally(() => setRefreshing(false));
          }}
        />
      }
      ListHeaderComponent={
        <View style={styles.header}>
          <Stack.Screen
            options={{
              headerRight: () => (
                <View style={styles.headerButtons}>
                  {mayChange && !offline ? (
                    <IconButton
                      testID="collection-edit"
                      label={t('collectionForm.editTitle')}
                      icon={Pencil}
                      onPress={() => setEditing(true)}
                    />
                  ) : null}
                  {hasMenu ? (
                    <IconButton
                      testID="collection-more"
                      label={t('collection.menu', { name: detail.name })}
                      icon={Ellipsis}
                      onPress={() => setMenuOpen(true)}
                    />
                  ) : null}
                </View>
              ),
            }}
          />
          <Sheet visible={menuOpen} onClose={() => setMenuOpen(false)} outside testID="collection-more-sheet">
            <View style={styles.menu}>
              <Text variant="screen">{detail.name}</Text>
              {mayShare ? (
                <MenuRow
                  testID="collection-share"
                  icon={Share2}
                  label={t('share.menu')}
                  onPress={() => {
                    setMenuOpen(false);
                    setSharing(true);
                  }}
                />
              ) : null}
              {mayDelete ? (
                <MenuRow
                  testID="collection-delete"
                  icon={Trash2}
                  label={t('collection.deleteMenu')}
                  danger
                  onPress={() => {
                    setMenuOpen(false);
                    setDeleteProblem(null);
                    setDeleting(true);
                  }}
                />
              ) : null}
              <Button
                kind="quiet"
                label={t('common.cancel')}
                onPress={() => setMenuOpen(false)}
                testID="collection-more-cancel"
              />
            </View>
          </Sheet>
          <Sheet visible={about} onClose={() => setAbout(false)} outside testID="collection-about-sheet">
            <View style={styles.menu}>
              <Text variant="screen">{t('collection.forWhom', { audience })}</Text>
              <Text>{t('collection.neverWidens')}</Text>
              <Button kind="quiet" label={t('row.done')} onPress={() => setAbout(false)} testID="collection-about-done" />
            </View>
          </Sheet>
          {sharing ? (
            <ShareSheet target={{ kind: 'collection', id: detail.id, name: detail.name }} onClose={() => setSharing(false)} />
          ) : null}
          {editing ? (
            <CollectionForm
              editing={detail}
              onClose={() => setEditing(false)}
              onSaved={(d) => {
                setEditing(false);
                setDetail((had) => (had ? { ...had, ...d, items: had.items } : d));
                setSaid({ tone: 'ok', text: t('collectionForm.saved') });
                emit('collectionChanged', id);
              }}
            />
          ) : null}
          <ConfirmSheet
            visible={deleting}
            testID="collection-delete-question"
            icon={Trash2}
            title={t('collectionForm.deleteTitle')}
            words={t('collectionForm.deleteWords', { name: detail.name })}
            confirmLabel={t('collectionForm.deleteYes')}
            busy={deleteBusy}
            problem={deleteProblem}
            onConfirm={() => void deleteIt()}
            onCancel={() => setDeleting(false)}
            confirmID="collection-delete-yes"
            cancelID="collection-delete-cancel"
            problemID="collection-delete-problem"
          />
          <Text variant="hero">{detail.name}</Text>
          {detail.description ? <Text testID="collection-description">{detail.description}</Text> : null}
          <View style={styles.lineRow}>
            <Text variant="secondary" tone="soft" testID="collection-line" style={styles.flex}>
              {[t('collections.documents', { count: detail.item_count }), t('collection.forWhom', { audience })].join(
                ' · ',
              )}
            </Text>
            <IconButton
              testID="collection-about"
              label={t('collection.about')}
              icon={Info}
              onPress={() => setAbout(true)}
            />
          </View>
          {detail.shared_outside ? (
            <Notice tone="warn" testID="collection-shared">
              {sharedOutsideWords(detail.shared_outside, who?.role ?? null)}
            </Notice>
          ) : null}
          {said ? (
            <Notice tone={said.tone} testID="collection-said">
              {said.text}
            </Notice>
          ) : null}
          {failed ? <LoadFailed words={failed} onRetry={() => void load()} /> : null}
          {mayChange && !offline ? (
            <View style={styles.actions}>
              <View style={styles.flex}>
                <Button
                  testID="collection-add"
                  kind="quiet"
                  label={t('collection.add')}
                  onPress={() => {
                    setSaid(null);
                    setAdding(true);
                  }}
                />
              </View>
              {mayFill && !kept ? (
                <View style={styles.flex}>
                  <Button testID="collection-checklist-fill" kind="quiet" label={t('checklist.fill')} onPress={fill} />
                </View>
              ) : null}
            </View>
          ) : null}
          {kept ? (
            <ChecklistPanel
              collection={detail}
              kept={kept}
              mayFill={mayFill && kept.mine}
              onFill={fill}
              onCleared={() => setSaid({ tone: 'ok', text: t('checklist.cleared', { name: detail.name }) })}
            />
          ) : null}
          {items.length === 0 && !more ? (
            <Text tone="soft" testID="collection-empty">
              {mayChange ? t('collection.emptyYours') : t('collection.empty')}
            </Text>
          ) : null}
          {adding ? (
            <AddDocuments
              collection={detail}
              inIt={new Set(items.map((i) => i.document.id))}
              onClose={() => setAdding(false)}
              onAdded={(d, count) => {
                first(d);
                setAdding(false);
                setSaid({
                  tone: 'ok',
                  text: [t('collection.added', { count, name: d.name }), ...(d.warnings ?? [])].join(' '),
                });
                emit('collectionChanged', id);
              }}
            />
          ) : null}
        </View>
      }
      renderItem={({ item, index }) => {
        const doc = item.document;
        const title = documentName(doc, t('document.untitled'));
        return (
          <DocumentRow
            id={doc.id}
            title={doc.title}
            type_key={doc.type_key}
            note_name={doc.note_name}
            status={doc.status}
            doc={doc}
            place={rowPlace(index, items.length)}
            thumb={api && token && doc.latest_version_id ? { uri: api.thumbnailUrl(doc.latest_version_id), token } : null}
            {...(mayChange
              ? {
                  remove: {
                    onRemove: remove(doc.id, title),
                    collection: detail.name,
                    warning: detail.shared_outside ? t('collection.removeShared') : null,
                  },
                }
              : {})}
          />
        );
      }}
      ListFooterComponent={
        loadingMore ? (
          <ActivityIndicator color={colours.accent} accessibilityLabel={t('common.loading')} testID="collection-more" />
        ) : null
      }
    />
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    screen: { backgroundColor: colours.bg },
    page: { padding: sp(20) },
    headerButtons: { flexDirection: 'row', alignItems: 'center' },
    header: { gap: sp(12), marginBottom: sp(10) },
    menu: { gap: sp(10) },
    lineRow: { flexDirection: 'row', alignItems: 'center', gap: sp(4) },
    actions: { flexDirection: 'row', gap: sp(10) },
    flex: { flex: 1 },
  });
