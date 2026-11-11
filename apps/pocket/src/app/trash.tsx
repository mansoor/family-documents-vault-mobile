import { documentName, NOTE_KIND, radii } from '@fdv/shared';
import { FileText, NotebookText } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { wordsFor } from '../errors/words';
import { emit, on } from '../state/events';
import { exactWords, useFamilyZone } from '../state/family-time';
import { useVault } from '../state/vault';
import { Button, Notice, Text } from '../ui';
import { feel } from '../ui/feel';
import { sp } from '../ui/space';
import { LoadFailed, loadFailure, Placeholder } from '../ui/states';
import { useColours, useStyles, type Palette } from '../ui/theme';

/** One thing in the Trash: a document or a note, and when it went there. */
interface Trashed {
  id: string;
  name: string;
  note: boolean;
  at: string | null;
}

/**
 * The Trash (the owner's gaps review, 11 Nov 2026: the phone could move
 * things to the Trash, never bring them back). What the person moved there,
 * and what others did that they may see, newest first — documents, and
 * notes where the vault keeps them — each with Restore, which puts it back
 * where it was. Removing anything for good stays in the browser.
 */
export default function TrashScreen() {
  const styles = useStyles(makeStyles);
  const colours = useColours();
  const { t } = useTranslation();
  const zone = useFamilyZone();
  const { withToken, offline, caps } = useVault();
  const [items, setItems] = useState<Trashed[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  const notesOn = caps?.features.notes === true;

  const load = useCallback(async () => {
    try {
      const [d, n] = await withToken((a, tk) =>
        Promise.all([
          a.documents(tk, { deleted: 'true', limit: 200 }),
          notesOn ? a.notes(tk, { deleted: 'true' }) : Promise.resolve({ items: [], truncated: false }),
        ]),
      );
      const untitled = t('document.untitled');
      const all: Trashed[] = [
        ...d.items
          .filter((x) => x.type_key !== NOTE_KIND)
          .map((x) => ({ id: x.id, name: documentName(x, untitled), note: false, at: x.deleted_at ?? null })),
        ...n.items.map((x) => ({
          id: x.id,
          name: x.title?.trim() || x.preview.trim() || untitled,
          note: true,
          at: x.deleted_at ?? null,
        })),
      ];
      all.sort((x, y) => (y.at ?? '').localeCompare(x.at ?? ''));
      setItems(all);
      setFailed(null);
    } catch (err) {
      setFailed(loadFailure('trash', err, t));
    }
  }, [withToken, notesOn, t]);

  useEffect(() => {
    // Loaded on arrival and when the connection returns; set once the vault answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, offline]);
  // Something moved to the Trash meanwhile, from a page.
  useEffect(() => on('documentChanged', () => void load()), [load]);

  const restore = async (item: Trashed) => {
    if (busy) return;
    setBusy(item.id);
    setSaid(null);
    try {
      await withToken((a, tk) => a.restoreDocument(tk, item.id));
      feel('done');
      setItems((xs) => xs?.filter((x) => x.id !== item.id) ?? xs);
      setSaid({ tone: 'ok', text: t('trashList.restored', { title: item.name }) });
      emit('documentChanged', item.id);
    } catch (err) {
      setSaid({ tone: 'warn', text: wordsFor(err, t) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <FlatList
      testID="trash"
      style={styles.screen}
      contentContainerStyle={styles.page}
      data={items ?? []}
      keyExtractor={(x) => x.id}
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
            {t('trashList.words')}
          </Text>
          {offline ? (
            <Notice tone="warn" testID="trash-offline">
              {t('trashList.needsConnection')}
            </Notice>
          ) : null}
          {said ? (
            <Notice tone={said.tone} testID="trash-said">
              {said.text}
            </Notice>
          ) : null}
          {failed ? <LoadFailed words={failed} onRetry={() => void load()} /> : null}
          {!items && !failed && !offline ? <Placeholder rows={3} /> : null}
          {items && items.length === 0 ? (
            <Text tone="soft" testID="trash-empty">
              {t('trashList.empty')}
            </Text>
          ) : null}
        </View>
      }
      renderItem={({ item }) => {
        const Icon = item.note ? NotebookText : FileText;
        return (
          <View style={styles.row} testID={`trash-${item.id}`}>
            <View style={styles.icon}>
              <Icon color={colours.accent} size={18} accessibilityElementsHidden importantForAccessibility="no" />
            </View>
            <View style={styles.words}>
              <Text weight="600">{item.name}</Text>
              {item.at ? (
                <Text variant="small" tone="soft">
                  {t('trashList.when', { when: exactWords(item.at, zone) })}
                </Text>
              ) : null}
            </View>
            <Button
              size="small"
              kind="quiet"
              label={t('trashList.restore')}
              accessibilityLabel={t('trashList.restoreLabel', { title: item.name })}
              busy={busy === item.id}
              disabled={offline || (busy !== null && busy !== item.id)}
              onPress={() => void restore(item)}
              testID={`trash-restore-${item.id}`}
            />
          </View>
        );
      }}
    />
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    screen: { backgroundColor: colours.bg },
    page: { padding: sp(20), gap: sp(8) },
    header: { gap: sp(10), marginBottom: sp(4) },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: sp(10),
      padding: sp(12),
      minHeight: 56,
      borderRadius: radii.m,
      borderWidth: 1,
      borderColor: colours.border,
      backgroundColor: colours.surface,
    },
    icon: {
      width: 32,
      height: 32,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colours.accentSoft,
    },
    words: { flex: 1, gap: 2 },
  });
