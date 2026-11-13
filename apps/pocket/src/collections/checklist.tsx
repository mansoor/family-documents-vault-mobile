import {
  radii,
  savedItem,
  type Capabilities,
  type ChecklistItem,
  type ChecklistItemCheck,
  type CollectionChecklist,
  type Role,
} from '@fdv/shared';
import type { TFunction } from 'i18next';
import { AlertTriangle, CheckCircle2, ChevronRight, Eraser, ListChecks, MinusCircle } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { wordsFor } from '../errors/words';
import { emit } from '../state/events';
import { useVault } from '../state/vault';
import { Button, Notice, Text } from '../ui';
import { ConfirmSheet } from '../ui/confirm';
import { MenuRow } from '../ui/menu-row';
import { Sheet } from '../ui/sheet';
import { sp } from '../ui/space';
import { useColours, useStyles, type Palette } from '../ui/theme';

/**
 * A collection from a checklist on the phone (app 0.8.0; the vault's C1,
 * 0.9.0): the rules and words the collection's page and the checklist's
 * own screen share, and the kept checklist's panel on the page.
 *
 * Offered only where the vault has it (`features.collection_checklist`),
 * to the family who may read it — an owner, an adult or a teen, never a
 * viewer or a guest — so an older vault shows nothing. Only the
 * collection's maker changes it or adds from it; the vault decides
 * regardless (403), and its words are said as they are.
 */
export function checklistOffered(caps: Capabilities | null, role: Role | null | undefined): boolean {
  return caps?.features.collection_checklist === true && (role === 'owner' || role === 'adult' || role === 'teen');
}

/**
 * The checklist kept on a collection, or null: none kept, or one cleared
 * (kept with no lines), which the page shows as none, offering Fill from a
 * checklist again.
 */
export const keptChecklist = (c: CollectionChecklist | null): CollectionChecklist | null =>
  c?.saved_at && c.items.length > 0 ? c : null;

/** The items as they are kept: nothing of what was found. */
export const keptOf = (items: readonly ChecklistItem[]): string => JSON.stringify(items.map(savedItem));

/**
 * "Found 2 of 3", "Found 1 of 2; 1 more found, not added", "Not
 * understood", "Whose? Choose who it is for": a line's status in words,
 * as the web says it. Found counts only what is, or will be, in the
 * collection.
 */
export function statusWords(i: ChecklistItemCheck, t: TFunction): string {
  if (i.skipped) return t('checklist.skipped');
  if (i.problem === 'kind' || i.problem === 'years') return t('checklist.notUnderstood');
  if (i.problem) return t('checklist.whose');
  // Several found by their titles: none ticked, to choose from.
  if (i.by_title && i.found === 0 && i.found_not_added === 0) return t('checklist.chooseWhich');
  if (i.found === 0) {
    return i.found_not_added > 0 ? t('checklist.notAdded', { n: i.found_not_added }) : t('checklist.missing');
  }
  return i.found_not_added > 0
    ? t('checklist.foundOfNotAdded', { found: i.found, wanted: i.wanted, n: i.found_not_added })
    : t('checklist.foundOf', { found: i.found, wanted: i.wanted });
}

/** How a line stands: all it asks for found, something still to do, or left out. */
export function lineTone(i: ChecklistItemCheck): 'ok' | 'warn' | 'skipped' {
  if (i.skipped) return 'skipped';
  return i.understood && i.found >= i.wanted ? 'ok' : 'warn';
}

/**
 * "5 of 7 found · 2 new matches": a kept checklist in a line. Found is its
 * lines' "Found 2 of 3" added up (a line skipped asks for nothing); new
 * matches, what the vault found since that is not in the collection yet,
 * are said only to whoever may add them.
 */
export function checklistLine(kept: CollectionChecklist, mayFill: boolean, t: TFunction): string {
  let wanted = 0;
  let found = 0;
  for (const i of kept.items) {
    if (i.skipped) continue;
    wanted += i.wanted;
    found += Math.min(i.wanted, i.found);
  }
  const parts = [t('checklist.summary', { found, wanted })];
  if (mayFill && kept.to_add > 0) parts.push(t('checklist.newMatches', { count: kept.to_add }));
  return parts.join(' · ');
}

/** A line's status: an icon and its words — never a colour alone. */
export function LineStatus(props: { item: ChecklistItemCheck; testID?: string }) {
  const colours = useColours();
  const styles = useStyles(makeStyles);
  const { t } = useTranslation();
  const tone = lineTone(props.item);
  const Icon = tone === 'ok' ? CheckCircle2 : tone === 'warn' ? AlertTriangle : MinusCircle;
  const ink = tone === 'ok' ? colours.ok : tone === 'warn' ? colours.warn : colours.inkMuted;
  return (
    <View style={styles.status} testID={props.testID}>
      <Icon color={ink} size={16} accessibilityElementsHidden importantForAccessibility="no" />
      <Text variant="secondary" weight="600" style={{ color: ink }}>
        {statusWords(props.item, t)}
      </Text>
    </View>
  );
}

/** The kept checklist's lines, each as it stands, and what newly matches. */
export function ChecklistLines(props: { kept: CollectionChecklist; mayFill: boolean }) {
  const styles = useStyles(makeStyles);
  const { t } = useTranslation();
  return (
    <View style={styles.lines} testID="checklist-lines">
      {props.kept.items.map((i, n) => (
        <View key={n} style={styles.line} testID={`checklist-line-${n}`}>
          {i.heading ? (
            <Text variant="small" tone="soft">
              {i.heading}
            </Text>
          ) : null}
          <Text weight="600">{i.understood ? i.summary : i.line}</Text>
          <LineStatus item={i} />
          {i.missing.length > 0 && !i.skipped ? (
            <Text variant="secondary" tone="soft">
              {t('checklist.missingWhat', { what: i.missing.join('; ') })}
            </Text>
          ) : null}
        </View>
      ))}
      {props.mayFill && props.kept.to_add > 0 ? (
        <Notice tone="info" testID="checklist-new">
          {t('checklist.newNotice', { count: props.kept.to_add })}
        </Notice>
      ) : null}
    </View>
  );
}

/**
 * The checklist kept on a collection, on its page: one line saying how it
 * stands ("Checklist · 5 of 7 found · 2 new matches"), so the documents
 * come first, as the web folds it away. A tap shows its lines; its maker
 * goes on from there to Review and add (or Change the checklist), or
 * clears it, asked first.
 */
export function ChecklistPanel(props: {
  collection: { id: string; name: string };
  kept: CollectionChecklist;
  /** The collection's maker, online: may change it and add from it. */
  mayFill: boolean;
  onFill: () => void;
  onCleared: () => void;
}) {
  const styles = useStyles(makeStyles);
  const colours = useColours();
  const { t } = useTranslation();
  const { withToken } = useVault();
  const [open, setOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const line = checklistLine(props.kept, props.mayFill, t);

  const clear = async () => {
    setBusy(true);
    setProblem(null);
    try {
      // No lines kept is no checklist: the page offers Fill from a checklist again.
      await withToken((a, tk) => a.saveChecklist(tk, props.collection.id, []));
      setClearing(false);
      emit('checklistChanged', props.collection.id);
      props.onCleared();
    } catch (err) {
      setProblem(wordsFor(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Pressable
        testID="collection-checklist"
        accessibilityRole="button"
        accessibilityLabel={`${t('checklist.panel')}. ${line}`}
        accessibilityHint={t('checklist.panelHint')}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.panel, pressed ? styles.pressed : null]}
      >
        <ListChecks color={colours.accent} size={20} accessibilityElementsHidden importantForAccessibility="no" />
        <View style={styles.flex}>
          <Text weight="600">{t('checklist.panel')}</Text>
          <Text variant="secondary" tone="soft" testID="collection-checklist-line">
            {line}
          </Text>
        </View>
        <ChevronRight color={colours.inkSoft} size={20} accessibilityElementsHidden importantForAccessibility="no" />
      </Pressable>
      <Sheet visible={open} onClose={() => setOpen(false)} outside tall testID="collection-checklist-sheet">
        <Text variant="screen">{t('checklist.panel')}</Text>
        <ScrollView style={styles.scroll}>
          <ChecklistLines kept={props.kept} mayFill={props.mayFill} />
        </ScrollView>
        {props.mayFill ? (
          <>
            <Button
              testID="collection-checklist-review"
              label={props.kept.to_add > 0 ? t('checklist.review') : t('checklist.change')}
              onPress={() => {
                setOpen(false);
                props.onFill();
              }}
            />
            <MenuRow
              testID="collection-checklist-clear"
              icon={Eraser}
              label={t('checklist.clear')}
              danger
              onPress={() => {
                setOpen(false);
                setProblem(null);
                setClearing(true);
              }}
            />
          </>
        ) : null}
        <Button
          testID="collection-checklist-done"
          kind="quiet"
          label={t('row.done')}
          onPress={() => setOpen(false)}
        />
      </Sheet>
      <ConfirmSheet
        visible={clearing}
        testID="collection-checklist-clear-question"
        icon={Eraser}
        title={t('checklist.clearTitle')}
        words={t('checklist.clearWords', { name: props.collection.name })}
        confirmLabel={t('checklist.clear')}
        busy={busy}
        problem={problem}
        onConfirm={() => void clear()}
        onCancel={() => setClearing(false)}
        confirmID="collection-checklist-clear-yes"
        cancelID="collection-checklist-clear-cancel"
        problemID="collection-checklist-clear-problem"
      />
    </>
  );
}

/**
 * What the checklist's screen did, for the collection's page to say once
 * it is back: kept until that page takes it.
 */
const done = new Map<string, string>();

/** Said on the collection's page: what was added and kept, and who else will now see it. */
export function checklistDone(collectionId: string, words: string): void {
  done.set(collectionId, words);
  emit('checklistChanged', collectionId);
}

/** What the checklist's screen did, once; null for nothing. */
export function takeChecklistDone(collectionId: string): string | null {
  const words = done.get(collectionId) ?? null;
  done.delete(collectionId);
  return words;
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    flex: { flex: 1 },
    status: { flexDirection: 'row', alignItems: 'center', gap: sp(6) },
    lines: { gap: sp(12) },
    line: {
      gap: sp(4),
      paddingBottom: sp(12),
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colours.border,
    },
    panel: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: sp(12),
      minHeight: 48,
      paddingHorizontal: sp(14),
      paddingVertical: sp(10),
      borderRadius: radii.l,
      borderWidth: 1,
      borderColor: colours.border,
      backgroundColor: colours.surface,
    },
    pressed: { opacity: 0.8 },
    scroll: { flexGrow: 0 },
  });
