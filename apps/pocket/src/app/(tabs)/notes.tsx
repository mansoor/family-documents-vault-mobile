import { can, radii, type NoteSummary } from '@fdv/shared';
import { useRouter } from 'expo-router';
import { NotebookText, Plus } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useDocumentMenu } from '../../documents/menu';
import { noteListName } from '../../documents/note-write';
import { on } from '../../state/events';
import { dayWords, useFamilyZone } from '../../state/family-time';
import { useVault } from '../../state/vault';
import { Field, Notice, Text } from '../../ui';
import { BellButton } from '../../ui/bell';
import { IconButton } from '../../ui/icon-button';
import { sp } from '../../ui/space';
import { LoadFailed, loadFailure, Placeholder } from '../../ui/states';
import { useColours, useStyles, type Palette } from '../../ui/theme';

/**
 * Notes (P9; a vault of 0.9.0, `features.notes`; a tab since R3, the
 * owner's choice of 10 Nov 2026): the person's notes kept
 * on their own, newest words first, each with its first words, when its
 * words last changed, and who can see it when that is not the whole family.
 * Find in notes asks the vault. A note opens as any document does, its
 * words on its page; the + beside the bell writes one.
 *
 * The owner's tidy-up of 11 Nov 2026: a row shows only the first line of
 * its words (the rest is on its page), and has a ⋯ — Edit, Share, Add to
 * a collection; New note is a small + beside the bell, not a wide button.
 */
export default function NotesScreen() {
  const styles = useStyles(makeStyles);
  const { t } = useTranslation();
  const router = useRouter();
  const { withToken, offline, who } = useVault();
  const [q, setQ] = useState('');
  const [items, setItems] = useState<NoteSummary[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [again, setAgain] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const mayAdd = !!who && can(who.role, 'document.add');

  useEffect(() => {
    let stopped = false;
    const words = q.trim();
    // Typed words wait a moment, so each letter is not an asking of its own.
    const timer = setTimeout(
      () => {
        withToken((a, tk) => a.notes(tk, words ? { q: words } : {}))
          .then((r) => {
            if (stopped) return;
            setItems(r.items);
            setTruncated(r.truncated);
            setFailed(null);
          })
          .catch((err: unknown) => {
            if (!stopped) setFailed(loadFailure('notes', err, t));
          })
          .finally(() => {
            if (!stopped) setRefreshing(false);
          });
      },
      words ? 300 : 0,
    );
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [q, withToken, offline, again, t]);
  // Written, changed or moved to the Trash: asked again.
  useEffect(() => on('documentChanged', () => setAgain((n) => n + 1)), []);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
    <FlatList
      testID="notes"
      style={styles.screen}
      contentContainerStyle={styles.page}
      data={items ?? []}
      keyExtractor={(n) => n.id}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            setAgain((n) => n + 1);
          }}
        />
      }
      ListHeaderComponent={
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <Text variant="hero" style={styles.flex}>
              {t('notesList.title')}
            </Text>
            <BellButton />
            {mayAdd && !offline ? (
              <IconButton
                testID="notes-new"
                label={t('notesList.new')}
                icon={Plus}
                filled
                onPress={() => router.push('/new-note')}
              />
            ) : null}
          </View>
          <Field
            label={t('notesList.find')}
            value={q}
            onChangeText={setQ}
            autoCapitalize="none"
            returnKeyType="search"
            testID="notes-find"
          />
          {offline && !items ? (
            <Notice tone="warn" testID="notes-offline">
              {t('notesList.needsConnection')}
            </Notice>
          ) : null}
          {failed ? <LoadFailed words={failed} onRetry={() => setAgain((n) => n + 1)} /> : null}
          {!items && !failed && !offline ? <Placeholder rows={3} /> : null}
          {items && items.length === 0 ? (
            <Text tone="soft" testID="notes-none">
              {q.trim() ? t('notesList.noneMatch', { q: q.trim() }) : t('notesList.none')}
            </Text>
          ) : null}
          {truncated ? (
            <Text variant="secondary" tone="soft" testID="notes-truncated">
              {t('notesList.truncated')}
            </Text>
          ) : null}
        </View>
      }
      renderItem={({ item }) => (
        <NoteRow note={item} onPress={() => router.push({ pathname: '/document/[id]', params: { id: item.id } })} />
      )}
    />
    </SafeAreaView>
  );
}

function NoteRow(props: { note: NoteSummary; onPress: () => void }) {
  const styles = useStyles(makeStyles);
  const colours = useColours();
  const { t } = useTranslation();
  const zone = useFamilyZone();
  const n = props.note;
  const name = noteListName(n, t('notesList.untitled'));
  const when = n.notes_updated_at ? t('notesList.changed', { when: dayWords(n.notes_updated_at, zone) }) : null;
  const line = [when, n.visibility !== 'household' ? t(`document.visibility_${n.visibility}`) : null]
    .filter(Boolean)
    .join(' · ');
  // The first words, unless they are what names it: one line of them, the rest on its page.
  const preview = n.title?.trim() ? (n.preview.trim().split('\n')[0] ?? '') : '';
  const menu = useDocumentMenu({ id: n.id, title: name, edit: true });
  return (
    <View style={styles.row}>
    <Pressable
      testID={`note-${n.id}`}
      accessibilityRole="button"
      accessibilityLabel={[name, preview, line].filter(Boolean).join('. ')}
      onPress={props.onPress}
      onLongPress={menu.open}
      style={({ pressed }) => [styles.main, pressed ? styles.pressed : null]}
    >
      <View style={styles.icon}>
        <NotebookText color={colours.accent} size={22} accessibilityElementsHidden importantForAccessibility="no" />
      </View>
      <View style={styles.words}>
        <Text weight="600" numberOfLines={2}>
          {name}
        </Text>
        {preview ? (
          <Text variant="secondary" tone="soft" numberOfLines={1} testID={`note-preview-${n.id}`}>
            {preview}
          </Text>
        ) : null}
        {line ? (
          <Text variant="small" tone="muted">
            {line}
          </Text>
        ) : null}
      </View>
    </Pressable>
    {menu.button}
    {menu.sheet}
    </View>
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colours.bg },
    screen: { backgroundColor: colours.bg },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: sp(8) },
    flex: { flex: 1 },
    page: { padding: sp(20), gap: sp(10) },
    header: { gap: sp(12) },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colours.surface,
      borderRadius: radii.l,
      borderWidth: 1,
      borderColor: colours.border,
      paddingRight: sp(4),
    },
    main: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: sp(12), padding: sp(12), minHeight: 52 },
    pressed: { opacity: 0.8 },
    icon: {
      width: 40,
      height: 40,
      borderRadius: radii.pill,
      backgroundColor: colours.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    words: { flex: 1, gap: sp(4) },
  });
