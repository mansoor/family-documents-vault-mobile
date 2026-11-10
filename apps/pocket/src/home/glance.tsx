import { documentName, radii } from '@fdv/shared';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { useEssentials } from '../state/essentials';
import { Text } from '../ui';
import { Chip } from '../ui/chip';
import { sp } from '../ui/space';
import { useStyles, type Palette } from '../ui/theme';

/** How many documents, how many expire soon, and how many need details. */
export interface HomeCounts {
  total: number;
  expiring: number;
  details: number;
}

/**
 * Three numbers at a glance (R4): every document the person may see, those
 * expiring soon and those needing details — each opening Documents,
 * narrowed to them. Only where the vault counts (the Documents table, 0.6.0).
 */
export function Counts(props: { counts: HomeCounts }) {
  const styles = useStyles(makeStyles);
  const { t } = useTranslation();
  const router = useRouter();
  const tiles: { id: string; n: number; words: string; status?: string; warn?: boolean }[] = [
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
  ];
  return (
    <View style={styles.tiles}>
      {tiles.map((x) => (
        <Pressable
          key={x.id}
          testID={`home-count-${x.id}`}
          accessibilityRole="button"
          accessibilityLabel={`${x.n} ${x.words}`}
          onPress={() =>
            router.push(x.status ? { pathname: '/documents', params: { status: x.status } } : '/documents')
          }
          style={({ pressed }) => [styles.tile, pressed ? styles.pressed : null]}
        >
          <Text variant="title" weight="700" tone={x.warn ? 'warn' : 'ink'}>
            {String(x.n)}
          </Text>
          <Text variant="small" tone="soft">
            {x.words}
          </Text>
        </Pressable>
      ))}
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
    tiles: { flexDirection: 'row', gap: sp(8) },
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
