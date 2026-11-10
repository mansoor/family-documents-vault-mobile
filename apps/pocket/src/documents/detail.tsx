import { ApiRequestError, NetworkError } from '@fdv/client';
import {
  ANOTHER_DOCUMENT,
  can,
  documentName,
  formatDate,
  NOTE_KIND,
  radii,
  type DocumentTypeView,
  type DocumentView,
  type Member,
  type NoLongerNeededView,
  type VersionView,
} from '@fdv/shared';
import { Image } from 'expo-image';
import { Stack, useRouter } from 'expo-router';
import {
  Download,
  Ellipsis,
  Eye,
  FilePlus,
  FileText,
  NotebookText,
  Pencil,
  Trash2,
  type LucideIcon,
} from 'lucide-react-native';
import { Fragment, useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { renewWords } from '../capture/renew-words';
import { useCapture } from '../state/capture';
import { on } from '../state/events';
import { useEssentials } from '../state/essentials';
import { useLock } from '../state/lock';
import { useStepUp } from '../state/step-up';
import { NewVersionSays } from './renewal';
import { useVault } from '../state/vault';
import { Button, Notice, StatusLine, Text } from '../ui';
import { keptIsCurrent, saveVersion, setEssential as changeEssential, showDocument, type ActionDeps } from './actions';
import { detailFacts } from './details';
import { NoteText } from './notes';
import { latestOf } from './online';
import { warnedAboutCopies } from './save-copy';
import { TrashConfirm } from './trash';
import { ConfirmSheet } from '../ui/confirm';
import { Sheet } from '../ui/sheet';
import { useTextScale } from '../ui/text-scale';
import { VisibilityControl } from './visibility';
import { sp } from '../ui/space';
import { useColours, useStyles, type Palette } from '../ui/theme';
import { dayWords, exactWords, relativeWords, useFamilyZone } from '../state/family-time';
import { LoadFailed, loadFailure, Placeholder } from '../ui/states';

type Problem = 'offline' | 'not_found' | 'failed' | null;

/**
 * A document (4.12), compact (R6, the mockup's second screen): its
 * picture, its name, a line of whose it is, what kind and who can see it,
 * and its status; one row of round actions — Show for an Essential, its
 * Pages, Save a copy, a New version; its details in two columns; and one
 * card of lines for who can see it, its tags, its collections, its
 * versions (opened in place) and whether it is an Essential. Edit details
 * is the pencil in the header, Move to the Trash is under its ⋯.
 *
 * Its pages come from the phone when it is kept there (without asking
 * anything), otherwise from the vault, confirming it is you if the vault
 * asks. The Essential switch works online only: a change made meanwhile by
 * somebody else is shown, not overwritten. A note (a vault of 0.9.0) has
 * no file: its words, and none of what a file is for.
 */
export function DocumentDetail(props: { id: string }) {
  const colours = useColours();
  const styles = useStyles(makeStyles);
  const { id } = props;
  const { t } = useTranslation();
  const router = useRouter();
  const { withToken, offline, who, caps, api } = useVault();
  const { scale } = useTextScale();
  // Every time on this page on the family's clock (P5).
  const zone = useFamilyZone();
  const { guarded } = useStepUp();
  // The last control clears the gesture bar (0.2.0), as in Settings.
  const insets = useSafeAreaInsets();
  const essentials = useEssentials();
  const capture = useCapture();
  const lock = useLock();
  const [doc, setDoc] = useState<DocumentView | null>(null);
  const [versions, setVersions] = useState<VersionView[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [types, setTypes] = useState<DocumentTypeView[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem>(null);
  const [failedWords, setFailedWords] = useState('');
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  const [warning, setWarning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  // The header's ⋯: its choices, then the question Move to the Trash asks, in the same sheet.
  const [more, setMore] = useState<'menu' | 'trash' | null>(null);
  // Essential off: its copies leave the phones that keep them, so it asks first (R2).
  const [askOff, setAskOff] = useState(false);
  // The collections it is in (P8), of those the person may see.
  const [inCollections, setInCollections] = useState<{ id: string; name: string }[]>([]);
  const warn = useCallback((text: string) => setNotice({ tone: 'warn', text }), []);

  const kept = essentials.items.find((i) => i.id === id) ?? null;
  const shown = doc ?? kept?.document ?? null;
  // A teen changes only their own; the vault refuses the rest.
  const mine = !!who && shown?.owner_member_id === who.member_id;
  const mayChange = !!who && can(who.role, 'document.edit') && (who.role !== 'teen' || mine);
  const renewing = capture.queue.some((i) => i.kind === 'version' && i.target === id);
  const note = shown?.type_key === NOTE_KIND;
  // Into the Trash: a teen, only their own (P8), as the web allows.
  const mayTrash = !!who && can(who.role, 'document.delete') && (who.role !== 'teen' || mine);
  const hasCollections = caps?.features.collections === true;
  const mayAddVersion =
    !!who && can(who.role, 'document.add') && (who.role !== 'teen' || mine) && !renewing && !note;

  const load = useCallback(async () => {
    try {
      const [d, v, m, ty, c] = await withToken((a, tk) => {
        // Its picture is fetched with the token, as a list's are.
        setToken(tk);
        return Promise.all([
          a.document(tk, id),
          a.versions(tk, id),
          a.members(tk).catch(() => ({ items: [] })),
          // For the type's details: its own fields, and its names for them.
          a.documentTypes(tk).catch(() => ({ items: [] })),
          hasCollections
            ? a.documentCollections(tk, id).catch(() => ({ items: [] }))
            : Promise.resolve({ items: [] }),
        ]);
      });
      setDoc(d);
      setVersions(v.items);
      setMembers(m.items);
      setTypes(ty.items);
      setInCollections(c.items.map((x) => ({ id: x.id, name: x.name })));
      setProblem(null);
    } catch (err) {
      if (err instanceof ApiRequestError && (err.status === 404 || err.code === 'not_found')) setProblem('not_found');
      else if (err instanceof NetworkError) setProblem('offline');
      else {
        // Anything else, said with Try again (P5): never a blank page.
        const words = loadFailure('document', err, t);
        if (words) {
          setFailedWords(words);
          setProblem('failed');
        }
      }
    }
  }, [withToken, id, t, hasCollections]);

  useEffect(() => {
    // Loaded on arrival, again when the connection returns and when the
    // vault takes a capture; the state is set after the requests answer.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, offline, capture.delivered]);
  // Its details changed on Edit details: looked at again.
  useEffect(() => on('documentChanged', (changed) => (changed === id ? void load() : undefined)), [id, load]);

  const latest = latestOf(versions);
  // What this page and a row's ⋯ do alike (5.36). The store itself is asked
  // which copy it keeps, as it may still be opening.
  const deps: ActionDeps = {
    withToken,
    guarded,
    offline,
    keptVersion: essentials.keptVersion,
    push: (to) => router.push(to),
    away: lock.away,
  };

  const showIt = async () => {
    setNotice(null);
    setPreparing(true);
    try {
      const problem = await showDocument(deps, id, latest?.id ?? null);
      if (problem) warn(t(problem));
    } finally {
      setPreparing(false);
    }
  };
  const pages = async () =>
    router.push({
      pathname: '/essential/[id]',
      params: (await keptIsCurrent(deps, id, latest?.id ?? null)) ? { id } : { id, online: '1' },
    });

  const setEssential = async (value: boolean) => {
    if (!doc || toggling) return;
    setNotice(null);
    setToggling(true);
    try {
      // Not confirmed, nothing changes.
      const outcome = await changeEssential(deps, doc, value, t);
      if (outcome.kind === 'saved') setDoc(outcome.doc);
      else if (outcome.kind === 'conflict') {
        // Changed meanwhile by somebody else: theirs is shown, not overwritten.
        warn(t('document.conflict'));
        await load();
      } else if (outcome.kind === 'failed') warn(outcome.words);
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
      const outcome = await saveVersion(deps, latest);
      if (typeof outcome === 'object') warn(t(outcome.failed));
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
        {problem === 'failed' ? <LoadFailed words={failedWords} onRetry={() => void load()} /> : null}
        {problem === null ? <Placeholder rows={2} /> : null}
        {problem === 'offline' ? (
          <Notice tone="warn">
            <Text>{t('document.offline')}</Text>
            <Button kind="quiet" label={t('document.tryAgain')} onPress={() => void load()} testID="document-retry" />
          </Notice>
        ) : null}
      </View>
    );
  }

  const name = documentName(shown, t('document.untitled'));
  const owner = members.find((m) => m.id === shown.owner_member_id);
  // The type's own details, from the vault's answer for this document only:
  // an Only me document's are sealed everywhere else (a list, the offline
  // set, so a kept copy) and opened there for its owner (0.5.8).
  const type = types.find((x) => x.key === shown.type_key);
  const details = doc ? detailFacts(type?.fields, doc.extra, { yes: t('document.yes'), no: t('document.no') }) : [];
  const facts = (
    [
      [t('document.issuedBy'), shown.issued_by ?? null],
      [t('document.issued'), shown.issued ? formatDate(shown.issued) : null],
      [t('document.expires'), shown.expires ? formatDate(shown.expires) : null],
      ...details,
    ] as [string, string | null][]
  ).filter((f): f is [string, string] => !!f[1]);
  // Whose · what kind · who can see it: what the old page said in three places, on one line.
  const subline = [owner?.display_name, note ? null : type?.label, t(`document.visibility_${shown.visibility}`)]
    .filter(Boolean)
    .join(' · ');
  const ordered = [...versions].sort((x, y) => y.version_no - x.version_no);
  const first = ordered[ordered.length - 1];
  const thumb = api && token && latest && !note ? api.thumbnailUrl(latest.id) : null;
  const mayEdit = mayChange && !!doc && !note && !offline;
  const hasMore = mayTrash && !!doc && !offline;
  // Two columns, until the text is so large that one reads better.
  const oneColumn = scale > 1.2;

  const actions: { key: string; testID: string; label: string; icon: LucideIcon; busy?: boolean; onPress: () => void }[] =
    note
      ? []
      : [
          ...(shown.is_essential
            ? [{ key: 'show', testID: 'document-show', label: t('document.show'), icon: Eye, busy: preparing, onPress: () => void showIt() }]
            : []),
          { key: 'pages', testID: 'document-pages', label: t('document.pagesShort'), icon: FileText, onPress: () => void pages() },
          { key: 'save', testID: 'document-save', label: t('document.saveCopyShort'), icon: Download, busy: saving, onPress: save },
          ...(mayAddVersion && doc
            ? [{ key: 'version', testID: 'document-add-version', label: t('document.newVersionShort'), icon: FilePlus, onPress: () => void addVersion() }]
            : []),
        ];

  // The lines of the card under the details, each with a hairline above all but the first.
  const lines: { key: string; node: ReactNode }[] = [
    {
      key: 'visibility',
      node:
        doc && !offline ? (
          <VisibilityControl doc={doc} onChanged={load} line />
        ) : (
          <View style={styles.line} testID="document-visibility">
            <Text style={styles.flex}>{t('document.whoCanSee')}</Text>
            <Text variant="secondary" tone="soft">
              {t(`document.visibility_${shown.visibility}`)}
            </Text>
          </View>
        ),
    },
    ...((shown.tags ?? []).length > 0
      ? [
          {
            key: 'tags',
            node: (
              <View style={styles.line} testID="document-tags">
                <Text>{t('document.tags')}</Text>
                <View style={styles.tags}>
                  {shown.tags.map((tag) => (
                    <View key={tag} style={styles.tag}>
                      <Text variant="small" weight="600">
                        {tag}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            ),
          },
        ]
      : []),
    ...(inCollections.length > 0
      ? [
          {
            key: 'collections',
            node: (
              <View style={styles.line} testID="document-collections">
                <Text style={styles.flex}>{t('document.collections')}</Text>
                <Text variant="secondary" tone="soft" style={styles.value}>
                  {inCollections.map((c) => c.name).join(', ')}
                </Text>
              </View>
            ),
          },
        ]
      : []),
    ...(!note && latest
      ? [
          {
            key: 'versions',
            node: (
              <View>
                <Pressable
                  testID="document-versions"
                  accessibilityRole="button"
                  accessibilityLabel={t('document.versionsLabel', {
                    count: versions.length,
                    when: dayWords(latest.uploaded_at, zone),
                  })}
                  accessibilityState={{ expanded: versionsOpen }}
                  onPress={() => setVersionsOpen((o) => !o)}
                  style={({ pressed }) => [styles.line, pressed ? styles.pressed : null]}
                >
                  <Text style={styles.flex}>{t('document.versions')}</Text>
                  <Text variant="secondary" tone="soft">
                    {t('document.versionsLine', { count: versions.length, when: dayWords(latest.uploaded_at, zone) })}
                    {versionsOpen ? ' ⌃' : ' ›'}
                  </Text>
                </Pressable>
                {versionsOpen
                  ? ordered.map((v) => (
                      <View key={v.id} style={styles.version} testID={`version-${v.version_no}`}>
                        <Text variant="secondary" weight="600">
                          {v.filename}
                          {v.id === latest.id ? ` · ${t('document.current')}` : ''}
                        </Text>
                        <Text tone="soft" variant="small">
                          {versionLine(v)}
                        </Text>
                        {v.id !== latest.id ? (
                          <OlderVersion
                            version={v}
                            fields={type?.fields}
                            onPages={() =>
                              router.push({ pathname: '/essential/[id]', params: { id, online: '1', version: v.id } })
                            }
                          />
                        ) : null}
                      </View>
                    ))
                  : null}
              </View>
            ),
          },
        ]
      : []),
    ...(mayChange && doc && !note
      ? [
          {
            key: 'essential',
            node: (
              <View style={styles.line}>
                <View style={styles.flex}>
                  <Text>{t('document.essential')}</Text>
                  <Text tone="soft" variant="small">
                    {t('document.essentialHint')}
                  </Text>
                </View>
                <Switch
                  testID="document-essential"
                  accessibilityLabel={t('document.essential')}
                  value={doc.is_essential}
                  disabled={offline || toggling}
                  onValueChange={(v) => (v ? void setEssential(true) : setAskOff(true))}
                  trackColor={{ true: colours.accent, false: colours.border }}
                />
              </View>
            ),
          },
        ]
      : []),
  ];

  return (
    <ScrollView
      testID="document"
      contentContainerStyle={[styles.page, { paddingBottom: 20 + insets.bottom }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refreshNow()} />}
    >
      {/* Edit details and ⋯, in the header beside Back (R6). */}
      <Stack.Screen
        options={{
          headerRight: () => (
            <View style={styles.headerButtons}>
              {mayEdit ? (
                <IconButton
                  testID="document-edit"
                  label={t('document.edit')}
                  icon={Pencil}
                  onPress={() => router.push({ pathname: '/edit/[id]', params: { id } })}
                />
              ) : null}
              {hasMore ? (
                <IconButton
                  testID="document-more"
                  label={t('document.more', { title: name })}
                  icon={Ellipsis}
                  onPress={() => setMore('menu')}
                />
              ) : null}
            </View>
          ),
        }}
      />

      <View style={styles.head}>
        <View style={styles.thumb}>
          {thumb && token ? (
            <Image
              source={{ uri: thumb, headers: { authorization: `Bearer ${token}` } }}
              // Held in memory only: a document's picture never lands in the phone's disk cache.
              cachePolicy="memory"
              style={styles.thumbImage}
              contentFit="cover"
              accessibilityIgnoresInvertColors
            />
          ) : note ? (
            <NotebookText color={colours.accent} size={22} accessibilityElementsHidden importantForAccessibility="no" />
          ) : (
            <FileText color={colours.accent} size={22} accessibilityElementsHidden importantForAccessibility="no" />
          )}
        </View>
        <View style={styles.headWords}>
          <Text variant="hero">{name}</Text>
          {subline ? (
            <Text variant="secondary" tone="soft" testID="document-subline">
              {subline}
            </Text>
          ) : null}
          <View style={styles.pills}>
            <StatusLine status={shown.status} />
            {shown.is_essential && !note ? (
              <View style={styles.pill} testID="document-essential-pill">
                <Text variant="small" tone="accent" weight="700">
                  {t('document.essentialPill')}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>
      {shown.no_longer_needed ? (
        <Unneeded
          mark={shown.no_longer_needed}
          open={(to) => router.push({ pathname: '/document/[id]', params: { id: to } })}
        />
      ) : null}
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
      {doc && !note ? (
        <NewVersionSays
          doc={doc}
          type={type}
          mayChange={mayChange}
          onSaved={(d) => {
            setDoc(d);
            void load();
          }}
          onStale={load}
        />
      ) : null}

      {actions.length > 0 ? (
        <View style={[styles.card, styles.actions]} testID="document-actions">
          {actions.map((a) => (
            <Pressable
              key={a.key}
              testID={a.testID}
              accessibilityRole="button"
              accessibilityLabel={a.label}
              accessibilityState={{ busy: a.busy === true, disabled: a.busy === true }}
              disabled={a.busy === true}
              onPress={a.onPress}
              style={({ pressed }) => [styles.action, pressed ? styles.pressed : null]}
            >
              <View style={styles.round}>
                {a.busy ? (
                  <ActivityIndicator color={colours.accent} />
                ) : (
                  <a.icon color={colours.accent} size={19} accessibilityElementsHidden importantForAccessibility="no" />
                )}
              </View>
              <Text variant="small" weight="600" style={styles.actionLabel}>
                {a.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {warning ? (
        <Notice tone="warn" announce={t('document.saveWarning')}>
          <Text testID="document-save-warning">{t('document.saveWarning')}</Text>
          <Button testID="document-save-anyway" label={t('document.saveAnyway')} onPress={() => void doSave()} />
          <Button kind="quiet" label={t('document.saveCancel')} onPress={() => setWarning(false)} />
        </Notice>
      ) : null}

      {facts.length > 0 ? (
        <View style={[styles.card, styles.grid]} testID="document-facts" accessibilityLabel={t('document.facts')}>
          {facts.map(([label, value]) => (
            <View key={label} style={[styles.fact, oneColumn ? styles.factWide : null]}>
              <Text tone="soft" variant="small">
                {label}
              </Text>
              <Text weight="600">{value}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.card}>
        {lines.map((l, i) => (
          <Fragment key={l.key}>
            {i > 0 ? <View style={styles.sep} /> : null}
            {l.node}
          </Fragment>
        ))}
      </View>

      {/* Its note (5.35), read only, from a vault that has notes you can
          write: an older one says nothing of when a note last changed. */}
      {shown.notes_updated_at !== undefined && shown.notes ? (
        <View style={[styles.card, styles.notes]} testID="document-notes">
          {note ? null : (
            <Text variant="secondary" weight="700">
              {type?.core?.notes?.label?.trim() || t('document.notes')}
            </Text>
          )}
          <NoteText source={shown.notes} />
          {shown.notes_updated_at ? (
            <Text tone="soft" variant="small" testID="document-notes-edited">
              {shown.notes_updated_by_name
                ? t('document.notesEditedBy', {
                    when: exactWords(shown.notes_updated_at, zone),
                    name: shown.notes_updated_by_name,
                  })
                : t('document.notesEdited', { when: exactWords(shown.notes_updated_at, zone) })}
            </Text>
          ) : null}
        </View>
      ) : null}

      {first && !note ? (
        <Text variant="small" tone="soft" testID="document-added">
          {versionLine(first)}
        </Text>
      ) : null}

      <ConfirmSheet
        visible={askOff}
        testID="essential-off-question"
        title={t('document.essentialOffTitle')}
        words={t('document.essentialOffWords')}
        confirmLabel={t('document.essentialOffYes')}
        busy={toggling}
        onConfirm={() => {
          setAskOff(false);
          void setEssential(false);
        }}
        onCancel={() => setAskOff(false)}
        confirmID="essential-off-yes"
        cancelID="essential-off-cancel"
      />
      <Sheet visible={more !== null} onClose={() => setMore(null)} {...(more === 'menu' ? { outside: true as const } : {})} testID="document-more-sheet">
        {more === 'trash' && doc ? (
          <TrashConfirm id={id} title={name} onGone={() => router.back()} onCancel={() => setMore(null)} />
        ) : (
          <View style={styles.menu}>
            <Text variant="screen">{name}</Text>
            <Pressable
              testID="document-trash"
              accessibilityRole="button"
              accessibilityLabel={t('trash.button')}
              onPress={() => setMore('trash')}
              style={({ pressed }) => [styles.menuRow, pressed ? styles.pressed : null]}
            >
              <Trash2 color={colours.danger} size={20} accessibilityElementsHidden importantForAccessibility="no" />
              <Text tone="danger" weight="600">
                {t('trash.button')}
              </Text>
            </Pressable>
            <Button kind="quiet" label={t('common.cancel')} onPress={() => setMore(null)} testID="document-more-cancel" />
          </View>
        )}
      </Sheet>
    </ScrollView>
  );

  async function refreshNow() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  /**
   * When a version was added, and by whom (a vault of 0.5.1 or later):
   * "Added 25 Sept 2026, 4:12pm by Sarah". A viewer is told only when, and
   * so is anybody about someone who has left; an older vault says neither,
   * and its history reads as in 0.2.0.
   */
  function versionLine(v: VersionView): string {
    if (v.uploaded_by_name === undefined) return t('document.versionAdded', { when: relativeWords(v.uploaded_at, zone) });
    const when = exactWords(v.uploaded_at, zone);
    return v.uploaded_by_name
      ? t('document.versionAddedBy', { when, name: v.uploaded_by_name })
      : t('document.versionAdded', { when });
  }
}

/** A round button in the header: 40 dp, 44 with its hit slop. */
function IconButton(props: { testID: string; label: string; icon: LucideIcon; onPress: () => void }) {
  const colours = useColours();
  const styles = useStyles(makeStyles);
  const Icon = props.icon;
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      hitSlop={2}
      onPress={props.onPress}
      style={({ pressed }) => [styles.iconButton, pressed ? styles.pressed : null]}
    >
      <Icon color={colours.ink} size={20} accessibilityElementsHidden importantForAccessibility="no" />
    </Pressable>
  );
}

/**
 * An older version in the history (P2): its own details, as they were when
 * a newer one replaced it (a vault of 0.9.0 keeps them), or that they were
 * not kept, for one replaced before; and its pages, opened as the newest
 * version's are, through the step-up an Essential or an Only me document
 * asks for. Its number is not shown, as the newest version's is not.
 */
function OlderVersion(props: {
  version: VersionView;
  fields: DocumentTypeView['fields'] | undefined;
  onPages: () => void;
}) {
  const styles = useStyles(makeStyles);
  const { t } = useTranslation();
  const { version: v } = props;
  const d = v.details;
  const lines: [string, string | null][] = d
    ? [
        [t('document.issuedBy'), d.issued_by],
        [t('document.issued'), d.issued ? formatDate(d.issued) : null],
        [t('document.expires'), d.expires ? formatDate(d.expires) : null],
        ...detailFacts(props.fields, d.extra, { yes: t('document.yes'), no: t('document.no') }),
      ]
    : [];
  return (
    <View style={styles.older} testID={`version-${v.version_no}-details`}>
      {lines
        .filter(([, value]) => value)
        .map(([label, value]) => (
          <Text key={label} variant="small">
            {label}: {value}
          </Text>
        ))}
      {v.details_kept === false ? (
        <Text tone="soft" variant="small">
          {t('document.detailsNotKept')}
        </Text>
      ) : null}
      <View style={styles.olderActions}>
        <Button
          size="small"
          testID={`version-${v.version_no}-pages`}
          kind="quiet"
          label={t('document.itsPages')}
          onPress={props.onPages}
        />
      </View>
    </View>
  );
}

/**
 * Why a document is no longer needed (a vault of 0.9.0): when it was
 * marked, and by whom where the reader is told; why, as written; and what
 * replaced it, opened from here when the reader may see it. Marking it, or
 * needing it again, is done in the browser.
 */
function Unneeded(props: { mark: NoLongerNeededView; open: (id: string) => void }) {
  const styles = useStyles(makeStyles);
  const { t } = useTranslation();
  const zone = useFamilyZone();
  const { mark } = props;
  const when = exactWords(mark.at, zone);
  const replaced = mark.replaced_by;
  const to = replaced?.id ?? null;
  const replacedWords = replaced ? t('document.unneededReplacedBy', { title: replaced.title ?? ANOTHER_DOCUMENT }) : null;
  return (
    <View style={styles.unneeded} testID="document-unneeded">
      <Text tone="soft" variant="secondary">
        {mark.by_name ? t('document.unneededBy', { when, name: mark.by_name }) : t('document.unneeded', { when })}
      </Text>
      {mark.reason ? <Text testID="document-unneeded-reason">{t('document.unneededReason', { reason: mark.reason })}</Text> : null}
      {replacedWords && to ? (
        <Button testID="document-unneeded-replacement" kind="quiet" label={replacedWords} onPress={() => props.open(to)} />
      ) : replacedWords ? (
        <Text testID="document-unneeded-replacement">{replacedWords}</Text>
      ) : null}
    </View>
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    page: { padding: sp(20), gap: sp(10) },
    head: { flexDirection: 'row', gap: sp(12), alignItems: 'flex-start', paddingHorizontal: sp(4) },
    thumb: {
      width: 48,
      height: 64,
      borderRadius: 8,
      backgroundColor: colours.accentSoft,
      borderWidth: 1,
      borderColor: colours.border,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    thumbImage: { width: '100%', height: '100%' },
    headWords: { flex: 1, gap: sp(4) },
    pills: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: sp(8) },
    pill: {
      paddingHorizontal: sp(8),
      paddingVertical: 2,
      borderRadius: radii.pill,
      backgroundColor: colours.accentSoft,
    },
    card: {
      backgroundColor: colours.surface,
      borderRadius: radii.m,
      borderWidth: 1,
      borderColor: colours.border,
      overflow: 'hidden',
    },
    actions: { flexDirection: 'row', paddingHorizontal: sp(4) },
    action: { flex: 1, alignItems: 'center', gap: sp(4), paddingVertical: sp(8), minHeight: 64 },
    actionLabel: { textAlign: 'center' },
    round: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colours.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: sp(12), paddingTop: sp(12), paddingBottom: sp(4) },
    fact: { width: '50%', paddingRight: sp(8), paddingBottom: sp(10), gap: 2 },
    factWide: { width: '100%' },
    line: { flexDirection: 'row', alignItems: 'center', gap: sp(8), minHeight: 44, paddingHorizontal: sp(12), paddingVertical: sp(6) },
    sep: { height: StyleSheet.hairlineWidth, backgroundColor: colours.border },
    flex: { flex: 1 },
    value: { flexShrink: 1, textAlign: 'right' },
    tags: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: sp(6) },
    tag: {
      paddingHorizontal: sp(8),
      paddingVertical: 2,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: colours.borderInput,
    },
    version: { paddingHorizontal: sp(12), paddingBottom: sp(10), gap: 2 },
    notes: { padding: sp(12), gap: sp(6) },
    unneeded: { gap: sp(4) },
    older: { gap: 2, marginTop: sp(4) },
    olderActions: { flexDirection: 'row', marginTop: sp(4) },
    headerButtons: { flexDirection: 'row', alignItems: 'center' },
    iconButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    pressed: { opacity: 0.8 },
    menu: { gap: sp(10) },
    menuRow: { flexDirection: 'row', alignItems: 'center', gap: sp(12), minHeight: 48 },
  });
