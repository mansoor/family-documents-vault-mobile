import { ApiRequestError } from '@fdv/client';
import {
  folderQuestionWords,
  NO_ISSUER,
  NOT_SURE_YET,
  THE_HOUSEHOLD,
  type DocumentView,
  type FolderContents,
  type FolderDivider,
  type FolderFilter,
} from '@fdv/shared';
import { useLocalSearchParams } from 'expo-router';
import { ChevronDown, ChevronRight, Pin } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { DocumentRow, rowPlace } from '../documents/row';
import { on } from '../state/events';
import { useVault } from '../state/vault';
import { Button, Notice, Text } from '../ui';
import { sp } from '../ui/space';
import { LoadFailed, loadFailure, Placeholder } from '../ui/states';
import { useColours, useStyles, type Palette } from '../ui/theme';
import { dividerGroups, findNode, type DividerGroup } from './model';
import { issuerGroupsFor, useCabinet } from './use-cabinet';

/** A group's own key in what is open: never one of a divider's. */
const groupKey = (g: DividerGroup) => `group:${g.key}`;

/** How many papers are asked for at a time, behind a divider. */
export const FOLDER_PAGE = 50;

/** The papers behind one divider, as far as they have been read. */
interface Behind {
  items: DocumentView[];
  cursor: string | null;
  more: boolean;
  loading: boolean;
  failed: string | null;
}

const NOTHING_YET: Behind = { items: [], cursor: null, more: false, loading: false, failed: null };

/**
 * One folder of the person's cabinet (C5): what it holds, in a sentence;
 * the papers they pinned there first; then its dividers, newest first —
 * years by themselves, or the folder's own date ranges — each with how many
 * are behind it, opened to show them (the first with any, open already).
 * Each paper opens its own page. Arranged on the web, never here.
 *
 * Divided by levels (a vault of 0.9.0-dev.90), each divider is a leaf with
 * its steps (`path`): those of two steps go under their first step's tab
 * ("Bank statement", then "2025" and "2024" inside it), as the web shows
 * them; Everything else (`rest`) and the rest are tabs of their own. Who
 * issued it (dev.91) is said by the household's own names ("from
 * Barclays", "with no issuer given").
 *
 * A vault with dividers (0.9.0-dev.44, C2) opens the folder itself; an
 * older one with cabinets (dev.42) gives the folder's question to the
 * documents list, newest first by the date each paper is about.
 *
 * Opened from a drawer, from a folder label's code, or from a link to
 * /folder/{id}: a folder that is not in the person's own cabinet — taken
 * out, hidden, or somebody else's label — says so.
 */
export function FolderScreen() {
  const styles = useStyles(makeStyles);
  const colours = useColours();
  const { t } = useTranslation();
  // From a label printed at another address of this vault: said once, on this opening.
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>();
  const { withToken, offline, api, who } = useVault();
  const { gate, read } = useCabinet();
  const found = read?.arranged ? findNode(read.arranged.cabinets, id) : null;
  const folder = found?.kind === 'folder' ? found : null;
  // Before dividers (dev.42), the folder's question is what is asked: asked again when it changes.
  const question = useMemo(() => {
    const f = !gate.dividers && read?.arranged ? findNode(read.arranged.cabinets, id) : null;
    return f?.kind === 'folder' ? JSON.stringify(f.folder.filter) : null;
  }, [gate.dividers, read, id]);

  const [token, setToken] = useState<string | null>(null);
  const [contents, setContents] = useState<FolderContents | null>(null);
  const [gone, setGone] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  // Before dividers: the list refused the folder's question (422) — said, with no Try again, as the vault does for C2's.
  const [refused, setRefused] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [behind, setBehind] = useState<Record<string, Behind>>({});
  const [open, setOpen] = useState<Set<string>>(new Set());
  // What it holds, in words: the family's names and the kinds', once read.
  const [names, setNames] = useState<{ person: (id: string) => string; kind: (key: string) => string } | null>(null);
  // Who issued it, by the household's names (dev.91): read only for a folder that asks for an issuer.
  const [issuerName, setIssuerName] = useState<((key: string) => string) | null>(null);
  const asksIssuer = gate.issuer && !!folder && (folder.folder.filter.issuer ?? '').split(',').some((k) => k !== '' && k !== NO_ISSUER);
  const vaultKey = who ? `${who.origin}|${who.member_id}` : '';
  // Which asking is current: an answer to an older one is let go.
  const asking = useRef(0);

  /** One divider's papers: the first page, or the next. Before dividers (dev.42), the folder's question asked of the list. */
  const readBehind = useCallback(
    async (key: string, filter: FolderFilter | null, after: string | null) => {
      const n = asking.current;
      setBehind((b) => ({ ...b, [key]: { ...(b[key] ?? NOTHING_YET), loading: true, failed: null } }));
      try {
        const page = await withToken((a, tk) => {
          setToken(tk);
          return filter
            ? a.documents(tk, {
                ...filter,
                sort: 'dated',
                direction: 'desc',
                limit: FOLDER_PAGE,
                ...(after ? { cursor: after } : {}),
              })
            : a.cabinetFolderDocuments(tk, id, { divider: key, limit: FOLDER_PAGE, ...(after ? { cursor: after } : {}) });
        });
        if (n !== asking.current) return;
        setBehind((b) => ({
          ...b,
          [key]: {
            items: [...(after ? (b[key]?.items ?? []) : []), ...page.items],
            cursor: page.next_cursor,
            more: page.has_more && !!page.next_cursor,
            loading: false,
            failed: null,
          },
        }));
      } catch (err) {
        if (n !== asking.current) return;
        if (err instanceof ApiRequestError && err.status === 404) {
          setGone(true);
          return;
        }
        if (filter && err instanceof ApiRequestError && err.status === 422) {
          setRefused(true);
          setBehind((b) => ({ ...b, [key]: { ...(b[key] ?? NOTHING_YET), loading: false, failed: null, more: false } }));
          return;
        }
        const words = loadFailure('folder', err, t);
        setBehind((b) => ({ ...b, [key]: { ...(b[key] ?? NOTHING_YET), loading: false, failed: words } }));
      }
    },
    [withToken, id, t],
  );

  const load = useCallback(async () => {
    if (!gate.on) return;
    const n = ++asking.current;
    setBehind({});
    setRefused(false);
    if (!gate.dividers) {
      // dev.42 and dev.43: the folder's question, as the list answers it; known once the cabinet is read.
      if (question === null) return;
      setContents(null);
      setOpen(new Set(['all']));
      await readBehind('all', JSON.parse(question) as FolderFilter, null);
      return;
    }
    try {
      const c = await withToken((a, tk) => {
        setToken(tk);
        return a.cabinetFolder(tk, id);
      });
      if (n !== asking.current) return;
      setContents(c);
      setGone(false);
      setFailed(null);
      // The first divider with papers behind it is open already, and its group; a folder without dividers, its one list.
      const first = c.dividers.find((d) => d.count > 0);
      const group =
        first && gate.levels ? dividerGroups(c.dividers).find((g) => g.leaves.some((l) => l.divider === first)) : undefined;
      setOpen(new Set([...(first ? [first.key] : []), ...(group?.grouped ? [groupKey(group)] : [])]));
      if (first) void readBehind(first.key, null, null);
    } catch (err) {
      if (n !== asking.current) return;
      if (err instanceof ApiRequestError && err.status === 404) setGone(true);
      else setFailed(loadFailure('folder', err, t));
    }
  }, [gate.on, gate.dividers, gate.levels, withToken, id, t, readBehind, question]);

  useEffect(() => {
    // Asked on arrival and when the connection returns; set once the vault answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, offline]);
  // A paper changed on its page (its details, the Trash): what is behind each divider may have too.
  useEffect(() => on('documentChanged', () => void load()), [load]);
  // Held back meanwhile (0.20.0): looked at again once the app carries on.
  useEffect(() => on('carryOn', () => void load()), [load]);

  // The names in the folder's question: once, and none if they can't be read.
  useEffect(() => {
    if (!gate.on || names || offline) return;
    let stopped = false;
    withToken((a, tk) =>
      Promise.all([a.members(tk).catch(() => ({ items: [] })), a.documentTypes(tk).catch(() => ({ items: [] }))]),
    )
      .then(([m, ty]) => {
        if (stopped) return;
        setNames({
          person: (pid) =>
            pid === 'household'
              ? THE_HOUSEHOLD
              : pid === 'none'
                ? NOT_SURE_YET
                : (m.items.find((x) => x.id === pid)?.display_name ?? t('cabinet.someone')),
          kind: (key) => ty.items.find((x) => x.key === key)?.label ?? key,
        });
      })
      .catch(() => undefined);
    return () => {
      stopped = true;
    };
  }, [gate.on, names, offline, withToken, t]);

  // The household's issuers, for a folder that names one: once for the app, shared by every folder (use-cabinet).
  useEffect(() => {
    if (!asksIssuer || issuerName || offline || !vaultKey) return;
    let stopped = false;
    void issuerGroupsFor(vaultKey, () => withToken((a, tk) => a.issuerGroups(tk))).then((groups) => {
      if (stopped) return;
      const named = (key: string) =>
        groups?.items.find((g) => g.key === key || g.members.some((x) => x.key === key))?.name ?? key;
      setIssuerName(() => named);
    });
    return () => {
      stopped = true;
    };
  }, [asksIssuer, issuerName, offline, vaultKey, withToken]);

  /** A group's tab opened or closed: its leaves shown inside it. */
  const toggleGroup = (g: DividerGroup) => {
    const next = new Set(open);
    const k = groupKey(g);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setOpen(next);
  };

  const toggle = (d: FolderDivider) => {
    const next = new Set(open);
    if (next.has(d.key)) next.delete(d.key);
    else {
      next.add(d.key);
      if (!behind[d.key] && d.count > 0) void readBehind(d.key, null, null);
    }
    setOpen(next);
  };

  const row = (doc: DocumentView, index: number, count: number) => (
    <DocumentRow
      key={doc.id}
      id={doc.id}
      title={doc.title}
      type_key={doc.type_key}
      note_name={doc.note_name}
      status={doc.status}
      doc={doc}
      place={rowPlace(index, count)}
      thumb={api && token && doc.latest_version_id ? { uri: api.thumbnailUrl(doc.latest_version_id), token } : null}
    />
  );

  /** The papers read so far behind a divider, Show more while there are more, and its own failure. */
  const papers = (key: string, filter: FolderFilter | null, empty: string | null) => {
    const b = behind[key];
    if (!b) return null;
    return (
      <View style={styles.papers}>
        {b.items.length > 0 ? <View>{b.items.map((d, i) => row(d, i, b.items.length))}</View> : null}
        {b.items.length === 0 && !b.loading && !b.failed && !b.more && empty ? (
          <Text tone="soft" testID={`folder-empty-${key}`}>
            {empty}
          </Text>
        ) : null}
        {b.loading && b.items.length === 0 ? <Placeholder rows={2} testID={`folder-loading-${key}`} /> : null}
        {b.failed ? <LoadFailed words={b.failed} onRetry={() => void readBehind(key, filter, b.cursor)} /> : null}
        {b.more && !b.failed ? (
          <Button
            kind="quiet"
            testID={`folder-more-${key}`}
            label={t('cabinet.showMore')}
            busy={b.loading}
            onPress={() => void readBehind(key, filter, b.cursor)}
          />
        ) : null}
      </View>
    );
  };

  /** One divider: its tab, its count, and its papers when open. Inside a group, named by its steps after the group's. */
  const divider = (d: FolderDivider, label: string, nested: boolean) =>
    d.kind === 'all' ? (
      <View key={d.key}>{papers(d.key, null, null)}</View>
    ) : (
      <View key={d.key} style={styles.section}>
        <Pressable
          testID={`divider-${d.key}`}
          accessibilityRole="button"
          accessibilityLabel={t('cabinet.divider', { name: d.name, count: d.count })}
          accessibilityState={{ expanded: open.has(d.key) }}
          onPress={() => toggle(d)}
          style={({ pressed }) => [
            styles.tab,
            styles.tabPress,
            nested ? styles.nested : null,
            pressed ? styles.pressed : null,
          ]}
        >
          {open.has(d.key) ? (
            <ChevronDown color={colours.ink} size={16} accessibilityElementsHidden importantForAccessibility="no" />
          ) : (
            <ChevronRight color={colours.ink} size={16} accessibilityElementsHidden importantForAccessibility="no" />
          )}
          <Text variant="secondary" weight={nested ? '600' : '700'} style={styles.flex}>
            {label}
          </Text>
          <Text variant="secondary" tone="soft">
            {String(d.count)}
          </Text>
        </Pressable>
        {open.has(d.key) ? (
          d.count === 0 ? (
            <Text tone="soft" testID={`folder-empty-${d.key}`}>
              {t('cabinet.dividerEmpty')}
            </Text>
          ) : (
            papers(d.key, null, t('cabinet.dividerEmpty'))
          )
        ) : null}
      </View>
    );

  const header = folder ? (
    <View style={styles.header}>
      <Text variant="secondary" tone="soft" testID="folder-path">
        {`${folder.cabinet.name} › ${folder.drawer.name}`}
      </Text>
      <Text variant="hero" role="header">{folder.folder.name}</Text>
      {names && (!asksIssuer || issuerName) ? (
        <Text variant="secondary" tone="soft" testID="folder-question">
          {folderQuestionWords(folder.folder.filter, { ...names, ...(issuerName ? { issuer: issuerName } : {}) })}
        </Text>
      ) : null}
      {from === 'elsewhere' ? (
        <Notice tone="info" testID="folder-elsewhere">
          {t('cabinet.printedElsewhere')}
        </Notice>
      ) : null}
      {contents && contents.total !== null ? (
        <Text variant="secondary" tone="soft" testID="folder-count">
          {t('glance.documentsCount', { count: contents.total })}
        </Text>
      ) : null}
    </View>
  ) : null;

  const body = () => {
    if (!gate.on) return <Notice tone="warn">{t('cabinet.noCabinet')}</Notice>;
    // With dividers the vault says whether the folder is theirs (404); before them, the cabinet as read.
    if (gone || (!gate.dividers && read && !folder)) {
      return (
        <Notice tone="warn" testID="folder-gone">
          {t('cabinet.folderGone')}
        </Notice>
      );
    }
    if (failed) return <LoadFailed words={failed} onRetry={() => void load()} />;
    if (offline && !contents && !behind.all) {
      return (
        <Notice tone="warn" testID="folder-offline">
          {t('cabinet.needsConnection')}
        </Notice>
      );
    }
    if (!gate.dividers) {
      if (refused) {
        return (
          <Notice tone="warn" testID="folder-refused">
            {t('cabinet.questionRefused')}
          </Notice>
        );
      }
      return folder ? papers('all', folder.folder.filter, t('cabinet.folderEmpty')) : <Placeholder rows={3} />;
    }
    if (!contents) return <Placeholder rows={3} testID="folder-loading" />;
    const nothing = contents.pinned.length === 0 && contents.dividers.every((d) => d.count === 0);
    return (
      <>
        {contents.total === null ? (
          <Notice tone="warn" testID="folder-refused">
            {t('cabinet.questionRefused')}
          </Notice>
        ) : null}
        {nothing && contents.total !== null ? (
          <Text tone="soft" testID="folder-empty">
            {t('cabinet.folderEmpty')}
          </Text>
        ) : null}
        {contents.pinned.length > 0 ? (
          <View style={styles.section} testID="folder-pinned">
            <View style={styles.tab}>
              <Pin color={colours.accent} size={15} accessibilityElementsHidden importantForAccessibility="no" />
              <Text variant="secondary" weight="700" role="header" style={styles.flex}>
                {t('cabinet.pinned')}
              </Text>
              <Text variant="secondary" tone="soft">
                {String(contents.pinned.length)}
              </Text>
            </View>
            <View>{contents.pinned.map((d, i) => row(d, i, contents.pinned.length))}</View>
          </View>
        ) : null}
        {nothing
          ? null
          : dividerGroups(gate.levels ? contents.dividers : contents.dividers.map((d) => ({ ...d, path: undefined }))).map(
              (g) => {
                const only = g.leaves[0];
                if (!g.grouped && only) return divider(only.divider, only.label, false);
                const isOpen = open.has(groupKey(g));
                // Levels 4 and 5 (dev.90): the leaves under their first step's tab.
                return (
                  <View key={groupKey(g)} style={styles.section}>
                    <Pressable
                      testID={`divider-group-${g.key}`}
                      accessibilityRole="button"
                      accessibilityLabel={t('cabinet.group', {
                        name: g.name,
                        documents: t('glance.documentsCount', { count: g.count }),
                        dividers: t('cabinet.dividersCount', { count: g.leaves.length }),
                      })}
                      accessibilityState={{ expanded: isOpen }}
                      onPress={() => toggleGroup(g)}
                      style={({ pressed }) => [styles.tab, styles.tabPress, pressed ? styles.pressed : null]}
                    >
                      {isOpen ? (
                        <ChevronDown color={colours.ink} size={16} accessibilityElementsHidden importantForAccessibility="no" />
                      ) : (
                        <ChevronRight color={colours.ink} size={16} accessibilityElementsHidden importantForAccessibility="no" />
                      )}
                      <Text variant="secondary" weight="700" style={styles.flex}>
                        {g.name}
                      </Text>
                      <Text variant="secondary" tone="soft">
                        {String(g.count)}
                      </Text>
                    </Pressable>
                    {isOpen ? (
                      <View style={styles.inside}>{g.leaves.map((l) => divider(l.divider, l.label, true))}</View>
                    ) : null}
                  </View>
                );
              },
            )}
      </>
    );
  };

  return (
    <ScrollView
      testID="folder"
      style={styles.screen}
      contentContainerStyle={styles.page}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load().finally(() => setRefreshing(false));
          }}
        />
      }
    >
      {header}
      {body()}
    </ScrollView>
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    screen: { backgroundColor: colours.bg },
    page: { padding: sp(20), gap: sp(12) },
    header: { gap: sp(4) },
    section: { gap: sp(8) },
    papers: { gap: sp(8) },
    // A divider: a tab-like line over its papers, as a paper folder's divider sticks up.
    tab: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: sp(8),
      minHeight: 40,
      paddingHorizontal: sp(12),
      borderTopLeftRadius: 10,
      borderTopRightRadius: 10,
      borderBottomWidth: 2,
      borderBottomColor: colours.accent,
      backgroundColor: colours.accentSoft,
    },
    tabPress: { minHeight: 44 },
    // A divider inside a group's tab: a step in, as a divider behind a divider.
    inside: { gap: sp(8), paddingLeft: sp(12) },
    nested: { backgroundColor: colours.surface, borderBottomWidth: 1 },
    pressed: { opacity: 0.8 },
    flex: { flex: 1 },
  });
