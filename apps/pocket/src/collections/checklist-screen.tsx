import type { Api } from '@fdv/client';
import {
  can,
  categoryLabel,
  CHECKLIST_COUNT_MAX,
  CHECKLIST_ITEMS_MAX,
  CHECKLIST_LINES_MAX,
  CHECKLIST_MONTHS_MAX,
  CHECKLIST_TEXT_MAX,
  checklistReadersWords,
  checklistSkipWords,
  formatDate,
  localToday,
  NOTE_KIND,
  radii,
  sentItem,
  sharedOutsideWords,
  type ChecklistAdded,
  type ChecklistItem,
  type ChecklistItemCheck,
  type ChecklistMatch,
  type CollectionChecklist,
  type CollectionDetail,
  type DocumentTypeView,
  type Member,
} from '@fdv/shared';
import { useRouter } from 'expo-router';
import { Camera, Check, ChevronDown, FileUp, ImagePlus } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { useBeginCapture } from '../capture/add-button';
import { wordsFor } from '../errors/words';
import { useCapture } from '../state/capture';
import { familyZoneNow } from '../state/family-time';
import { useVault } from '../state/vault';
import { Button, Field, Notice, Text } from '../ui';
import { EditorFrame } from '../ui/editor-frame';
import { feel } from '../ui/feel';
import { MenuRow } from '../ui/menu-row';
import { PickerSheet, type PickOption } from '../ui/picker';
import { Sheet } from '../ui/sheet';
import { sp } from '../ui/space';
import { LoadFailed, loadFailure, Placeholder } from '../ui/states';
import { useColours, useStyles, type Palette } from '../ui/theme';
import { checklistDone, checklistOffered, keptChecklist, keptOf, LineStatus } from './checklist';

/** The ids one call to add takes: the rest go in the calls after it. */
const ADD_AT_ONCE = 200;

/** What the screen needs: the collection, its kept checklist, the kinds and the family. */
interface Loaded {
  collection: CollectionDetail;
  kept: CollectionChecklist;
  types: DocumentTypeView[];
  members: Member[];
}

/** Which of a line's choices is being made, in the one picker the screen has. */
type Picking = { n: number; what: 'kind' | 'whose' | 'count' } | null;

/** "How many", as the picker says it: the most recent, the last N, each of the last N months. */
function howMany(i: ChecklistItem): string {
  if (i.months !== null) return `m:${i.months}`;
  if (i.count !== null) return `n:${i.count}`;
  return '';
}

/**
 * Fill from a checklist (app 0.8.0), as the web does it (the vault's C1):
 * paste or type the list a family was given; the vault reads it with plain
 * rules and says back what it understood of each line, with the documents
 * it found — ticked, with their title, date and whose — and what is
 * missing. A line it could not read is opened to choose its kind, whose
 * and how many, or to skip it. Nothing goes in until Add, asked first, and
 * then only what is ticked; the list is kept on the collection either way.
 * A missing paper can be scanned or added from here, and is found once it
 * is in the vault. Cancel and Save are one row at the foot (EditorFrame);
 * leaving with something changed asks first.
 */
export function ChecklistScreen(props: { id: string }) {
  const { id } = props;
  const styles = useStyles(makeStyles);
  const { t } = useTranslation();
  const router = useRouter();
  const { withToken, caps, who } = useVault();
  const capture = useCapture();
  const { begin } = useBeginCapture();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [read, setRead] = useState<CollectionChecklist | null>(null);
  /** Ticks the person changed, by document: over what the vault ticked. */
  const [ticks, setTicks] = useState<Map<string, boolean>>(new Map());
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  /** The lines opened to change: kept open while they are changed. */
  const [editing, setEditing] = useState<Set<number>>(new Set());
  const [picking, setPicking] = useState<Picking>(null);
  /** Something read, changed or ticked here: leaving asks first. */
  const [touched, setTouched] = useState(false);
  /** Add, asked first: answered with where to go, or nothing to stay. */
  const [asking, setAsking] = useState<{ answer: (go: (() => void) | null) => void } | null>(null);
  /** A missing paper to scan or add. */
  const [adding, setAdding] = useState<string | null>(null);
  const offered = checklistOffered(caps, who?.role);

  const load = useCallback(async () => {
    try {
      const [collection, kept, types, members] = await withToken((a, tk) =>
        Promise.all([a.getCollection(tk, id), a.collectionChecklist(tk, id), a.documentTypes(tk), a.members(tk)]),
      );
      setLoaded({ collection, kept, types: types.items, members: members.items });
      setRead(keptChecklist(kept));
      setFailed(null);
    } catch (err) {
      setFailed(loadFailure('checklist', err, t) ?? t('collections.needsConnection'));
    }
  }, [withToken, id, t]);

  useEffect(() => {
    if (!offered) return;
    // Loaded on arrival; the state is set once the vault answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, offered]);

  /** The vault's answer, with what went wrong said in its words (a 403, a 503 checklist_unavailable). */
  const run = async <T,>(what: string, fn: (a: Api, tk: string) => Promise<T>): Promise<{ value: T } | null> => {
    setBusy(what);
    setProblem(null);
    try {
      return { value: await withToken(fn) };
    } catch (err) {
      setProblem(wordsFor(err, t));
      return null;
    } finally {
      setBusy(null);
    }
  };

  const readList = async () => {
    if (!text.trim()) {
      setProblem(t('checklist.empty'));
      return;
    }
    const answer = await run(t('checklist.reading'), (a, tk) => a.checkChecklist(tk, id, { text }));
    if (!answer) return;
    setRead(answer.value);
    setTicks(new Map());
    setEditing(new Set());
    setTouched(true);
  };

  /** The items matched again, as they now stand: a line changed, or a paper newly in the vault. */
  const again = async (items: ChecklistItem[]) => {
    const answer = await run(t('checklist.looking'), (a, tk) => a.checkChecklist(tk, id, { items }));
    if (answer) setRead(answer.value);
  };

  /** A line changed by the person: matched again, nothing kept yet; the line stays open. */
  const change = (n: number, edit: Partial<ChecklistItem>) => {
    if (!read) return;
    setEditing((e) => new Set(e).add(n));
    setTouched(true);
    void again(read.items.map((i, k) => sentItem(k === n ? { ...i, ...edit } : i)));
  };

  // A paper scanned or added from here, sent to the vault: looked for again.
  const waiting = capture.queue.length;
  const lastWaiting = useRef(waiting);
  const looksAfterSend = useRef(false);
  useEffect(() => {
    const was = lastWaiting.current;
    lastWaiting.current = waiting;
    if (waiting < was && looksAfterSend.current && read?.items.length) {
      void again(read.items.map(sentItem));
    }
    // Only as the queue shrinks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting]);

  if (!offered) {
    return (
      <View style={styles.page} testID="checklist">
        <Notice tone="warn">{t('checklist.notOffered')}</Notice>
      </View>
    );
  }
  if (!loaded) {
    return (
      <View style={styles.page} testID="checklist">
        {failed ? <LoadFailed words={failed} onRetry={() => void load()} /> : <Placeholder rows={3} />}
      </View>
    );
  }

  const { collection, kept } = loaded;
  const name = collection.name;
  const mine = kept.mine;
  const shared = collection.shared_outside ?? null;
  const people = who?.role === 'teen' ? loaded.members.filter((m) => m.is_me) : loaded.members;
  // Nor a note: written, never a paper asked for.
  const kinds = loaded.types.filter((k) => !k.hidden && k.key !== 'other' && k.key !== NOTE_KIND);
  const mayAddPapers = !!who && can(who.role, 'document.add');

  const ticked = (m: ChecklistMatch) => (m.in_collection ? false : (ticks.get(m.document_id) ?? m.ticked));
  const chosen = read
    ? [
        ...new Set(
          read.items
            .filter((i) => !i.skipped && i.understood)
            .flatMap((i) => i.matches.filter(ticked).map((m) => m.document_id)),
        ),
      ]
    : [];

  /** The list kept on the collection, as it now stands, and only when it has changed. */
  const keep = async (a: Api, tk: string) => {
    const items = (read?.items ?? []).map(sentItem);
    const before = keptChecklist(kept);
    if (before && keptOf(before.items) === keptOf(items)) return;
    await a.saveChecklist(tk, id, items);
  };

  const addAll = async (): Promise<(() => void) | null> => {
    const answer = await run(t('checklist.adding'), async (a, tk) => {
      await keep(a, tk);
      const all: Omit<ChecklistAdded, 'collection'> = { added: [], skipped: [], warnings: [] };
      for (let i = 0; i < chosen.length; i += ADD_AT_ONCE) {
        const one = await a.addFromChecklist(tk, id, chosen.slice(i, i + ADD_AT_ONCE));
        all.added.push(...one.added);
        all.skipped.push(...one.skipped);
        for (const w of one.warnings) if (!all.warnings.includes(w)) all.warnings.push(w);
      }
      return all;
    });
    if (!answer) return null;
    const { added, skipped, warnings } = answer.value;
    const why = [...new Set(skipped.map((s) => checklistSkipWords(s.why)))];
    const said = [
      added.length > 0
        ? t('checklist.doneAdded', { count: added.length, name })
        : t('checklist.doneNothing', { name }),
      skipped.length > 0 ? t('checklist.doneSkipped', { count: skipped.length, why: why.join('; ') }) : '',
      t('checklist.doneKept'),
      ...warnings,
    ]
      .filter(Boolean)
      .join(' ');
    feel('done');
    checklistDone(id, said);
    return () => router.back();
  };

  const keepOnly = async (): Promise<(() => void) | null> => {
    const answer = await run(t('checklist.keeping'), async (a, tk) => {
      await keep(a, tk);
      return true;
    });
    if (!answer) return null;
    checklistDone(id, t('checklist.keptOnly', { name }));
    return () => router.back();
  };

  /** Save: with documents ticked, asked first (add them, or keep the list alone); else the list kept. */
  const save = (): Promise<(() => void) | null> => {
    if (!read || !mine) return Promise.resolve(null);
    if (chosen.length === 0) return keepOnly();
    setProblem(null);
    return new Promise((answer) => setAsking({ answer }));
  };
  const answer = (go: (() => void) | null) => {
    asking?.answer(go);
    setAsking(null);
  };

  const scan = async (how: 'scan' | 'file' | 'photo') => {
    setAdding(null);
    looksAfterSend.current = true;
    await begin(how);
  };

  // The one picker: a line's kind, whose, or how many.
  const item = picking ? read?.items[picking.n] : undefined;
  const pick: { title: string; options: PickOption[]; chosen: string[]; find: boolean } | null =
    picking && item
      ? picking.what === 'kind'
        ? {
            title: t('checklist.kind'),
            options: kinds
              .map((k) => ({ value: k.key, label: k.label, group: categoryLabel(k.category) }))
              .sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label)),
            chosen: item.type_key ? [item.type_key] : [],
            find: true,
          }
        : picking.what === 'whose'
          ? {
              title: t('checklist.whoseLabel'),
              options: [
                { value: 'anyone', label: t('checklist.anyone') },
                ...(item.problem === 'person_shared' && item.person_choices.length > 0
                  ? people.filter((p) => item.person_choices.includes(p.id))
                  : people
                ).map((p) => ({ value: p.id, label: p.display_name })),
              ],
              chosen: item.member_id ? [item.member_id] : item.problem?.startsWith('person') ? [] : ['anyone'],
              find: false,
            }
          : {
              title: t('checklist.howMany'),
              options: [
                { value: '', label: item.years.length > 0 ? t('checklist.eachYear') : t('checklist.mostRecent') },
                ...Array.from({ length: CHECKLIST_COUNT_MAX - 1 }, (_, k) => ({
                  value: `n:${k + 2}`,
                  label: t('checklist.lastN', { n: k + 2 }),
                })),
                ...Array.from({ length: CHECKLIST_MONTHS_MAX }, (_, k) => ({
                  value: `m:${k + 1}`,
                  label: k === 0 ? t('checklist.thisMonth') : t('checklist.eachMonth', { n: k + 1 }),
                })),
              ],
              chosen: [howMany(item)],
              find: true,
            }
      : null;
  const picked = (value: string) => {
    if (!picking) return;
    const { n, what } = picking;
    setPicking(null);
    if (what === 'kind') change(n, { type_key: value || null });
    else if (what === 'whose') change(n, { member_id: value === 'anyone' ? null : value, unresolved: null });
    else {
      const [how, k] = value.split(':');
      const nth = k ? Number(k) : null;
      change(n, { count: how === 'n' ? nth : null, months: how === 'm' ? nth : null, within: null, in_months: [] });
    }
  };

  const saveLabel = !read ? t('checklist.keep') : chosen.length > 0 ? t('checklist.addFound', { count: chosen.length }) : t('checklist.keep');
  return (
    <EditorFrame
      testID="checklist"
      changed={touched}
      busy={busy !== null}
      save={{ testID: 'checklist-save', label: saveLabel, disabled: !read || !mine, onPress: save }}
      cancelID="checklist-cancel"
    >
      <Text variant="hero">{t('checklist.title', { name })}</Text>
      {shared ? (
        <Notice tone="warn" testID="checklist-shared">
          {sharedOutsideWords(shared, who?.role ?? null)}
        </Notice>
      ) : null}
      {mine ? (
        <>
          <Text variant="secondary" tone="soft">
            {checklistReadersWords(collection.audience)}
          </Text>
          <View style={styles.section}>
            <Field
              label={t('checklist.list')}
              value={text}
              onChangeText={(v) => {
                setText(v);
                setTouched(true);
              }}
              multiline
              textAlignVertical="top"
              maxLength={CHECKLIST_TEXT_MAX}
              autoCapitalize="sentences"
              numberOfLines={5}
              testID="checklist-text"
            />
            <Text variant="secondary" tone="soft">
              {t('checklist.listHint')}
            </Text>
            <Button
              testID="checklist-read"
              kind={read ? 'quiet' : 'primary'}
              label={read ? t('checklist.readAgain') : t('checklist.read')}
              disabled={busy !== null}
              onPress={() => void readList()}
            />
          </View>
        </>
      ) : (
        <Notice tone="warn" testID="checklist-not-mine">
          {t(caps?.features.collection_managers === true ? 'checklist.notMineManagers' : 'checklist.notMine')}
        </Notice>
      )}
      <View accessibilityLiveRegion="polite">
        {busy ? (
          <Text variant="secondary" tone="soft" testID="checklist-busy">
            {busy}
          </Text>
        ) : null}
      </View>
      {problem && !asking ? (
        <Notice tone="warn" testID="checklist-problem">
          {problem}
        </Notice>
      ) : null}
      {read ? (
        <View style={styles.section} testID="checklist-review">
          <Text variant="screen" role="header">
            {t('checklist.found')}
          </Text>
          {read.left_out > 0 ? (
            <Text variant="secondary" tone="soft">
              {t('checklist.leftOut', { count: read.left_out, lines: CHECKLIST_LINES_MAX, items: CHECKLIST_ITEMS_MAX })}
            </Text>
          ) : null}
          {read.items.length === 0 ? (
            <Text tone="soft" testID="checklist-no-lines">
              {t('checklist.noLines')}
            </Text>
          ) : null}
          {read.items.map((i, n) => (
            <ChecklistRow
              key={n}
              n={n}
              item={i}
              members={loaded.members}
              kinds={kinds}
              mine={mine}
              busy={busy !== null}
              editing={mine && (editing.has(n) || (!i.understood && !i.skipped))}
              ticked={ticked}
              onTick={(docId, on) => {
                setTicks((had) => new Map(had).set(docId, on));
                setTouched(true);
              }}
              onEdit={() => setEditing((e) => new Set(e).add(n))}
              onPick={(what) => setPicking({ n, what })}
              onChange={(edit) => change(n, edit)}
              onAdd={mine && mayAddPapers ? (what) => setAdding(what) : null}
            />
          ))}
        </View>
      ) : null}
      {pick ? (
        <PickerSheet
          visible
          title={pick.title}
          options={pick.options}
          chosen={pick.chosen}
          onDone={([v]) => picked(v ?? '')}
          onClose={() => setPicking(null)}
          testID="checklist-picker"
          {...(pick.find ? { findID: 'checklist-picker-find' } : {})}
          optionID="checklist-pick"
        />
      ) : null}
      <Sheet
        visible={asking !== null}
        onClose={() => (busy ? undefined : answer(null))}
        testID="checklist-add-question"
      >
        <Text variant="screen">{t('checklist.confirmTitle', { count: chosen.length, name })}</Text>
        <Text variant="secondary">{t('checklist.confirmWords')}</Text>
        {shared ? <Notice tone="warn">{sharedOutsideWords(shared, who?.role ?? null)}</Notice> : null}
        {problem ? (
          <Notice tone="warn" testID="checklist-add-problem">
            {problem}
          </Notice>
        ) : null}
        <Button
          testID="checklist-add-yes"
          label={t('checklist.confirmYes', { count: chosen.length })}
          busy={busy === t('checklist.adding')}
          disabled={busy !== null}
          onPress={() => void addAll().then((go) => go && answer(go))}
        />
        <Button
          testID="checklist-keep-only"
          kind="quiet"
          label={t('checklist.keepOnly')}
          disabled={busy !== null}
          onPress={() => void keepOnly().then((go) => go && answer(go))}
        />
        <Button
          testID="checklist-add-cancel"
          kind="quiet"
          label={t('common.cancel')}
          disabled={busy !== null}
          onPress={() => answer(null)}
        />
      </Sheet>
      <Sheet visible={adding !== null} onClose={() => setAdding(null)} outside testID="checklist-capture">
        <Text variant="screen">{t('checklist.addTitle', { what: adding ?? '' })}</Text>
        <Text variant="secondary" tone="soft">
          {t('checklist.addWords')}
        </Text>
        {capture.scanner.scans ? (
          <MenuRow testID="checklist-capture-camera" icon={Camera} label={t('add.camera')} onPress={() => void scan('scan')} />
        ) : null}
        <MenuRow testID="checklist-capture-file" icon={FileUp} label={t('add.file')} onPress={() => void scan('file')} />
        <MenuRow
          testID="checklist-capture-picture"
          icon={ImagePlus}
          label={t('add.picture')}
          onPress={() => void scan('photo')}
        />
        <Button testID="checklist-capture-cancel" kind="quiet" label={t('common.cancel')} onPress={() => setAdding(null)} />
      </Sheet>
    </EditorFrame>
  );
}

/** One line of the list: what was understood, how it stands, what was found, and what is missing. */
function ChecklistRow(props: {
  n: number;
  item: ChecklistItemCheck;
  members: readonly Member[];
  kinds: readonly DocumentTypeView[];
  mine: boolean;
  busy: boolean;
  editing: boolean;
  ticked: (m: ChecklistMatch) => boolean;
  onTick: (documentId: string, on: boolean) => void;
  onEdit: () => void;
  onPick: (what: 'kind' | 'whose' | 'count') => void;
  onChange: (edit: Partial<ChecklistItem>) => void;
  /** Scan or add a missing paper; null where the person may not. */
  onAdd: ((what: string) => void) | null;
}) {
  const styles = useStyles(makeStyles);
  const colours = useColours();
  const { t } = useTranslation();
  const { item, n } = props;
  const id = `checklist-item-${n}`;
  const kind = props.kinds.find((k) => k.key === item.type_key)?.label ?? t('checklist.chooseKind');
  const whose = item.member_id
    ? (props.members.find((m) => m.id === item.member_id)?.display_name ?? t('checklist.chooseWho'))
    : item.problem?.startsWith('person')
      ? t('checklist.chooseWho')
      : t('checklist.anyone');
  const count =
    item.months !== null
      ? item.months === 1
        ? t('checklist.thisMonth')
        : t('checklist.eachMonth', { n: item.months })
      : item.count !== null
        ? t('checklist.lastN', { n: item.count })
        : item.years.length > 0
          ? t('checklist.eachYear')
          : t('checklist.mostRecent');
  const zone = familyZoneNow();
  const matchWords = (m: ChecklistMatch) => {
    const when = m.issued
      ? formatDate(m.issued)
      : t('checklist.addedOn', {
          date: formatDate({ date: localToday(zone, new Date(m.added_at)), precision: 'day' }),
        });
    const owner = props.members.find((p) => p.id === m.owner_member_id)?.display_name;
    return [m.title ?? t('document.untitled'), when, owner].filter(Boolean).join(' · ');
  };
  return (
    <View style={styles.item} testID={id}>
      <View style={styles.itemHead}>
        <View style={styles.flex}>
          <Text weight="600">{item.understood ? item.summary : item.line}</Text>
          {item.understood ? (
            <Text variant="secondary" tone="soft">
              {`“${item.line}”`}
            </Text>
          ) : null}
        </View>
        {props.mine && !props.editing ? (
          <Button
            testID={`${id}-change`}
            kind="quiet"
            size="small"
            label={t('checklist.changeLine')}
            accessibilityLabel={t('checklist.changeLineSaid', { line: item.line })}
            disabled={props.busy}
            onPress={props.onEdit}
          />
        ) : null}
      </View>
      <LineStatus item={item} testID={`${id}-status`} />
      {item.note ? (
        <Text variant="secondary" tone="soft">
          {item.note}
        </Text>
      ) : null}
      {props.editing ? (
        <View style={styles.edit}>
          <Choice testID={`${id}-kind`} label={t('checklist.kind')} value={kind} disabled={props.busy} onPress={() => props.onPick('kind')} />
          <Choice
            testID={`${id}-whose`}
            label={t('checklist.whoseLabel')}
            value={whose}
            disabled={props.busy}
            onPress={() => props.onPick('whose')}
          />
          <Choice
            testID={`${id}-count`}
            label={t('checklist.howMany')}
            value={count}
            disabled={props.busy}
            onPress={() => props.onPick('count')}
          />
          <View style={styles.switchRow}>
            <Text weight="600" style={styles.flex}>
              {t('checklist.skip')}
            </Text>
            <Switch
              testID={`${id}-skip`}
              accessibilityLabel={t('checklist.skip')}
              value={item.skipped}
              disabled={props.busy}
              onValueChange={(v) => props.onChange({ skipped: v })}
              trackColor={{ true: colours.accent, false: colours.borderInput }}
            />
          </View>
        </View>
      ) : null}
      {!item.skipped && item.matches.length > 0 ? (
        <View style={styles.matches} accessibilityLabel={t('checklist.matchesFor', { line: item.line })}>
          {item.matches.map((m) => {
            const on = props.ticked(m);
            const words = matchWords(m);
            const also = [
              m.in_collection ? t('checklist.already') : null,
              !m.chosen && !m.in_collection ? t('checklist.another') : null,
            ].filter(Boolean);
            const locked = m.in_collection || !props.mine || props.busy;
            return (
              <Pressable
                key={m.document_id}
                testID={`${id}-match-${m.document_id}`}
                accessibilityRole="checkbox"
                accessibilityLabel={[words, ...also, m.note].filter(Boolean).join('. ')}
                accessibilityState={{ checked: on || m.in_collection, disabled: locked }}
                disabled={locked}
                onPress={() => props.onTick(m.document_id, !on)}
                style={({ pressed }) => [styles.match, on ? styles.matchOn : null, pressed ? styles.pressed : null]}
              >
                <View style={styles.flex}>
                  <Text variant="secondary" weight="600">
                    {words}
                  </Text>
                  {also.length > 0 ? (
                    <Text variant="small" tone="soft">
                      {also.join(' · ')}
                    </Text>
                  ) : null}
                  {m.note ? (
                    <Text variant="small" tone="warn">
                      {m.note}
                    </Text>
                  ) : null}
                </View>
                <View style={[styles.box, on || m.in_collection ? styles.boxOn : null]}>
                  {on || m.in_collection ? (
                    <Check color={colours.accent} size={18} accessibilityElementsHidden importantForAccessibility="no" />
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {!item.skipped && item.missing.length > 0 ? (
        <View style={styles.missing}>
          <Text variant="secondary" tone="soft" style={styles.flex} testID={`${id}-missing`}>
            {t('checklist.missingWhat', { what: item.missing.join('; ') })}
          </Text>
          {props.onAdd ? (
            <Button
              testID={`${id}-add`}
              kind="quiet"
              size="small"
              label={t('checklist.addIt')}
              accessibilityLabel={t('checklist.addItSaid', { what: item.missing.join('; ') })}
              disabled={props.busy}
              onPress={() => props.onAdd?.(item.missing[0] ?? item.line)}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** One of a line's choices: its name, what it is now, and a tap to choose another. */
function Choice(props: { testID: string; label: string; value: string; disabled: boolean; onPress: () => void }) {
  const styles = useStyles(makeStyles);
  const colours = useColours();
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="button"
      accessibilityLabel={`${props.label}: ${props.value}`}
      accessibilityState={{ disabled: props.disabled }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [styles.choice, pressed ? styles.pressed : null]}
    >
      <Text variant="secondary" weight="600" tone="soft" style={styles.choiceLabel}>
        {props.label}
      </Text>
      <Text style={styles.flex} numberOfLines={1}>
        {props.value}
      </Text>
      <ChevronDown color={colours.inkSoft} size={18} accessibilityElementsHidden importantForAccessibility="no" />
    </Pressable>
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    page: { flex: 1, padding: sp(20), backgroundColor: colours.bg },
    flex: { flex: 1 },
    section: { gap: sp(10) },
    item: {
      gap: sp(8),
      padding: sp(12),
      borderRadius: radii.l,
      borderWidth: 1,
      borderColor: colours.border,
      backgroundColor: colours.surface,
    },
    itemHead: { flexDirection: 'row', alignItems: 'flex-start', gap: sp(8) },
    edit: { gap: sp(8) },
    choice: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: sp(10),
      minHeight: 48,
      paddingHorizontal: sp(12),
      borderRadius: radii.m,
      borderWidth: 1,
      borderColor: colours.borderInput,
      backgroundColor: colours.bg,
    },
    choiceLabel: { minWidth: 72 },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: sp(12), minHeight: 48 },
    matches: { gap: sp(6) },
    match: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: sp(12),
      minHeight: 48,
      paddingHorizontal: sp(12),
      paddingVertical: sp(8),
      borderRadius: radii.m,
      borderWidth: 1,
      borderColor: colours.border,
      backgroundColor: colours.bg,
    },
    matchOn: { borderColor: colours.accent },
    pressed: { opacity: 0.8 },
    box: {
      width: 24,
      height: 24,
      borderRadius: radii.s,
      borderWidth: 2,
      borderColor: colours.borderInput,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // A tick on its border, not a fill: green alone would read as a status.
    boxOn: { borderColor: colours.accent },
    missing: { flexDirection: 'row', alignItems: 'center', gap: sp(8) },
  });
