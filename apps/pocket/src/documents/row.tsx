import { documentName, NOTE_KIND, radii, statusTone, type DocumentView, type Status } from '@fdv/shared';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { FileText, NotebookText } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text as RNText, View } from 'react-native';
import { StatusLine, Text } from '../ui';
import { font } from '../ui/fonts';
import { useDocumentMenu, type RemoveFrom } from './menu';
import { ROW } from '../ui/scale';
import { snippetParts } from './snippet';
import { sp } from '../ui/space';
import { useColours, useStyles, type Palette } from '../ui/theme';

/**
 * One document in a list (4.12), the same in every list (P1): its picture,
 * its name and status, and — from a search — where it matched, in bold. It
 * opens the document; its ⋯, or a long press, opens what may be done with
 * it (5.36). A list that knows the document's newest version shows its
 * picture; a search hit does not, and shows what kind of thing it is.
 */
export function DocumentRow(props: {
  id: string;
  title: string | null;
  /** Its kind, and a note's first words (0.9.0): a note with no title is named by them. */
  type_key?: string | null;
  note_name?: string | undefined;
  status: Status;
  snippet?: string;
  /** What the list knows of it already: a search hit has none, and its ⋯ asks. */
  doc?: DocumentView;
  /** Its newest version's picture, and the token to fetch it with. */
  thumb?: { uri: string; token: string } | null;
  /** What it is called with no title (Home says it needs a name). */
  untitled?: string;
  /** On a collection's page, for its maker: Remove from this collection in its ⋯ (P9). */
  remove?: RemoveFrom;
  /** Where it sits in its list, which is drawn as one card (R1): `rowPlace`. Alone, a card of its own. */
  place?: RowPlace;
}) {
  const colours = useColours();
  const styles = useStyles(makeStyles);
  const { t } = useTranslation();
  const router = useRouter();
  const title = documentName(
    { title: props.title, type_key: props.type_key ?? null, note_name: props.note_name },
    props.untitled ?? t('document.untitled'),
  );
  const note = props.type_key === NOTE_KIND;
  const Kind = note ? NotebookText : FileText;
  const menu = useDocumentMenu({ id: props.id, title, doc: props.doc ?? null, remove: props.remove });
  // Read out as it is shown: its name, its status, and where it matched.
  const said = [
    title,
    statusTone(props.status)?.words,
    props.snippet ? snippetParts(props.snippet).map((p) => p.text).join('') : null,
  ]
    .filter(Boolean)
    .join('. ');
  return (
    <View style={[styles.row, styles[props.place ?? 'only']]}>
      <Pressable
        testID={`doc-row-${props.id}`}
        accessibilityRole="button"
        accessibilityLabel={said}
        onPress={() => router.push({ pathname: '/document/[id]', params: { id: props.id } })}
        onLongPress={menu.open}
        style={({ pressed }) => [styles.main, pressed ? styles.pressed : null]}
      >
        <View style={styles.thumb}>
          {props.thumb ? (
            <Image
              source={{ uri: props.thumb.uri, headers: { authorization: `Bearer ${props.thumb.token}` } }}
              // Held in memory only: a document's picture never lands in the
              // phone's disk cache.
              cachePolicy="memory"
              style={styles.thumbImage}
              contentFit="cover"
              accessibilityIgnoresInvertColors
            />
          ) : (
            <Kind color={colours.accent} size={18} accessibilityElementsHidden importantForAccessibility="no" />
          )}
        </View>
        <View style={styles.words}>
        <Text weight="600">{title}</Text>
        <StatusLine status={props.status} />
        {props.snippet ? (
          <Text variant="secondary" tone="soft" testID={`snippet-${props.id}`}>
            {snippetParts(props.snippet).map((part, i) =>
              part.bold ? (
                <RNText key={i} style={styles.bold}>
                  {part.text}
                </RNText>
              ) : (
                part.text
              ),
            )}
          </Text>
        ) : null}
        </View>
      </Pressable>
      {menu.button}
      {menu.sheet}
    </View>
  );
}

export type RowPlace = 'only' | 'first' | 'middle' | 'last';

/** Where the row at `index` of `count` sits in its card. */
export function rowPlace(index: number, count: number): RowPlace {
  if (count <= 1) return 'only';
  if (index === 0) return 'first';
  return index === count - 1 ? 'last' : 'middle';
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colours.surface,
      borderRadius: radii.l,
      borderWidth: 1,
      borderColor: colours.border,
      paddingRight: sp(4),
    },
    main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: sp(12), padding: sp(10), minHeight: ROW },
    words: { flex: 1, gap: sp(4) },
    thumb: {
      width: 30,
      height: 40,
      borderRadius: radii.s,
      backgroundColor: colours.accentSoft,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
    },
    thumbImage: { width: 30, height: 40 },
    // One card for the list (R1): its first row rounds the top, its last the
    // bottom, and a hairline parts each row from the one above.
    only: {},
    first: { borderBottomWidth: 0, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
    middle: { borderRadius: 0, borderBottomWidth: 0, borderTopWidth: StyleSheet.hairlineWidth },
    last: { borderTopWidth: StyleSheet.hairlineWidth, borderTopLeftRadius: 0, borderTopRightRadius: 0 },
    pressed: { opacity: 0.8 },
    bold: { ...font('700'), color: colours.ink },
  });
