import { radii } from '@fdv/shared';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { readPrefs, writePrefs } from '../platform/prefs';
import { Text } from '../ui';
import { useStyles, type Palette } from '../ui/theme';

/**
 * Home's Recent (0.26.0, as the web's since 0.9.0-dev.102): one section,
 * its two tabs Added — the documents added last, as Recently added always
 * was — and Opened, the documents this person opened most recently, theirs
 * alone. Where the vault remembers opens (features.recently_opened);
 * otherwise it stays Recently added, with no tabs.
 */
export type RecentTab = 'added' | 'opened';

export const RECENT_TABS: readonly RecentTab[] = ['added', 'opened'];

/** The tab chosen last, kept on this phone for this person in this vault. */
export const recentTabPref = (who: string) => `homeRecent.${who.replace(/[^A-Za-z0-9._-]/g, '_')}`;

export function readRecentTab(who: string): RecentTab {
  return readPrefs<string>(recentTabPref(who), 'added') === 'opened' ? 'opened' : 'added';
}

export function writeRecentTab(who: string, tab: RecentTab): void {
  try {
    writePrefs(recentTabPref(who), tab);
  } catch {
    // Kept until the app closes, then.
  }
}

/** Added | Opened, as Needs attention's Now | Coming up: a screen reader hears tabs, and which is chosen. */
export function RecentTabs(props: { current: RecentTab; onChoose: (tab: RecentTab) => void }) {
  const styles = useStyles(makeStyles);
  const { t } = useTranslation();
  return (
    <View style={styles.seg} accessibilityRole="tablist" accessibilityLabel={t('home.recent')} testID="home-recent-tabs">
      {RECENT_TABS.map((tab) => {
        const on = props.current === tab;
        const label = tab === 'added' ? t('home.recentAdded') : t('home.recentOpened');
        return (
          <Pressable
            key={tab}
            testID={`home-recent-${tab}`}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected: on }}
            hitSlop={6}
            onPress={() => props.onChoose(tab)}
            style={[styles.segButton, on ? styles.segOn : null]}
          >
            <Text variant="secondary" weight="600" tone={on ? 'ink' : 'soft'} role="text">
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    seg: {
      flexDirection: 'row',
      backgroundColor: colours.border,
      borderRadius: radii.s,
      padding: 3,
      gap: 3,
    },
    segButton: { flex: 1, minHeight: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
    segOn: { backgroundColor: colours.surface },
  });
