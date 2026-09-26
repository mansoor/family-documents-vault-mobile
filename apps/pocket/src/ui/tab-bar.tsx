import { can, colours, TAP_MIN } from '@fdv/shared';
import { BellRing, House, Search, Users, type LucideIcon } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AddButton } from '../capture/add-button';
import { useVault } from '../state/vault';
import { Text } from './index';

/** The tabs, in order; the + sits between the second and the third. */
const TABS: Record<string, { label: string; icon: LucideIcon; testID: string }> = {
  index: { label: 'tabs.home', icon: House, testID: 'tab-home' },
  search: { label: 'tabs.search', icon: Search, testID: 'tab-search' },
  attention: { label: 'tabs.attention', icon: BellRing, testID: 'tab-attention' },
  people: { label: 'tabs.people', icon: Users, testID: 'tab-people' },
};

export interface TabBarProps {
  state: { index: number; routes: { key: string; name: string }[] };
  navigation: { navigate: (name: string) => void };
}

/**
 * The tab bar (4.12): Home, Search, the +, Needs attention, People.
 * The + is only for those who may add documents.
 */
export function TabBar(props: TabBarProps) {
  const { t } = useTranslation();
  const { who } = useVault();
  const insets = useSafeAreaInsets();
  const canAdd = who ? can(who.role, 'document.add') : false;
  const routes = props.state.routes.filter((r) => TABS[r.name]);
  const current = props.state.routes[props.state.index]?.name;
  const tab = (route: { key: string; name: string }) => {
    const spec = TABS[route.name];
    if (!spec) return null;
    const Icon = spec.icon;
    const selected = route.name === current;
    const ink = selected ? colours.accent : colours.inkSoft;
    return (
      <Pressable
        key={route.key}
        testID={spec.testID}
        accessibilityRole="tab"
        accessibilityState={{ selected }}
        accessibilityLabel={t(spec.label)}
        onPress={() => props.navigation.navigate(route.name)}
        style={({ pressed }) => [styles.tab, pressed ? styles.pressed : null]}
      >
        <Icon color={ink} size={22} accessibilityElementsHidden importantForAccessibility="no" />
        <Text variant="secondary" weight={selected ? '600' : '400'} style={{ color: ink }}>
          {t(spec.label)}
        </Text>
      </Pressable>
    );
  };
  return (
    <View style={[styles.bar, { paddingBottom: 6 + insets.bottom }]} accessibilityRole="tablist">
      {routes.slice(0, 2).map(tab)}
      {canAdd ? <AddButton /> : null}
      {routes.slice(2).map(tab)}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingTop: 6,
    paddingHorizontal: 4,
    backgroundColor: colours.surface,
    borderTopWidth: 1,
    borderTopColor: colours.border,
  },
  tab: { flex: 1, minHeight: TAP_MIN + 8, alignItems: 'center', justifyContent: 'center', gap: 2 },
  pressed: { opacity: 0.7 },
});
