import { colours, radii, type Member } from '@fdv/shared';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useVault } from '../../state/vault';
import { Notice, Text } from '../../ui';

/** People (4.12): the family, read-only; each leads to their documents. */
export default function PeopleScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { withToken, offline } = useVault();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setMembers((await withToken((a, token) => a.members(token))).items);
    } catch {
      // Offline: the banner says so.
    }
  }, [withToken]);

  useEffect(() => {
    // Loaded on arrival; the state is set after the request answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        testID="people"
        contentContainerStyle={styles.page}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load().finally(() => setRefreshing(false));
            }}
          />
        }
      >
        <Text variant="hero">{t('people.title')}</Text>
        {offline && !members ? (
          <Notice tone="warn" testID="people-offline">
            {t('people.needsConnection')}
          </Notice>
        ) : null}
        {members?.map((m) => {
          const name = m.is_me ? t('people.you', { name: m.display_name }) : m.display_name;
          return (
            <Pressable
              key={m.id}
              testID={`person-${m.id}`}
              accessibilityRole="button"
              accessibilityLabel={name}
              onPress={() => router.push({ pathname: '/person/[id]', params: { id: m.id, name: m.display_name } })}
              style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
            >
              <Text weight="600">{name}</Text>
              <Text variant="secondary" tone="soft">
                {t(`people.role_${m.role}`, { defaultValue: m.role })}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colours.bg },
  page: { padding: 20, gap: 10 },
  row: {
    gap: 2,
    backgroundColor: colours.surface,
    borderRadius: radii.l,
    borderWidth: 1,
    borderColor: colours.border,
    padding: 12,
    minHeight: 56,
  },
  pressed: { opacity: 0.8 },
});
