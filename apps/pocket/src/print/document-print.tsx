import { NetworkError } from '@fdv/client';
import { SENSITIVE_LABEL, type DocumentView, type Status } from '@fdv/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Switch, View } from 'react-native';
import { keptIsCurrent, type ActionDeps } from '../documents/actions';
import { openOnline } from '../documents/online';
import { exactWords, useFamilyZone } from '../state/family-time';
import { useEssentials, type OpenCopy } from '../state/essentials';
import { Button, Notice, Text } from '../ui';
import { sp } from '../ui/space';
import { useColours } from '../ui/theme';
import { documentHtml, noteHtml } from './html';
import { usePrint } from './print';

/**
 * The most pages printed of one document: its first 20. Every page is held
 * in memory as a picture inside the one page handed to the print screen,
 * so a phone is given fewer than the web's 30; a printout cut short says so.
 */
export const PRINT_PAGES_MAX = 20;

/** The pages read for printing: each picture and its number, how many it has, and which were missing. */
interface ReadPages {
  uris: string[];
  numbers: number[];
  total: number;
  missing: number[];
}

/** What the sheet of a document's details says, as its page says it. */
export interface DetailsSheet {
  kind: string | null;
  whose: string | null;
  status: Status;
  whoCanSee: string;
  sensitive: boolean;
  /** Where the original is kept, only for whom its page says it. */
  place: string | null;
  /** Its dates and its kind's own details, as its page shows them. */
  facts: readonly (readonly [string, string])[];
  noteLabel: string;
  /** Its note's words, where they are given. */
  note: string | null;
}

/** The sheet's rows, in the order its page says them. */
export function detailRows(
  s: DetailsSheet,
  words: { kind: string; whose: string; status: string; whoCanSee: string; place: string; yes: string },
): [string, string][] {
  return [
    ...(s.kind ? [[words.kind, s.kind] as [string, string]] : []),
    ...(s.whose ? [[words.whose, s.whose] as [string, string]] : []),
    [words.status, s.status.label],
    [words.whoCanSee, s.whoCanSee],
    ...(s.sensitive ? [[SENSITIVE_LABEL, words.yes] as [string, string]] : []),
    ...(s.place ? [[words.place, s.place] as [string, string]] : []),
    ...s.facts.map(([k, v]) => [k, v] as [string, string]),
  ];
}

/**
 * A note, printed (0.21.0): its title, who sees it, when its words last
 * changed, and its words. Only a note whose words are here: one waiting for
 * "Confirm it's you" is not offered.
 */
export function useNotePrint() {
  const { t } = useTranslation();
  const zone = useFamilyZone();
  const { print, foot } = usePrint();
  return async (doc: DocumentView, name: string): Promise<string | null> => {
    const lines = [
      t(`document.visibility_${doc.visibility}`),
      doc.notes_updated_at
        ? doc.notes_updated_by_name
          ? t('document.notesEditedBy', { when: exactWords(doc.notes_updated_at, zone), name: doc.notes_updated_by_name })
          : t('document.notesEdited', { when: exactWords(doc.notes_updated_at, zone) })
        : null,
    ].filter((x): x is string => !!x);
    const outcome = await print(noteHtml({ title: name, lines, words: doc.notes ?? '', foot: foot() }));
    return outcome === 'failed' ? t('print.failed') : null;
  };
}

/**
 * Print a document (0.21.0), asked in its page's ⋯ sheet: its pages, a
 * sheet of its details, or both. Its pages are those the vault drew, read
 * as its page viewer reads them — from the copy kept on this phone when it
 * is the current one, otherwise from the vault, so an Essential, an Only me
 * or a sensitive one asks "Confirm it's you" first, as looking at it does —
 * at most the first 20. A file the vault draws no pages of prints its
 * details alone, and says so. Not confirmed: nothing is printed.
 */
export function PrintDocument(props: {
  id: string;
  name: string;
  subline: string | null;
  sheet: DetailsSheet;
  /** Its newest version, for knowing whether the kept copy is current; null for none. */
  latestId: string | null;
  /** The vault draws pages of its file: not a record kept as it is. */
  drawn: boolean;
  deps: ActionDeps;
  /** Done: what to say on its page, if anything. */
  onDone: (said: { tone: 'ok' | 'warn'; text: string } | null) => void;
}) {
  const { t } = useTranslation();
  const colours = useColours();
  const essentials = useEssentials();
  const { print, foot } = usePrint();
  const [pages, setPages] = useState(props.drawn);
  const [details, setDetails] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  /** The pages as data addresses, 'unconfirmed', or what went wrong. */
  const readPages = async (): Promise<ReadPages | 'unconfirmed' | 'none' | { failed: string }> => {
    try {
      let copy: OpenCopy | 'unconfirmed' | null = null;
      let kept = false;
      if (await keptIsCurrent(props.deps, props.id, props.latestId)) {
        copy = await essentials.open(props.id, 'view');
        kept = copy !== null;
      }
      if (!copy) {
        if (props.deps.offline) return { failed: t('document.needsConnection') };
        copy = await openOnline(props.deps.withToken, props.deps.guarded, props.id);
      }
      if (copy === 'unconfirmed') return 'unconfirmed';
      if (copy === null) return { failed: t('print.pagesFailed') };
      if (copy.pages === 0) return copy.pending ? { failed: t('print.pagesPending') } : 'none';
      const out: ReadPages = { uris: [], numbers: [], total: copy.pages, missing: [] };
      for (let n = 1; n <= Math.min(copy.pages, PRINT_PAGES_MAX); n += 1) {
        const uri = await copy.page(n);
        if (uri === null) {
          // From the vault, a first page withheld was not confirmed; from the phone, it is not kept here.
          if (n === 1 && !kept) return 'unconfirmed';
          if (n === 1 && copy.pages === 1) return { failed: t('print.notOnPhone') };
          out.missing.push(n);
          continue;
        }
        out.uris.push(uri);
        out.numbers.push(n);
      }
      if (out.uris.length === 0) return { failed: kept ? t('print.notOnPhone') : t('print.pagesFailed') };
      return out;
    } catch (err) {
      return { failed: err instanceof NetworkError ? t('document.needsConnection') : t('print.pagesFailed') };
    }
  };

  const go = async () => {
    if (busy || (!pages && !details)) return;
    setBusy(true);
    setProblem(null);
    try {
      let images: ReadPages | null = null;
      let said: { tone: 'ok' | 'warn'; text: string } | null = null;
      if (pages) {
        const read = await readPages();
        if (read === 'unconfirmed') {
          // Not confirmed is an answer: nothing printed, and nothing lost.
          props.onDone({ tone: 'warn', text: t('print.notConfirmed') });
          return;
        }
        if (typeof read === 'object' && 'failed' in read) {
          setProblem(read.failed);
          return;
        }
        if (read === 'none') {
          if (!details) {
            setProblem(t('print.noPages'));
            return;
          }
          said = { tone: 'warn', text: t('print.detailsOnly') };
        } else images = read;
      }
      const sheet = props.sheet;
      // Cut short, or a page missing: said on the printout, never left out quietly.
      const pagesSaid = images
        ? [
            ...(images.total > PRINT_PAGES_MAX
              ? [t('print.pagesCut', { last: PRINT_PAGES_MAX, of: images.total })]
              : []),
            ...(images.missing.length > 0
              ? [t('print.pagesMissing', { count: images.missing.length, pages: images.missing.join(', ') })]
              : []),
          ]
        : [];
      const html = documentHtml({
        name: props.name,
        subline: props.subline,
        details: details
          ? {
              rows: detailRows(sheet, {
                kind: t('print.kind'),
                whose: t('print.whose'),
                status: t('print.status'),
                whoCanSee: t('document.whoCanSee'),
                place: t('cabinet.original'),
                yes: t('document.yes'),
              }),
              noteLabel: sheet.noteLabel,
              note: sheet.note,
            }
          : null,
        pages: images?.uris ?? [],
        pageNumbers: images?.numbers ?? [],
        total: images?.total ?? 0,
        pagesSaid,
        pageWords: (n, of) => t('print.pageOf', { n, of }),
        foot: foot(),
      });
      const outcome = await print(html);
      if (outcome === 'failed') {
        setProblem(t('print.failed'));
        return;
      }
      props.onDone(said);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.stack} testID="print-question">
      <Text variant="screen">{t('print.whatTitle')}</Text>
      {props.drawn ? (
        <View style={styles.row}>
          <View style={styles.flex}>
            <Text>{t('print.pages')}</Text>
            <Text tone="soft" variant="small">
              {t('print.pagesHint', { max: PRINT_PAGES_MAX })}
            </Text>
          </View>
          <Switch
            testID="print-pages"
            accessibilityLabel={t('print.pages')}
            value={pages}
            onValueChange={setPages}
            trackColor={{ true: colours.accent, false: colours.border }}
          />
        </View>
      ) : (
        <Text tone="soft" variant="secondary" testID="print-no-pages">
          {t('print.noPagesDrawn')}
        </Text>
      )}
      <View style={styles.row}>
        <View style={styles.flex}>
          <Text>{t('print.details')}</Text>
          <Text tone="soft" variant="small">
            {t('print.detailsHint')}
          </Text>
        </View>
        <Switch
          testID="print-details"
          accessibilityLabel={t('print.details')}
          value={details}
          onValueChange={setDetails}
          trackColor={{ true: colours.accent, false: colours.border }}
        />
      </View>
      {problem ? (
        <Notice tone="warn" testID="print-problem">
          {problem}
        </Notice>
      ) : null}
      <Button
        testID="print-go"
        label={t('print.print')}
        busy={busy}
        disabled={(!pages || !props.drawn) && !details}
        onPress={() => void go()}
      />
      <Button testID="print-cancel" kind="quiet" label={t('common.cancel')} disabled={busy} onPress={() => props.onDone(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: sp(12) },
  row: { flexDirection: 'row', alignItems: 'center', gap: sp(12), minHeight: 48 },
  flex: { flex: 1 },
});
