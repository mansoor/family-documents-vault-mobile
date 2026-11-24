import { NetworkError } from '@fdv/client';
import { NOTE_KIND, SENSITIVE_LABEL, type DocumentView, type Status, type VersionView } from '@fdv/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, Switch, View } from 'react-native';
import { keptIsCurrent, type ActionDeps } from '../documents/actions';
import { openOnline } from '../documents/online';
import { wordsFor } from '../errors/words';
import { useVault } from '../state/vault';
import { documentWords, mayPrint, printable, type DocumentWords } from './document-sheet';
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

/** Its heading's line, and Sensitive after it where it is so: "Me · Passport · Adults only · Sensitive". */
export function withSensitive(line: string | null, sensitive: boolean): string | null {
  return sensitive ? [line, SENSITIVE_LABEL].filter(Boolean).join(' · ') : line;
}

/**
 * A note, printed (0.21.0): its title, its visibility, when its words last
 * changed, and its words. Only a note whose words are here: one waiting for
 * "Confirm it's you" is not offered. A Sensitive one says so under its title
 * (the owner's request of 24 Nov 2026), after the notice its page shows
 * first (`SensitivePrintNotice`).
 */
export function useNotePrint() {
  const { t } = useTranslation();
  const zone = useFamilyZone();
  const { print, foot } = usePrint();
  return async (doc: DocumentView, name: string, sensitive: boolean): Promise<string | null> => {
    const lines = [
      withSensitive(t(`document.visibility_${doc.visibility}`), sensitive),
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
 * Before anything Sensitive is printed (the owner's request of 24 Nov 2026):
 * one notice to keep the printout safe and shred it, with Print and Cancel.
 * Printing stays allowed and asks nothing more; Cancel prints nothing. A
 * note's, in its page's ⋯ sheet; a document's is said at the top of
 * `PrintDocument`, whose own Print and Cancel answer it.
 */
export function SensitivePrintNotice(props: { busy: boolean; onPrint: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.stack} testID="print-sensitive-question">
      <Text variant="screen">{t('print.sensitiveTitle')}</Text>
      <Notice tone="info" testID="print-sensitive">
        {t('print.sensitiveNotice')}
      </Notice>
      <Button testID="print-sensitive-go" label={t('print.print')} busy={props.busy} onPress={props.onPrint} />
      <Button
        testID="print-sensitive-cancel"
        kind="quiet"
        label={t('common.cancel')}
        disabled={props.busy}
        onPress={props.onCancel}
      />
    </View>
  );
}

/**
 * Print a document (0.21.0), asked in its page's ⋯ sheet: its pages, a
 * sheet of its details, or both. Its pages are those the vault drew, read
 * as its page viewer reads them — from the copy kept on this phone when it
 * is the current one, otherwise from the vault, so an Essential, an Only me
 * or a sensitive one asks "Confirm it's you" first, as looking at it does —
 * at most the first 20. A file the vault draws no pages of prints its
 * details alone, and says so. Not confirmed: nothing is printed.
 *
 * A Sensitive one says first to keep the printout safe and shred it, and
 * its heading says Sensitive, whether its pages or its details are printed.
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
  /** Cancel pressed, where it means something other than done with nothing to say (a ⋯'s sheet goes back to its choices). */
  onCancel?: () => void;
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
        // Sensitive in its heading, whatever is printed under it.
        subline: withSensitive(props.subline, sheet.sensitive),
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
      {props.sheet.sensitive ? (
        <Notice tone="info" testID="print-sensitive">
          {t('print.sensitiveNotice')}
        </Notice>
      ) : null}
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
      <Button
        testID="print-cancel"
        kind="quiet"
        label={t('common.cancel')}
        disabled={busy}
        onPress={props.onCancel ?? (() => props.onDone(null))}
      />
    </View>
  );
}

/** What came of printing, to be said where it was asked. */
type Said = { tone: 'ok' | 'warn'; text: string };

/**
 * Print from a document's ⋯ in a list — Home's Essentials and Recently
 * added, Documents, Notes — or from the ⋮ over its pages (app 0.25.0, the
 * owner's request of 24 Nov 2026): exactly what its page's Print does,
 * without going there first. The document is read as its page reads it
 * as it opens — a note that asks, after "Confirm it's you" — with its
 * versions, the household's names and the kinds, so the heading and the
 * sheet of details are its page's (`documentWords`, `printable`). Then:
 *
 *  - a document asks what to print (`PrintDocument`), Sensitive said at
 *    the top, its pages read as its page reads them;
 *  - a Sensitive note says first to keep the printout safe
 *    (`SensitivePrintNotice`); any other note is printed at once.
 *
 * Not confirmed, nothing is printed and it says so; Cancel goes back to
 * the ⋯'s choices, printing nothing. Online only, as its page's ⋯ is.
 */
export function PrintFromMenu(props: {
  id: string;
  deps: ActionDeps;
  /** Done: what to say in the ⋯'s sheet, if anything; null once printed. */
  onDone: (said: Said | null) => void;
  /** Cancelled: nothing printed. */
  onCancel: () => void;
  /** Getting it ready (fetching, "Confirm it's you"): the sheet waits for it. */
  onBusy?: (busy: boolean) => void;
}) {
  const { t } = useTranslation();
  const { caps } = useVault();
  const printNote = useNotePrint();
  const colours = useColours();
  const [ready, setReady] = useState<
    | { kind: 'document'; doc: DocumentView; versions: VersionView[]; words: DocumentWords }
    | { kind: 'note'; doc: DocumentView; words: DocumentWords }
    | null
  >(null);
  const [busy, setBusy] = useState(false);
  const live = useRef(true);
  const { id, deps, onDone, onBusy } = props;
  // Until it is here, or said why not: the sheet's Back and a tap outside wait.
  useEffect(() => {
    onBusy?.(ready === null);
    return () => onBusy?.(false);
  }, [ready, onBusy]);

  const printTheNote = useCallback(
    async (doc: DocumentView, words: DocumentWords) => {
      setBusy(true);
      const failed = await printNote(doc, words.name, words.sensitive);
      if (!live.current) return;
      setBusy(false);
      onDone(failed ? { tone: 'warn', text: failed } : null);
    },
    [printNote, onDone],
  );

  useEffect(() => {
    // This run's own: never a fetch of an earlier run printing.
    let alive = true;
    live.current = true;
    void (async () => {
      try {
        // As its page reads it as it opens: a note that asks, after "Confirm it's you".
        const got = await deps.guarded((a, tk) =>
          Promise.all([
            a.document(tk, id),
            a.versions(tk, id),
            a.members(tk).catch(() => ({ items: [] })),
            a.documentTypes(tk).catch(() => ({ items: [] })),
          ]),
        );
        if (!alive) return;
        if (got === null) return onDone({ tone: 'warn', text: t('print.notConfirmed') });
        const [doc, versions, members, types] = got;
        const words = documentWords(doc, { doc, members: members.items, types: types.items, caps, t });
        if (!mayPrint(doc)) {
          return onDone({ tone: 'warn', text: doc.type_key === NOTE_KIND ? t('print.noteEmpty') : t('caregivers.nothingHere') });
        }
        if (doc.type_key !== NOTE_KIND) {
          setReady({ kind: 'document', doc, versions: versions.items, words });
          return;
        }
        setReady({ kind: 'note', doc, words });
        // A note that isn't Sensitive is printed as it is, as from its page.
        if (!words.sensitive) await printTheNote(doc, words);
      } catch (err) {
        if (!alive) return;
        onDone({ tone: 'warn', text: err instanceof NetworkError ? t('print.needsConnection') : wordsFor(err, t) });
      }
    })();
    return () => {
      alive = false;
      live.current = false;
    };
    // Read once, as the sheet asks for it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (ready?.kind === 'document') {
    return (
      <PrintDocument
        id={id}
        {...printable(ready.doc, ready.words, ready.versions, t)}
        deps={deps}
        onDone={onDone}
        onCancel={props.onCancel}
      />
    );
  }
  if (ready?.kind === 'note' && ready.words.sensitive) {
    return (
      <SensitivePrintNotice
        busy={busy}
        onPrint={() => void printTheNote(ready.doc, ready.words)}
        onCancel={props.onCancel}
      />
    );
  }
  return (
    <View style={styles.stack} testID="print-preparing">
      <ActivityIndicator color={colours.accent} accessibilityLabel={t('print.preparing')} />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: sp(12) },
  row: { flexDirection: 'row', alignItems: 'center', gap: sp(12), minHeight: 48 },
  flex: { flex: 1 },
});
