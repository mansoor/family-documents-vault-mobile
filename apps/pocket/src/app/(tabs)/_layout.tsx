import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { TabBar } from '../../ui/tab-bar';

/** Home, Search, Needs attention and More, with the + between them (4.12; More in People's place, P6). */
export default function TabsLayout() {
  const { t } = useTranslation();
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <TabBar state={props.state} navigation={props.navigation} />}
    >
      <Tabs.Screen name="index" options={{ title: t('tabs.home') }} />
      <Tabs.Screen name="search" options={{ title: t('tabs.search') }} />
      <Tabs.Screen name="attention" options={{ title: t('tabs.attentionName') }} />
      <Tabs.Screen name="more" options={{ title: t('tabs.more') }} />
    </Tabs>
  );
}
