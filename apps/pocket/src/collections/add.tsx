import { documentName, radii, sharedOutsideWords, type CollectionDetail, type Status } from '@fdv/shared';
import { Check } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { wordsFor } from '../errors/words';
import { useVault } from '../state/vault';
import { Button, Field, Notice, StatusLine, Text } from '../ui';
import { Sheet } from '../ui/sheet';
import { sp } from '../ui/space';
import { useColours, useStyles, type Palette } from '../ui/theme';

/** One document the sheet offers. */
interface Offered {
  id: string;
  title: string;
  status: Status;
}

/** The newest documents offered before anything is typed. */
const RECENT = 20;

/**
 * Add documents (P9), for a collection's maker: the newest documents, or
 * what Search finds for the words typed, each ticked to go in; those in it
 * already are said to be. One Add puts every ticked one in, at the end, by
 * the vault's own rules, and the vault's answer — who else will now see
 * them — is said on the collection's page. A collection shared outside the
 * family says so before anything goes in, as the web does (5.19).
 */
export function AddDocuments(props: {
  collection: CollectionDetail;
  /** What the person has seen is in it already. */
  inIt: ReadonlySet<string>;
  onClose: () => void;
  onAdded: (detail: CollectionDetail, count: number) => void;
}) {
  const styles = useStyles(makeStyles);
  const colours = useColours();
  const { t } = useTranslation();
  const { withToken, who } = useVault();
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Offered[] | null>(null);
  const [ticked, setTicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const untitled = t('document.untitled');

  useEffect(() => {
    let stopped = false;
    const words = q.trim();
    // Typed words wait a moment, so each letter is not a search of its own.
    const timer = setTimeout(
      () => {
        const ask = words
          ? withToken((a, tk) => a.search(tk, words)).then((r) =>
              r.items.map((h) => ({
                id: h.document_id,
                title: documentName({ title: h.title, type_key: h.type_key }, untitled),
                status: h.status,
              })),
            )
          : withToken((a, tk) => a.documents(tk, { sort: 'recent', limit: RECENT })).then((r) =>
              r.items.map((d) => ({ id: d.id, title: documentName(d, untitled), status: d.status })),
            );
        ask
          .then((items) => {
            if (!stopped) {
              setFound(items);
              setProblem(null);
            }
          })
          .catch((err: unknown) => {
            if (!stopped) setProblem(wordsFor(err, t));
          });
      },
      words ? 300 : 0,
    );
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [q, withToken, untitled, t]);

  const toggle = (id: string) => setTicked((had) => (had.includes(id) ? had.filter((x) => x !== id) : [...had, id]));

  const add = async () => {
    if (busy || ticked.length === 0) return;
    setBusy(true);
    setProblem(null);
    try {
      const d = await withToken((a, tk) => a.addToCollection(tk, props.collection.id, ticked));
      props.onAdded(d, ticked.length);
    } catch (err) {
      setProblem(wordsFor(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible onClose={() => (busy ? undefined : props.onClose())} testID="add-documents" tall keyboard>
      <Text variant="screen">{t('collection.addTitle', { name: props.collection.name })}</Text>
      {props.collection.shared_outside ? (
        <Notice tone="warn" testID="add-documents-shared">
          {sharedOutsideWords(props.collection.shared_outside, who?.role ?? null)}
        </Notice>
      ) : null}
      <Field
        label={t('collection.find')}
        value={q}
        onChangeText={setQ}
        autoCapitalize="none"
        returnKeyType="search"
        clear={{ label: t('common.clearSearch'), onClear: () => setQ('') }}
        testID="add-documents-find"
      />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        {found === null && !problem ? (
          <Text tone="soft">{t('common.loading')}</Text>
        ) : found && found.length === 0 ? (
          <Text tone="soft" testID="add-documents-none">
            {q.trim() ? t('collection.findNone') : t('collection.nothingYet')}
          </Text>
        ) : null}
        {(found ?? []).map((d) => {
          const already = props.inIt.has(d.id);
          const on = ticked.includes(d.id);
          return (
            <Pressable
              key={d.id}
              testID={`add-documents-${d.id}`}
              accessibilityRole="checkbox"
              accessibilityLabel={already ? `${d.title}. ${t('row.collectIn')}` : d.title}
              accessibilityState={{ checked: already || on, disabled: already || busy }}
              disabled={already || busy}
              onPress={() => toggle(d.id)}
              style={({ pressed }) => [styles.choice, on ? styles.chosen : null, pressed ? styles.pressed : null]}
            >
              <View style={styles.words}>
                <Text weight="600">{d.title}</Text>
                {already ? (
                  <Text variant="secondary" tone="soft">
                    {t('row.collectIn')}
                  </Text>
                ) : (
                  <StatusLine status={d.status} />
                )}
              </View>
              <View style={[styles.box, on || already ? styles.boxOn : null]}>
                {on || already ? (
                  <Check color={colours.accent} size={18} accessibilityElementsHidden importantForAccessibility="no" />
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
      {problem ? (
        <Notice tone="warn" testID="add-documents-problem">
          {problem}
        </Notice>
      ) : null}
      <Button
        testID="add-documents-add"
        label={ticked.length > 0 ? t('collection.addCount', { count: ticked.length }) : t('collection.addNone')}
        disabled={ticked.length === 0}
        busy={busy}
        onPress={() => void add()}
      />
      <Button
        testID="add-documents-cancel"
        kind="quiet"
        label={t('common.cancel')}
        disabled={busy}
        onPress={props.onClose}
      />
    </Sheet>
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    scroll: { flexGrow: 0, maxHeight: 360 },
    list: { gap: sp(8) },
    choice: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: sp(12),
      padding: sp(12),
      minHeight: 48,
      borderRadius: radii.l,
      borderWidth: 1,
      borderColor: colours.border,
      backgroundColor: colours.surface,
    },
    chosen: { borderColor: colours.accent },
    pressed: { opacity: 0.8 },
    words: { flex: 1, gap: sp(4) },
    box: {
      width: 24,
      height: 24,
      borderRadius: radii.s,
      borderWidth: 2,
      borderColor: colours.borderInput,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // A tick on its border, not a fill: green alone would read as a status (4.17).
    boxOn: { borderColor: colours.accent },
  });
