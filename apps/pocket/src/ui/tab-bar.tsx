import { can, TAP_MIN } from '@fdv/shared';
import { Files, House, Menu, NotebookText, Users, type LucideIcon } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AddButton } from '../capture/add-button';
import { useVault } from '../state/vault';
import { Text } from './index';
import { useTextScale } from './text-scale';
import { sp } from './space';
import { useColours, useStyles, type Palette } from './theme';

/**
 * The tabs, in order; the + sits between the second and the third. Each
 * label is one short word, so it fits its fifth of a 360 dp phone at Large
 * text; `name` is what a screen reader says when the word alone is terse.
 */
const TABS: Record<string, { label: string; name?: string; icon: LucideIcon; testID: string }> = {
  index: { label: 'tabs.home', icon: House, testID: 'tab-home' },
  documents: { label: 'tabs.documents', icon: Files, testID: 'tab-documents' },
  notes: { label: 'tabs.notes', icon: NotebookText, testID: 'tab-notes' },
  people: { label: 'tabs.people', icon: Users, testID: 'tab-people' },
  more: { label: 'tabs.more', name: 'tabs.moreName', icon: Menu, testID: 'tab-more' },
};

export interface TabBarProps {
  state: { index: number; routes: { key: string; name: string }[] };
  navigation: { navigate: (name: string) => void };
}

/**
 * The tab bar (4.12): Home, Documents, the +, Notes, More (R3); People
 * where the vault has no notes.
 * The + is only for those who may add documents.
 */
export function TabBar(props: TabBarProps) {
  const colours = useColours();
  const styles = useStyles(makeStyles);
  const { t } = useTranslation();
  const { who, caps } = useVault();
  const insets = useSafeAreaInsets();
  // 10, as the mockup has it (R3): "Documents" in its fifth of a 360 dp
  // phone at Large text too. Large text still makes it 1.3 times the size.
  const { scale } = useTextScale();
  const canAdd = who ? can(who.role, 'document.add') : false;
  // One of Notes and People: Notes where the vault keeps them, else People.
  const left = caps?.features.notes === true ? 'people' : 'notes';
  const routes = props.state.routes.filter((r) => TABS[r.name] && r.name !== left);
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
        accessibilityLabel={t(spec.name ?? spec.label)}
        onPress={() => props.navigation.navigate(route.name)}
        style={({ pressed }) => [styles.tab, pressed ? styles.pressed : null]}
      >
        <Icon color={ink} size={22} accessibilityElementsHidden importantForAccessibility="no" />
        <Text variant="small" weight={selected ? '600' : '500'} style={[styles.label, { color: ink, fontSize: 10 * scale, lineHeight: Math.round(13 * scale) }]}>
          {t(spec.label)}
        </Text>
      </Pressable>
    );
  };
  return (
    <View style={[styles.bar, { paddingBottom: 6 + insets.bottom }]} accessibilityRole="tablist" testID="tab-bar">
      {routes.slice(0, 2).map(tab)}
      {canAdd ? <AddButton /> : null}
      {routes.slice(2).map(tab)}
    </View>
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-around',
      paddingTop: sp(6),
      backgroundColor: colours.surface,
      borderTopWidth: 1,
      borderTopColor: colours.border,
    },
    // An equal share each (flex: 1 grows from nothing), never more: a label
    // wraps inside its own tab rather than reaching the +, whose slot is a
    // fixed width (add-button.tsx). No side padding: Figtree (P1) is wider
    // than Roboto, and "Attention" at Large text needs the room.
    tab: {
      flex: 1,
      minWidth: TAP_MIN,
      minHeight: TAP_MIN + 8,
      alignItems: 'center',
      justifyContent: 'center',
      gap: sp(4),
    },
    label: { textAlign: 'center' },
    pressed: { opacity: 0.7 },
  });
