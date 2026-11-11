import { ApiRequestError } from '@fdv/client';
import { documentName, sharedOutsideWords, type CollectionDetail, type CollectionItemView } from '@fdv/shared';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Pencil, Trash2 } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { AddDocuments } from '../../collections/add';
import { CollectionForm } from '../../collections/collection-form';
import { ConfirmSheet } from '../../ui/confirm';
import { IconButton } from '../../ui/icon-button';
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
 */
export default function CollectionScreen() {
  const styles = useStyles(makeStyles);
  const colours = useColours();
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { withToken, offline, who, api } = useVault();
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
            void load().finally(() => setRefreshing(false));
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
                  {mayDelete && !offline ? (
                    <IconButton
                      testID="collection-delete"
                      label={t('collectionForm.delete', { name: detail.name })}
                      icon={Trash2}
                      onPress={() => {
                        setDeleteProblem(null);
                        setDeleting(true);
                      }}
                    />
                  ) : null}
                </View>
              ),
            }}
          />
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
          <Text variant="secondary" tone="soft" testID="collection-line">
            {[t('collections.documents', { count: detail.item_count }), t('collection.forWhom', { audience })].join(
              ' · ',
            )}
          </Text>
          {detail.shared_outside ? (
            <Notice tone="warn" testID="collection-shared">
              {sharedOutsideWords(detail.shared_outside, who?.role ?? null)}
            </Notice>
          ) : null}
          <Text variant="secondary" tone="muted">
            {t('collection.neverWidens')}
          </Text>
          {said ? (
            <Notice tone={said.tone} testID="collection-said">
              {said.text}
            </Notice>
          ) : null}
          {failed ? <LoadFailed words={failed} onRetry={() => void load()} /> : null}
          {mayChange && !offline ? (
            <Button
              testID="collection-add"
              kind="quiet"
              label={t('collection.add')}
              onPress={() => {
                setSaid(null);
                setAdding(true);
              }}
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
  });
