import { Link } from 'expo-router';
import { Settings as SettingsIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVault } from '../state/vault';
import { BellButton } from './bell';
import { Text } from '.';
import { sp } from './space';
import { useColours, useStyles, type Palette } from './theme';

/**
 * The bar at the top of every screen (the owner's ask of 11 Nov 2026):
 * the family's vault by name, Needs attention's bell and Settings, the same
 * on every page, close to the top. A page's own title, and what may be done
 * there (Edit, ⋯), go below it; a tab's page draws its title itself. No
 * back arrow anywhere: Android's back goes back. Show mode, the pages, the
 * camera and the edit pages have the whole screen, and no bar.
 */
export function AppHeader(props: { title?: string | undefined; right?: ReactNode }) {
  const styles = useStyles(makeStyles);
  const colours = useColours();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { caps, vault } = useVault();
  const name = caps?.branding.display_name ?? vault?.displayName ?? '';
  const title = props.title?.trim() ? props.title : null;
  return (
    <View style={[styles.wrap, { paddingTop: insets.top + sp(4) }]} testID="app-header">
      <View style={styles.bar}>
        <Text variant="title" style={styles.flex} numberOfLines={1} role="header" testID="app-header-name">
          {name}
        </Text>
        <BellButton />
        <Link href="/settings" asChild>
          <Pressable
            testID="app-header-settings"
            accessibilityRole="button"
            accessibilityLabel={t('home.settings')}
            hitSlop={2}
            style={({ pressed }) => [styles.icon, pressed ? styles.pressed : null]}
          >
            <SettingsIcon color={colours.ink} size={22} accessibilityElementsHidden importantForAccessibility="no" />
          </Pressable>
        </Link>
      </View>
      {title || props.right ? (
        <View style={styles.titleRow}>
          {title ? (
            <Text variant="hero" style={styles.flex} testID="app-header-title">
              {title}
            </Text>
          ) : (
            <View style={styles.flex} />
          )}
          {props.right}
        </View>
      ) : null}
    </View>
  );
}

/** What a navigator hands its header: the screen's title and its own buttons. */
export interface HeaderOptions {
  title?: string | undefined;
  headerTitle?: unknown;
  headerRight?: ((p: { tintColor?: string; canGoBack: boolean }) => ReactNode) | undefined;
}

/** The header for a navigator's screens: its title (unless `headerTitle` is ''), and its buttons. */
export function headerFor(options: HeaderOptions) {
  const title = typeof options.headerTitle === 'string' ? options.headerTitle : options.title;
  return <AppHeader title={title} right={options.headerRight?.({ canGoBack: true })} />;
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    wrap: { backgroundColor: colours.bg, paddingHorizontal: sp(20), paddingBottom: sp(4), gap: sp(6) },
    bar: { flexDirection: 'row', alignItems: 'center', gap: sp(4), minHeight: 44 },
    flex: { flex: 1 },
    icon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
    pressed: { opacity: 0.8 },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: sp(8) },
  });
