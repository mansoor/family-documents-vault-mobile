import { ApiRequestError, NetworkError } from '@fdv/client';
import {
  can,
  colours,
  inCollectionAudience,
  radii,
  sharedOutsideWords,
  TAP_MIN,
  type CollectionView,
  type DocumentView,
  type Role,
} from '@fdv/shared';
import { useRouter } from 'expo-router';
import {
  Download,
  Ellipsis,
  Eye,
  FilePlus,
  FileText,
  FolderPlus,
  Star,
  StarOff,
  type LucideIcon,
} from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { focusOn } from '../capture/add-button';
import { renewWords } from '../capture/renew-words';
import { wordsFor } from '../errors/words';
import { useCapture } from '../state/capture';
import { useEssentials } from '../state/essentials';
import { useLock } from '../state/lock';
import { useStepUp } from '../state/step-up';
import { useVault } from '../state/vault';
import { Button, Notice, Text } from '../ui';
import { saveVersion, setEssential, showDocument, type ActionDeps } from './actions';
import { latestOf } from './online';
import { warnedAboutCopies } from './save-copy';

/**
 * A menu on every row (5.36): a ⋯ beside each document in a list, and a
 * long press on the row, open a sheet of what its page offers — without
 * going there first. Only what would not be refused is drawn; the vault
 * decides regardless.
 */

export type RowAction = 'open' | 'show' | 'save' | 'version' | 'essential' | 'collect';

/**
 * What the ⋯ offers for one document (A14), in order. With no document yet
 * (a search hit's is still on its way), Open.
 *
 *  - Show (Show mode) for an Essential, Save a copy for anything with a file.
 *  - Somebody who changes nothing — a viewer, and so a guest — is given
 *    what they came for, as on the web: Open and Save a copy. They keep
 *    nothing on a phone and make no collections.
 *  - Add a new version, and Essential (which is what a phone keeps
 *    offline), for whoever may change it: a teen, their own.
 *  - Add to a collection when the vault has collections and the person
 *    makes them.
 */
export function rowActions(
  who: { role: Role; member_id: string } | null,
  doc: Pick<DocumentView, 'owner_member_id' | 'is_essential' | 'latest_version_id' | 'file_removed'> | null,
  opts: { collections: boolean; renewing: boolean },
): RowAction[] {
  const actions: RowAction[] = ['open'];
  if (!who || !doc) return actions;
  // A file a restore found removed for good is none to show or save (5.24).
  const hasFile = doc.latest_version_id !== null && doc.file_removed !== true;
  const changes = can(who.role, 'document.edit');
  if (hasFile && changes && doc.is_essential) actions.push('show');
  if (hasFile) actions.push('save');
  if (!changes) return actions;
  const mayChange = who.role !== 'teen' || doc.owner_member_id === who.member_id;
  if (mayChange && can(who.role, 'document.add') && !opts.renewing) actions.push('version');
  if (mayChange) actions.push('essential');
  if (opts.collections && can(who.role, 'collection.manage')) actions.push('collect');
  return actions;
}

/** The newer of two copies of a document, by when it last changed; the second when they tie. */
function newer(a: DocumentView | null, b: DocumentView | null): DocumentView | null {
  if (!a || !b) return b ?? a;
  return Date.parse(a.updated_at) > Date.parse(b.updated_at) ? a : b;
}

/**
 * A row's ⋯ and its sheet: the button, a way for the row's long press to
 * open it, and the sheet while it is open. Closed, the focus goes back to
 * the ⋯ once the sheet's window has gone.
 *
 * The row keeps the newest copy of its document the sheet had — fetched,
 * or saved by it — so that opened again, the sheet starts from that and
 * not from the list's, which nobody reloaded: an Essential made a moment
 * ago is offered as one (U536-02).
 */
export function useDocumentMenu(props: { id: string; title: string; doc?: DocumentView | null }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [latest, setLatest] = useState<DocumentView | null>(null);
  const button = useRef<View>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const close = useCallback((back: boolean) => {
    setOpen(false);
    if (!back) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      focusOn(button);
    }, 300);
  }, []);
  const show = useCallback(() => setOpen(true), []);
  const menuButton = (
    <Pressable
      ref={button}
      testID={`doc-menu-${props.id}`}
      accessibilityRole="button"
      accessibilityLabel={t('row.menu', { title: props.title })}
      accessibilityState={{ expanded: open }}
      hitSlop={4}
      onPress={show}
      style={({ pressed }) => [styles.more, pressed ? styles.pressed : null]}
    >
      <Ellipsis color={colours.inkSoft} size={24} accessibilityElementsHidden importantForAccessibility="no" />
    </Pressable>
  );
  const sheet = open ? (
    <DocumentMenu
      id={props.id}
      title={props.title}
      doc={newer(props.doc ?? null, latest)}
      onDoc={setLatest}
      onClose={close}
    />
  ) : null;
  return { open: show, button: menuButton, sheet };
}

const ICONS: Record<RowAction, LucideIcon> = {
  open: FileText,
  show: Eye,
  save: Download,
  version: FilePlus,
  essential: Star,
  collect: FolderPlus,
};

type Said = { tone: 'ok' | 'warn'; text: string };

/**
 * The sheet: the document's name, what may be done with it, and what came
 * of it. The document is asked of the vault as it opens — a search hit
 * has none, and an Essential is changed from the vault's own copy, never
 * from one that may be stale — and, without a connection, it is the newer
 * of the copy this phone keeps and the one it was opened with. While
 * something is on its way, the sheet stays open: what came of it is said
 * here, the vault's warnings among them (U536-01).
 */
function DocumentMenu(props: {
  id: string;
  title: string;
  doc: DocumentView | null;
  /** The vault's newest copy, as the sheet fetched or saved it. */
  onDoc: (doc: DocumentView) => void;
  /** `back`: the focus goes back to the ⋯ (nothing else took it). */
  onClose: (back: boolean) => void;
}) {
  const { id, title } = props;
  const { t } = useTranslation();
  const router = useRouter();
  const { withToken, offline, who, caps } = useVault();
  const { guarded } = useStepUp();
  const essentials = useEssentials();
  const capture = useCapture();
  const lock = useLock();
  const insets = useSafeAreaInsets();
  const kept = essentials.items.find((i) => i.id === id)?.document ?? null;
  const [doc, setDoc] = useState<DocumentView | null>(() => newer(kept, props.doc));
  // The vault has answered (or could not): until then, nothing is changed from a copy that may be stale.
  const [fetched, setFetched] = useState(false);
  const [said, setSaid] = useState<Said | null>(null);
  const [busy, setBusy] = useState<RowAction | null>(null);
  // An Add to a collection on its way (U536-01).
  const [adding, setAdding] = useState(false);
  const [warning, setWarning] = useState(false);
  const [picking, setPicking] = useState(false);
  const first = useRef<View>(null);
  const { onDoc } = props;

  const fromVault = useCallback(
    (d: DocumentView) => {
      setDoc(d);
      onDoc(d);
    },
    [onDoc],
  );
  const fetchDoc = useCallback(async () => {
    try {
      fromVault(await withToken((a, token) => a.document(token, id)));
    } catch {
      // Not now: what the list knew stands.
    } finally {
      setFetched(true);
    }
  }, [withToken, id, fromVault]);
  useEffect(() => {
    if (offline) return;
    // Asked once it opens; the state is set when the vault answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchDoc();
  }, [fetchDoc, offline]);

  const renewing = capture.queue.some((i) => i.kind === 'version' && i.target === id);
  const actions = rowActions(who, doc, { collections: caps?.features.collections === true, renewing });
  const deps: ActionDeps = {
    withToken,
    guarded,
    offline,
    keptVersion: essentials.keptVersion,
    push: (to) => router.push(to),
    away: lock.away,
  };
  const warn = (text: string) => setSaid({ tone: 'warn', text });
  const working = busy !== null || adding;
  // Back and a tap outside wait, as Done does, for what is on its way.
  const leave = () => {
    if (!working) props.onClose(true);
  };

  const run = async (action: RowAction, task: () => Promise<void>) => {
    if (busy) return;
    setSaid(null);
    setBusy(action);
    try {
      await task();
    } finally {
      setBusy(null);
    }
  };

  const doSave = () =>
    run('save', async () => {
      setWarning(false);
      if (offline) return warn(t('document.needsConnection'));
      try {
        const latest = latestOf((await withToken((a, token) => a.versions(token, id))).items);
        if (!latest) return warn(t('document.saveFailed'));
        const outcome = await saveVersion(deps, latest);
        if (typeof outcome === 'object') warn(t(outcome.failed));
        // Handed over: done with.
        else if (outcome === 'saved') props.onClose(true);
      } catch (err) {
        warn(err instanceof NetworkError ? t('document.needsConnection') : t('document.saveFailed'));
      }
    });

  const choose = (action: RowAction) => {
    switch (action) {
      case 'open':
        props.onClose(false);
        router.push({ pathname: '/document/[id]', params: { id } });
        return;
      case 'show':
        void run('show', async () => {
          const problem = await showDocument(deps, id, doc?.latest_version_id ?? null);
          if (problem) warn(t(problem));
          else props.onClose(false);
        });
        return;
      case 'save':
        // The first time, it says the copy is outside the vault's protection.
        if (!warnedAboutCopies()) setWarning(true);
        else void doSave();
        return;
      case 'version':
        void run('version', async () => {
          const outcome = await capture.renew(id);
          if (outcome === 'card') {
            props.onClose(false);
            router.push('/capture');
            return;
          }
          const words = renewWords(outcome, t);
          if (words) setSaid(words);
        });
        return;
      case 'essential':
        if (!doc) return;
        void run('essential', async () => {
          const value = !doc.is_essential;
          const outcome = await setEssential(deps, doc, value, t);
          if (outcome.kind === 'saved') {
            fromVault(outcome.doc);
            setSaid({ tone: 'ok', text: t(value ? 'row.essentialMade' : 'row.essentialTaken') });
          } else if (outcome.kind === 'conflict') {
            warn(t('document.conflict'));
            await fetchDoc();
          } else if (outcome.kind === 'failed') warn(outcome.words);
        });
        return;
      case 'collect':
        if (offline) return warn(t('document.needsConnection'));
        setSaid(null);
        setPicking(true);
        return;
    }
  };

  const label = (action: RowAction): string => {
    switch (action) {
      case 'open':
        return t('row.open');
      case 'show':
        return t('document.show');
      case 'save':
        return t('document.saveCopy');
      case 'version':
        return t('document.addVersion');
      case 'essential':
        return doc?.is_essential ? t('row.essentialOff') : t('row.essentialOn');
      case 'collect':
        return t('row.collect');
    }
  };

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={leave}
      onShow={() => focusOn(first)}
    >
      <View style={styles.scrim}>
        {/* A tap outside the sheet closes it; a screen reader has Back and Cancel. */}
        <Pressable
          testID="row-sheet-outside"
          accessible={false}
          importantForAccessibility="no"
          onPress={leave}
          style={StyleSheet.absoluteFill}
        />
        <View style={[styles.sheet, { paddingBottom: 20 + insets.bottom }]} accessibilityViewIsModal testID="row-sheet">
          <Text variant="screen">{title}</Text>
          {/* At the largest text the choices scroll rather than run off the screen. */}
          <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
            {said ? (
              <Notice tone={said.tone} testID="row-sheet-said">
                {said.text}
              </Notice>
            ) : null}
            {picking ? (
              <CollectionPicker
                id={id}
                title={title}
                role={who?.role ?? null}
                onBusy={setAdding}
                onAdded={(s) => setSaid(s)}
              />
            ) : (
              <View accessibilityRole="menu" accessibilityLabel={title} style={styles.choices}>
                {actions.map((action, i) => {
                  const Icon = action === 'essential' && doc?.is_essential ? StarOff : ICONS[action];
                  return (
                    <Choice
                      key={action}
                      ref={i === 0 ? first : undefined}
                      testID={`row-sheet-${action}`}
                      label={label(action)}
                      detail={action === 'essential' ? t('document.essentialHint') : undefined}
                      busy={busy === action}
                      // Essential is changed from the vault's copy, once it has come (U536-02).
                      disabled={busy !== null || (action === 'essential' && !offline && !fetched)}
                      onPress={() => choose(action)}
                      icon={
                        <Icon
                          color={colours.accent}
                          size={22}
                          accessibilityElementsHidden
                          importantForAccessibility="no"
                        />
                      }
                    />
                  );
                })}
              </View>
            )}
            {warning ? (
              <Notice tone="warn" announce={t('document.saveWarning')}>
                <Text testID="row-sheet-save-warning">{t('document.saveWarning')}</Text>
                <Button testID="row-sheet-save-anyway" label={t('document.saveAnyway')} onPress={() => void doSave()} />
                <Button kind="quiet" label={t('document.saveCancel')} onPress={() => setWarning(false)} />
              </Notice>
            ) : null}
          </ScrollView>
          <Button
            kind="quiet"
            label={picking || said?.tone === 'ok' ? t('row.done') : t('common.cancel')}
            disabled={working}
            onPress={leave}
            testID="row-sheet-cancel"
          />
        </View>
      </View>
    </Modal>
  );
}

function Choice({
  ref,
  ...props
}: {
  ref?: Ref<View> | undefined;
  testID: string;
  label: string;
  /** Said under the label, and read out after it. */
  detail?: string | undefined;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
  icon: ReactNode;
}) {
  return (
    <Pressable
      ref={ref}
      testID={props.testID}
      accessibilityRole="menuitem"
      accessibilityLabel={props.label}
      {...(props.detail ? { accessibilityHint: props.detail } : {})}
      accessibilityState={{ disabled: props.disabled, busy: props.busy }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [styles.choice, props.disabled ? styles.disabled : null, pressed ? styles.pressed : null]}
    >
      <View style={styles.icon}>{props.icon}</View>
      <View style={styles.label}>
        <Text weight="600" role="text">
          {props.label}
        </Text>
        {props.detail ? (
          <Text variant="secondary" tone="soft" role="text">
            {props.detail}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/**
 * Add to a collection (5.15's, on the phone): the collections this person
 * made and may still change (A18) — only a collection's maker puts things
 * in it — each with how many of its documents they can see, and where one
 * is shared outside the family, that (5.19), heard with its Add button
 * too (the web's W519-3). Those they made for people they are no longer
 * one of are said to be so, not that there are none. The vault's answer
 * says who else will now see it (5.33): a viewer the collection is given
 * to; the sheet waits for it.
 */
function CollectionPicker(props: {
  id: string;
  title: string;
  role: Role | null;
  /** An add is on its way, or done with. */
  onBusy: (busy: boolean) => void;
  onAdded: (said: Said) => void;
}) {
  const { t } = useTranslation();
  const { withToken } = useVault();
  const [data, setData] = useState<{ collections: CollectionView[]; on: Set<string> } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [all, onIt] = await withToken((a, token) =>
        Promise.all([a.collections(token), a.documentCollections(token, props.id)]),
      );
      setData({ collections: all.items, on: new Set(onIt.items.map((c) => c.id)) });
    } catch (err) {
      setProblem(wordsFor(err, t));
    }
  }, [withToken, props.id, t]);
  useEffect(() => {
    // Asked once the picker opens; the state is set when the vault answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const role = props.role;
  const mine = role ? (data?.collections ?? []).filter((c) => c.mine && inCollectionAudience(role, c.audience)) : [];
  // Made by them, for people they are no longer one of (A18): theirs to delete, not to add to.
  const outgrown = (data?.collections ?? []).filter((c) => c.mine).length - mine.length;

  const add = async (collection: CollectionView) => {
    if (adding) return;
    setAdding(collection.id);
    props.onBusy(true);
    setProblem(null);
    try {
      const after = await withToken((a, token) => a.addToCollection(token, collection.id, [props.id]));
      setData((d) =>
        d
          ? {
              collections: d.collections.map((c) => (c.id === after.id ? { ...c, item_count: after.item_count } : c)),
              on: new Set([...d.on, after.id]),
            }
          : d,
      );
      props.onAdded({
        tone: 'ok',
        text: [t('row.collected', { title: props.title, name: after.name }), ...(after.warnings ?? [])].join(' '),
      });
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 404) {
        // The collection may be what has gone: the person's collections as they are now say.
        const now = await withToken((a, token) => a.collections(token)).catch(() => null);
        if (now && !now.items.some((c) => c.id === collection.id)) {
          setData((d) => (d ? { ...d, collections: now.items } : d));
          setProblem(t('row.collectionGone', { name: collection.name }));
          return;
        }
      }
      setProblem(wordsFor(err, t));
    } finally {
      setAdding(null);
      props.onBusy(false);
    }
  };

  return (
    <View style={styles.choices} testID="row-collections">
      <Text weight="600">{t('row.collectTitle', { title: props.title })}</Text>
      {problem ? (
        <Text tone="danger" role="alert">
          {problem}
        </Text>
      ) : null}
      {data === null && !problem ? <Text tone="soft">{t('row.collectLoading')}</Text> : null}
      {data !== null && mine.length === 0 ? (
        <Text tone="soft" testID="row-collections-none">
          {outgrown > 0 ? t('row.collectOutgrown', { count: outgrown }) : t('row.collectNone')}
        </Text>
      ) : null}
      {mine.map((c) => (
        <View key={c.id} style={styles.collection} testID={`row-collection-${c.id}`}>
          <View style={styles.flex}>
            <Text weight="600">{c.name}</Text>
            <Text variant="secondary" tone="soft">
              {t('row.documents', { count: c.item_count })}
            </Text>
            {c.shared_outside ? (
              <Text variant="secondary" tone="warn">
                {sharedOutsideWords(c.shared_outside, role)}
              </Text>
            ) : null}
          </View>
          {data?.on.has(c.id) ? (
            <Text variant="secondary" tone="soft" testID={`row-collection-in-${c.id}`}>
              {t('row.collectIn')}
            </Text>
          ) : (
            <Button
              kind="quiet"
              label={t('row.collectAdd')}
              accessibilityLabel={t('row.collectAddTo', { name: c.name })}
              // Shared outside the family: said with the button, before anything goes (S536-02).
              {...(c.shared_outside ? { hint: sharedOutsideWords(c.shared_outside, role) } : {})}
              busy={adding === c.id}
              disabled={adding !== null}
              onPress={() => void add(c)}
              testID={`row-collection-add-${c.id}`}
            />
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  more: { minWidth: TAP_MIN, minHeight: TAP_MIN, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.5 },
  scrim: { flex: 1, backgroundColor: colours.scrim, justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '90%',
    backgroundColor: colours.bg,
    padding: 20,
    gap: 12,
    borderTopLeftRadius: radii.l,
    borderTopRightRadius: radii.l,
  },
  scroll: { flexGrow: 0, flexShrink: 1 },
  content: { gap: 12 },
  choices: { gap: 8 },
  choice: {
    minHeight: TAP_MIN + 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radii.m,
    borderWidth: 1,
    borderColor: colours.border,
    backgroundColor: colours.surface,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colours.accentSoft,
  },
  label: { flexShrink: 1, gap: 2 },
  collection: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1, gap: 2 },
});
