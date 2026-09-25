import { FlatList, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import licences from '../about/licences.json';
import { Text } from '../ui';

interface Licence {
  name: string;
  versions: string[];
  licence: string;
}

/**
 * Settings → About → Licences (4.15): what the app is made of and under
 * which licence, as the build found it (scripts/licences.mjs).
 */
export default function Licences() {
  const { t } = useTranslation();
  const list = licences as Licence[];
  return (
    <FlatList
      data={list}
      keyExtractor={(l) => l.name}
      contentContainerStyle={styles.page}
      ListHeaderComponent={<Text tone="soft">{t('settings.licencesLead', { count: list.length })}</Text>}
      renderItem={({ item }) => (
        <View
          style={styles.row}
          accessible
          accessibilityLabel={`${item.name} ${item.versions.join(', ')}, ${item.licence}`}
        >
          <Text weight="600">{item.name}</Text>
          <Text tone="soft" variant="secondary">
            {item.versions.join(', ')} · {item.licence}
          </Text>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, gap: 12 },
  row: { gap: 2 },
});
