import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { TabBar } from '../../ui/tab-bar';

/**
 * Home, Documents, the +, Notes and More (R3; the owner, 10 Nov 2026).
 * People takes Notes' place on a vault without notes (before 0.9.0).
 * Needs attention is the bell in each tab's header, not a tab.
 */
export default function TabsLayout() {
  const { t } = useTranslation();
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <TabBar state={props.state} navigation={props.navigation} />}
    >
      <Tabs.Screen name="index" options={{ title: t('tabs.home') }} />
      <Tabs.Screen name="documents" options={{ title: t('tabs.documents') }} />
      <Tabs.Screen name="notes" options={{ title: t('tabs.notes') }} />
      <Tabs.Screen name="people" options={{ title: t('tabs.people') }} />
      <Tabs.Screen name="more" options={{ title: t('tabs.more') }} />
    </Tabs>
  );
}
