import { can, radii, type NoteSummary } from '@fdv/shared';
import { useRouter } from 'expo-router';
import { History, List, NotebookText, Plus, Rows3, StickyNote, Trash2, type LucideIcon } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useDocumentMenu } from '../../documents/menu';
import { noteListName } from '../../documents/note-write';
import { on } from '../../state/events';
import { dayWords, useFamilyZone } from '../../state/family-time';
import { useVault } from '../../state/vault';
import { readPrefs, writePrefs } from '../../platform/prefs';
import { Button, Field, Notice, Text } from '../../ui';
import { ConfirmBody } from '../../ui/confirm';
import { Sheet } from '../../ui/sheet';
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
 * a collection; New note is a small + beside the title.
 *
 * Later that day: three ways to lay them out, one button going round them
 * — Sticky (squares, two to a row, the ⋯ on each one's corner), List (each
 * name on one line, cut with …), Detailed (as before) — remembered on this
 * phone; and what was looked for, remembered on this phone for each
 * person, behind the clock beside the box, with a way to forget it all.
 */

/** The layouts, in the order the button goes round them. */
export const NOTE_LAYOUTS = ['sticky', 'list', 'detailed'] as const;
export type NoteLayout = (typeof NOTE_LAYOUTS)[number];
const LAYOUT_ICON: Record<NoteLayout, LucideIcon> = { sticky: StickyNote, list: List, detailed: Rows3 };
const LAYOUT_PREF = 'notes-layout';
/** How many searches are remembered: the newest first. */
export const HISTORY_MAX = 15;
const historyPref = (who: string) => `notes-search-history.${who}`;

/** A search remembered: the newest first, each once whatever its case, at most HISTORY_MAX. */
export function remembered(history: readonly string[], words: string): string[] {
  const w = words.trim();
  if (!w) return [...history];
  return [w, ...history.filter((h) => h.toLowerCase() !== w.toLowerCase())].slice(0, HISTORY_MAX);
}
export default function NotesScreen() {
  const styles = useStyles(makeStyles);
  const { t } = useTranslation();
  const router = useRouter();
  const { withToken, offline, who } = useVault();
  const colours = useColours();
  const [q, setQ] = useState('');
  const [items, setItems] = useState<NoteSummary[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [again, setAgain] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const mayAdd = !!who && can(who.role, 'document.add');
  const { vault } = useVault();
  const [layout, setLayout] = useState<NoteLayout>(() => {
    const kept = readPrefs<string>(LAYOUT_PREF, 'detailed');
    return (NOTE_LAYOUTS as readonly string[]).includes(kept) ? (kept as NoteLayout) : 'detailed';
  });
  const nextLayout = NOTE_LAYOUTS[(NOTE_LAYOUTS.indexOf(layout) + 1) % NOTE_LAYOUTS.length] as NoteLayout;
  const cycle = () => {
    setLayout(nextLayout);
    writePrefs(LAYOUT_PREF, nextLayout);
  };
  // What was looked for, this person's on this phone (kept apart for each vault and person).
  const whose = vault && who ? `${vault.origin}|${who.member_id}` : null;
  const [history, setHistory] = useState<string[]>(() => (whose ? readPrefs<string[]>(historyPref(whose), []) : []));
  const [historyOpen, setHistoryOpen] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const remember = useCallback(
    (words: string) => {
      if (!whose || !words.trim()) return;
      setHistory((h) => {
        const next = remembered(h, words);
        writePrefs(historyPref(whose), next);
        return next;
      });
    },
    [whose],
  );

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
    <SafeAreaView style={styles.safe} edges={[]}>
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
            <IconButton
              testID="notes-layout"
              label={t('notesList.layoutNow', { now: t(`notesList.layout_${layout}`), next: t(`notesList.layout_${nextLayout}`) })}
              icon={LAYOUT_ICON[layout]}
              onPress={cycle}
            />
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
          <View style={styles.findRow}>
            <View style={styles.flex}>
              <Field
                label={t('notesList.find')}
                value={q}
                onChangeText={setQ}
                autoCapitalize="none"
                returnKeyType="search"
                onSubmitEditing={() => remember(q)}
                onBlur={() => remember(q)}
                clear={{ label: t('common.clearSearch'), onClear: () => setQ('') }}
                testID="notes-find"
              />
            </View>
            <IconButton
              testID="notes-history"
              label={t('notesList.history')}
              icon={History}
              onPress={() => {
                remember(q);
                setForgetting(false);
                setHistoryOpen(true);
              }}
            />
          </View>
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
      // Two to a row as sticky notes; one otherwise. A new column count is a new list.
      key={layout === 'sticky' ? 'sticky' : 'rows'}
      numColumns={layout === 'sticky' ? 2 : 1}
      {...(layout === 'sticky' ? { columnWrapperStyle: styles.stickyRow } : {})}
      renderItem={({ item }) => (
        <NoteRow
          note={item}
          layout={layout}
          onPress={() => router.push({ pathname: '/document/[id]', params: { id: item.id } })}
        />
      )}
    />
    <Sheet visible={historyOpen} onClose={() => setHistoryOpen(false)} outside testID="notes-history-sheet">
      {forgetting ? (
        <ConfirmBody
          title={t('notesList.forgetTitle')}
          words={t('notesList.forgetWords')}
          icon={Trash2}
          confirmLabel={t('notesList.forgetYes')}
          busy={false}
          onConfirm={() => {
            if (whose) writePrefs(historyPref(whose), []);
            setHistory([]);
            setForgetting(false);
          }}
          onCancel={() => setForgetting(false)}
          confirmID="notes-history-forget-yes"
          cancelID="notes-history-forget-cancel"
        />
      ) : (
        <View style={styles.history}>
          <Text variant="screen">{t('notesList.history')}</Text>
          {history.length === 0 ? (
            <Text tone="soft" testID="notes-history-none">
              {t('notesList.historyNone')}
            </Text>
          ) : (
            history.map((h, i) => (
              <Pressable
                key={h}
                testID={`notes-history-${i}`}
                accessibilityRole="button"
                accessibilityLabel={t('notesList.historyAgain', { words: h })}
                onPress={() => {
                  setQ(h);
                  remember(h);
                  setHistoryOpen(false);
                }}
                style={({ pressed }) => [styles.historyRow, pressed ? styles.pressed : null]}
              >
                <History color={colours.inkSoft} size={18} accessibilityElementsHidden importantForAccessibility="no" />
                <Text style={styles.flex} numberOfLines={1}>
                  {h}
                </Text>
              </Pressable>
            ))
          )}
          {history.length > 0 ? (
            <Button
              kind="quiet"
              label={t('notesList.forget')}
              onPress={() => setForgetting(true)}
              testID="notes-history-forget"
            />
          ) : null}
          <Button kind="quiet" label={t('common.cancel')} onPress={() => setHistoryOpen(false)} testID="notes-history-close" />
        </View>
      )}
    </Sheet>
    </SafeAreaView>
  );
}

function NoteRow(props: { note: NoteSummary; layout: NoteLayout; onPress: () => void }) {
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
  if (props.layout === 'sticky') {
    // A square, its name and as much of its words as fit; the ⋯ on its corner.
    const words = n.title?.trim() ? n.preview.trim() : '';
    return (
      <View style={styles.sticky}>
        <Pressable
          testID={`note-${n.id}`}
          accessibilityRole="button"
          accessibilityLabel={[name, words, line].filter(Boolean).join('. ')}
          onPress={props.onPress}
          onLongPress={menu.open}
          style={({ pressed }) => [styles.stickyMain, pressed ? styles.pressed : null]}
        >
          <Text weight="700" numberOfLines={2} style={styles.stickyName}>
            {name}
          </Text>
          {words ? (
            <Text variant="secondary" tone="soft" numberOfLines={5} testID={`note-preview-${n.id}`}>
              {words}
            </Text>
          ) : null}
        </Pressable>
        <View style={styles.stickyMenu}>{menu.button}</View>
        {menu.sheet}
      </View>
    );
  }
  if (props.layout === 'list') {
    // Its name on one line, cut with … where it does not fit; nothing else.
    return (
      <View style={styles.row}>
        <Pressable
          testID={`note-${n.id}`}
          accessibilityRole="button"
          accessibilityLabel={name}
          onPress={props.onPress}
          onLongPress={menu.open}
          style={({ pressed }) => [styles.listMain, pressed ? styles.pressed : null]}
        >
          <NotebookText color={colours.accent} size={18} accessibilityElementsHidden importantForAccessibility="no" />
          <Text weight="600" numberOfLines={1} style={styles.flex} testID={`note-name-${n.id}`}>
            {name}
          </Text>
        </Pressable>
        {menu.button}
        {menu.sheet}
      </View>
    );
  }
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
    findRow: { flexDirection: 'row', alignItems: 'flex-end', gap: sp(4) },
    listMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: sp(10), paddingHorizontal: sp(12), minHeight: 48 },
    stickyRow: { gap: sp(10) },
    sticky: {
      flex: 1,
      aspectRatio: 1,
      backgroundColor: colours.accentSoft,
      borderRadius: radii.l,
      borderWidth: 1,
      borderColor: colours.border,
      overflow: 'hidden',
    },
    stickyMain: { flex: 1, minHeight: 120, padding: sp(12), gap: sp(6) },
    // Room on the right of its name for the ⋯ in the corner.
    stickyName: { paddingRight: 40 },
    stickyMenu: { position: 'absolute', top: 0, right: 0 },
    history: { gap: sp(10) },
    historyRow: { flexDirection: 'row', alignItems: 'center', gap: sp(10), minHeight: 44 },
  });
