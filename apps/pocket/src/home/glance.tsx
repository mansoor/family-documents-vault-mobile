import { documentName, radii, type DocumentView } from '@fdv/shared';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { DocumentRow, rowPlace } from '../documents/row';
import { useEssentials } from '../state/essentials';
import { useVault } from '../state/vault';
import { useTextScale } from '../ui/text-scale';
import { Button, Text } from '../ui';
import { Chip } from '../ui/chip';
import { sp } from '../ui/space';
import { useStyles, type Palette } from '../ui/theme';

/** How many documents, how many expire soon, how many need details, and how many notes. */
export interface HomeCounts {
  total: number;
  expiring: number;
  details: number;
  /** Where the vault keeps notes: as many as it lists, and whether there are more. */
  notes?: { n: number; more: boolean } | null | undefined;
  /** The people in the family, and the collections the person may see: the second row's. */
  people?: number | null | undefined;
  collections?: number | null | undefined;
}

/**
 * Three numbers at a glance (R4): every document the person may see, those
 * expiring soon and those needing details — each opening Documents,
 * narrowed to them. Only where the vault counts (the Documents table, 0.6.0).
 * And, where the vault keeps notes and collections, a second row of three
 * (the owner's ask of 11 Nov 2026: four did not fit a large phone; "3 or
 * 6"): notes, people and collections, each opening its page. Three to a
 * row always; at the largest text, two.
 */
export function Counts(props: { counts: HomeCounts }) {
  const styles = useStyles(makeStyles);
  const { t } = useTranslation();
  const router = useRouter();
  const { scale } = useTextScale();
  const { notes, people, collections } = props.counts;
  const six = !!notes && typeof people === 'number' && typeof collections === 'number';
  const tiles: { id: string; n: number; shown?: string; words: string; status?: string; warn?: boolean; to?: string }[] = [
    { id: 'documents', n: props.counts.total, words: t('glance.documents', { count: props.counts.total }) },
    {
      id: 'expiring',
      n: props.counts.expiring,
      words: t('glance.expiring', { count: props.counts.expiring }),
      status: 'expiring_soon',
      warn: props.counts.expiring > 0,
    },
    {
      id: 'details',
      n: props.counts.details,
      words: t('glance.details', { count: props.counts.details }),
      status: 'needs_info',
    },
    ...(six
      ? [
          {
            id: 'notes',
            n: notes.n,
            shown: notes.more ? `${notes.n}+` : String(notes.n),
            words: t('glance.notes', { count: notes.n }),
            to: '/notes',
          },
          { id: 'people', n: people, words: t('glance.people', { count: people }), to: '/people' },
          {
            id: 'collections',
            n: collections,
            words: t('glance.collections', { count: collections }),
            to: '/collections',
          },
        ]
      : []),
  ];
  // Three to a row; two at the largest text, where three would squeeze their words.
  const twoRows = scale > 1.3;
  return (
    <View style={styles.tiles}>
      {tiles.map((x) => (
        <Pressable
          key={x.id}
          testID={`home-count-${x.id}`}
          accessibilityRole="button"
          accessibilityLabel={`${x.shown ?? x.n} ${x.words}`}
          onPress={() =>
            router.push(
              x.to
                ? (x.to as '/notes' | '/people' | '/collections')
                : x.status
                  ? { pathname: '/documents', params: { status: x.status } }
                  : '/documents',
            )
          }
          style={({ pressed }) => [styles.tile, twoRows ? styles.half : styles.third, pressed ? styles.pressed : null]}
        >
          <Text variant="title" weight="700" tone={x.warn ? 'warn' : 'ink'}>
            {x.shown ?? String(x.n)}
          </Text>
          <Text variant="small" tone="soft">
            {x.words}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/** How many Essentials Home lists before See all. */
export const ESSENTIALS_SHOWN = 5;

/**
 * The family's Essentials, as a section of their own above Recently added
 * (the owner's ask of 11 Nov 2026): five at most, newest first, each a row
 * as Recently added's are (a tap opens it, its ⋯ the rest); See all opens
 * Documents narrowed to them. Nothing when there are none: Home's offer to
 * keep them says what they are.
 */
export function EssentialsSection(props: { docs: DocumentView[]; token: string }) {
  const styles = useStyles(makeStyles);
  const { t } = useTranslation();
  const router = useRouter();
  const { api } = useVault();
  if (props.docs.length === 0) return null;
  const shown = props.docs.slice(0, ESSENTIALS_SHOWN);
  return (
    <View style={styles.section} testID="home-essentials">
      <View style={styles.sectionHead}>
        <Text variant="screen" style={styles.flex}>
          {t('glance.essentials')}
        </Text>
        {props.docs.length > ESSENTIALS_SHOWN ? (
          <Button
            kind="quiet"
            label={t('glance.seeAll')}
            accessibilityLabel={t('glance.seeAllEssentials')}
            onPress={() => router.push({ pathname: '/documents', params: { essential: '1' } })}
            testID="home-essentials-all"
          />
        ) : null}
      </View>
      <View style={styles.rows}>
        {shown.map((d, i) => (
          <DocumentRow
            key={d.id}
            id={d.id}
            title={d.title}
            type_key={d.type_key}
            note_name={d.note_name}
            status={d.status}
            doc={d}
            place={rowPlace(i, shown.length)}
            thumb={api && d.latest_version_id ? { uri: api.thumbnailUrl(d.latest_version_id), token: props.token } : null}
          />
        ))}
      </View>
    </View>
  );
}

/**
 * The Essentials kept on this phone, on one line (R4): three, then how many
 * more; each opens its page. Nothing when none is kept — Home's offer to
 * keep them says that.
 */
export function EssentialsLine() {
  const styles = useStyles(makeStyles);
  const { t } = useTranslation();
  const router = useRouter();
  const { items } = useEssentials();
  if (items.length === 0) return null;
  const shown = items.slice(0, 3);
  const more = items.length - shown.length;
  return (
    <View style={styles.essentials} testID="home-essentials">
      <View style={styles.head}>
        <Text variant="secondary" weight="700" style={styles.flex}>
          {t('glance.essentials')}
        </Text>
        <Text variant="small" tone="soft">
          {t('glance.kept')}
        </Text>
      </View>
      <View style={styles.line}>
        {shown.map((k) => (
          <Chip
            key={k.id}
            label={documentName(k.document, t('document.untitled'))}
            onPress={() => router.push({ pathname: '/document/[id]', params: { id: k.id } })}
            testID={`home-essential-${k.id}`}
          />
        ))}
        {more > 0 ? (
          <Chip label={`+${more}`} onPress={() => router.push('/documents')} testID="home-essentials-more" />
        ) : null}
      </View>
    </View>
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: sp(8) },
    section: { gap: sp(8), marginTop: sp(4) },
    sectionHead: { flexDirection: 'row', alignItems: 'center', gap: sp(12) },
    rows: { gap: sp(8) },
    // Three to a row (or two): a third, less the gaps; each grows to fill it.
    third: { flexBasis: '30%', flexGrow: 1 },
    half: { flexBasis: '45%', flexGrow: 1 },
    tile: {
      flex: 1,
      minHeight: 56,
      paddingVertical: sp(8),
      paddingHorizontal: sp(10),
      borderRadius: radii.l,
      borderWidth: 1,
      borderColor: colours.border,
      backgroundColor: colours.surface,
      justifyContent: 'center',
    },
    pressed: { opacity: 0.8 },
    essentials: { gap: sp(6) },
    head: { flexDirection: 'row', alignItems: 'baseline', gap: sp(8) },
    flex: { flex: 1 },
    line: { flexDirection: 'row', gap: sp(8), overflow: 'hidden' },
  });
