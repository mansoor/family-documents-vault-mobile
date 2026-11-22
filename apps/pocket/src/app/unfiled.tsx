import type { DocumentView } from '@fdv/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { DocumentRow, rowPlace } from '../documents/row';
import { wordsFor } from '../errors/words';
import { on } from '../state/events';
import { useVault } from '../state/vault';
import { Button, Notice, Text } from '../ui';
import { sp } from '../ui/space';
import { LoadFailed, loadFailure, Placeholder } from '../ui/states';
import { useStyles, type Palette } from '../ui/theme';

/** A page of them at a time, as the web asks. */
const PAGE = 50;

/**
 * The documents none of the person's shown folders hold (a vault of 19 Nov
 * 2026, GET /cabinet/unfiled), opened from My cabinet's "2 aren't in any
 * folder": those with no topic or kind yet, those only a hidden folder
 * holds, and those a cabinet arranged by hand asks for nowhere — newest
 * first, a page at a time, each opening as any document does.
 */
export default function UnfiledScreen() {
  const styles = useStyles(makeStyles);
  const { t } = useTranslation();
  const { withToken, offline, api } = useVault();
  const [items, setItems] = useState<DocumentView[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Each first page asked for is counted: a late answer to an earlier one is dropped.
  const asking = useRef(0);

  const load = useCallback(async () => {
    const n = ++asking.current;
    try {
      const page = await withToken((a, tk) => {
        setToken(tk);
        return a.cabinetUnfiled(tk, { limit: PAGE });
      });
      if (n !== asking.current) return;
      setItems(page.items);
      setNext(page.next_cursor);
      setFailed(null);
    } catch (err) {
      if (n === asking.current) setFailed(loadFailure('unfiled', err, t));
    } finally {
      if (n === asking.current) setRefreshing(false);
    }
  }, [withToken, t]);

  useEffect(() => {
    // Asked on arrival and when the connection returns; set once the vault answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, offline]);
  // Filed, changed or moved to the Trash meanwhile: asked again.
  useEffect(() => on('documentChanged', () => void load()), [load]);

  const more = async () => {
    if (!next || busy) return;
    const n = asking.current;
    setBusy(true);
    setProblem(null);
    try {
      const page = await withToken((a, tk) => a.cabinetUnfiled(tk, { limit: PAGE, cursor: next }));
      if (n !== asking.current) return;
      setItems((had) => [...(had ?? []), ...page.items.filter((d) => !(had ?? []).some((x) => x.id === d.id))]);
      setNext(page.next_cursor);
    } catch (err) {
      if (n === asking.current) setProblem(wordsFor(err, t));
    } finally {
      setBusy(false);
    }
  };

  const count = items?.length ?? 0;
  return (
    <FlatList
      testID="unfiled"
      contentContainerStyle={styles.page}
      data={items ?? []}
      keyExtractor={(d) => d.id}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load();
          }}
        />
      }
      ListHeaderComponent={
        <View style={styles.header}>
          <Text variant="hero">{t('cabinet.unfiledTitle')}</Text>
          <Text tone="soft">{t('cabinet.unfiledLede')}</Text>
          {offline && !items ? (
            <Notice tone="warn" testID="unfiled-offline">
              {t('cabinet.unfiledNeedsConnection')}
            </Notice>
          ) : null}
          {failed ? <LoadFailed words={failed} onRetry={() => void load()} /> : null}
          {!items && !failed && !offline ? <Placeholder rows={3} /> : null}
          {items && items.length === 0 ? (
            <Text tone="soft" testID="unfiled-none">
              {t('cabinet.unfiledNone')}
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
          place={rowPlace(index, count)}
          thumb={
            api && token && item.latest_version_id ? { uri: api.thumbnailUrl(item.latest_version_id), token } : null
          }
        />
      )}
      ListFooterComponent={
        <View style={styles.footer}>
          {problem ? (
            <Notice tone="warn" testID="unfiled-problem">
              {problem}
            </Notice>
          ) : null}
          {next ? (
            <Button kind="quiet" label={t('cabinet.showMore')} busy={busy} onPress={() => void more()} testID="unfiled-more" />
          ) : null}
        </View>
      }
    />
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    page: { padding: sp(20), backgroundColor: colours.bg },
    header: { gap: sp(12), marginBottom: sp(12) },
    footer: { gap: sp(12), marginTop: sp(12) },
  });
