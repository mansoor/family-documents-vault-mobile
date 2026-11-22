import {
  documentName,
  type CollectionDetail,
  formatDate,
  whereKeptWords,
  type CollectionItemView,
  type DocumentTypeView,
  type DocumentView,
  type Member,
} from '@fdv/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Switch, View } from 'react-native';
import { wordsFor } from '../errors/words';
import { useVault } from '../state/vault';
import { Button, Notice, Text } from '../ui';
import { sp } from '../ui/space';
import { useColours } from '../ui/theme';
import { shownColumns, tableHtml } from './html';
import { usePrint } from './print';

/** The columns a collection prints, in order: the name first. */
export type CollectionColumn = 'name' | 'kind' | 'whose' | 'issued' | 'expires' | 'status' | 'where';
export const COLLECTION_COLUMNS: readonly CollectionColumn[] = ['name', 'kind', 'whose', 'issued', 'expires', 'status', 'where'];

/** One document as a row of words; a column nobody is told (where it is kept) is left empty, and so out. */
export function collectionRow(
  d: DocumentView,
  names: { types: readonly DocumentTypeView[]; members: readonly Member[]; untitled: string; household: string },
): string[] {
  const kind = names.types.find((x) => x.key === d.type_key)?.label ?? '';
  const whose =
    names.members.find((m) => m.id === d.owner_member_id)?.display_name ?? (d.household_owned ? names.household : '');
  return [
    documentName(d, names.untitled),
    kind,
    whose,
    d.issued ? formatDate(d.issued) : '',
    d.expires ? formatDate(d.expires) : '',
    d.status.label,
    whereKeptWords(d) ?? '',
  ];
}

/**
 * A collection's contents, printed as a table (0.21.0): everything in it the
 * reader is given — every page of it, fetched first — with its name, kind,
 * whose it is, its dates, its status and where it is kept, the columns
 * nobody is told left out; and, if chosen, a box to tick beside each.
 */
export function PrintCollection(props: { id: string; name: string; onDone: (failed: string | null) => void }) {
  const { t } = useTranslation();
  const colours = useColours();
  const { withToken } = useVault();
  const { print, foot } = usePrint();
  const [tick, setTick] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const go = async () => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const items: CollectionItemView[] = [];
      let cursor: string | null = null;
      // Every page of it: a collection gives its documents 50 at a time.
      for (let guard = 0; guard < 200; guard += 1) {
        const at: string | null = cursor;
        const page: CollectionDetail = await withToken((a, tk) => a.getCollection(tk, props.id, at ? { cursor: at } : {}));
        items.push(...page.items);
        if (!page.has_more || !page.next_cursor) break;
        cursor = page.next_cursor;
      }
      const [types, members] = await withToken((a, tk) =>
        Promise.all([a.documentTypes(tk).catch(() => ({ items: [] })), a.members(tk).catch(() => ({ items: [] }))]),
      );
      const names = {
        types: types.items,
        members: members.items,
        untitled: t('document.untitled'),
        household: t('capture.household'),
      };
      const words: Record<CollectionColumn, string> = {
        name: t('print.colName'),
        kind: t('print.colKind'),
        whose: t('print.colWhose'),
        issued: t('print.colIssued'),
        expires: t('print.colExpires'),
        status: t('print.colStatus'),
        where: t('print.colWhere'),
      };
      const table = shownColumns(
        COLLECTION_COLUMNS.map((c) => words[c]),
        items.map((i) => collectionRow(i.document, names)),
      );
      const outcome = await print(
        tableHtml({
          title: props.name,
          said: [],
          columns: table.columns,
          rows: table.rows,
          tick: tick ? t('print.tickColumn') : null,
          none: t('print.nothingIn'),
          foot: foot(),
        }),
      );
      if (outcome === 'failed') setProblem(t('print.failed'));
      else props.onDone(null);
    } catch (err) {
      setProblem(wordsFor(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.stack} testID="collection-print-question">
      <Text variant="screen">{t('print.collectionTitle')}</Text>
      <Text tone="soft" variant="secondary">
        {t('print.collectionLede')}
      </Text>
      <View style={styles.row}>
        <View style={styles.flex}>
          <Text>{t('print.tick')}</Text>
          <Text tone="soft" variant="small">
            {t('print.tickHint')}
          </Text>
        </View>
        <Switch
          testID="collection-print-tick"
          accessibilityLabel={t('print.tick')}
          value={tick}
          onValueChange={setTick}
          trackColor={{ true: colours.accent, false: colours.border }}
        />
      </View>
      {problem ? (
        <Notice tone="warn" testID="collection-print-problem">
          {problem}
        </Notice>
      ) : null}
      <Button testID="collection-print-go" label={t('print.print')} busy={busy} onPress={() => void go()} />
      <Button
        testID="collection-print-cancel"
        kind="quiet"
        label={t('common.cancel')}
        disabled={busy}
        onPress={() => props.onDone(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: sp(12) },
  row: { flexDirection: 'row', alignItems: 'center', gap: sp(12), minHeight: 48 },
  flex: { flex: 1 },
});
