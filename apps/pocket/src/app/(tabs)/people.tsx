import { radii, type Member } from '@fdv/shared';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useVault } from '../../state/vault';
import { Notice, Text } from '../../ui';
import { sp } from '../../ui/space';
import { useStyles, type Palette } from '../../ui/theme';
import { LoadFailed, loadFailure, Placeholder } from '../../ui/states';

/** People (4.12; a tab since R3): the family, read-only; each leads to their documents. */
export default function PeopleScreen() {
  const styles = useStyles(makeStyles);
  const { t } = useTranslation();
  const router = useRouter();
  const { withToken, offline } = useVault();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // A failure that is not the connection (P5): said, with Try again.
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setMembers((await withToken((a, token) => a.members(token))).items);
      setFailed(null);
    } catch (err) {
      // Offline: the banner says so. Anything else, here.
      setFailed(loadFailure('people', err, t));
    }
  }, [withToken, t]);

  useEffect(() => {
    // Loaded on arrival; the state is set after the request answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // Again when the connection returns.
  }, [load, offline]);

  return (
    <SafeAreaView style={styles.safe} edges={[]}>
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
        <View style={styles.titleRow}>
          <Text variant="hero" style={styles.flex}>
            {t('people.title')}
          </Text>
        </View>
        {offline && !members ? (
          <Notice tone="warn" testID="people-offline">
            {t('people.needsConnection')}
          </Notice>
        ) : null}
        {failed ? <LoadFailed words={failed} onRetry={() => void load()} /> : null}
        {!members && !failed && !offline ? <Placeholder rows={4} /> : null}
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

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colours.bg },
    page: { padding: sp(20), gap: sp(10) },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: sp(8) },
    flex: { flex: 1 },
    row: {
      gap: sp(4),
      backgroundColor: colours.surface,
      borderRadius: radii.l,
      borderWidth: 1,
      borderColor: colours.border,
      padding: sp(12),
      minHeight: 48,
    },
    pressed: { opacity: 0.8 },
  });
