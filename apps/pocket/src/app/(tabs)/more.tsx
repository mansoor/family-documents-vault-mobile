import { can, radii } from '@fdv/shared';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { ChevronRight, ExternalLink, Files, Inbox, Settings, UserRound, Users, type LucideIcon } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { waitingInInbox } from '../../queue/inbox';
import { useVault } from '../../state/vault';
import { Text } from '../../ui';
import { sp } from '../../ui/space';
import { useColours, useStyles, type Palette } from '../../ui/theme';

/**
 * More (P6; the owner's choice of 7 Nov 2026: a More tab in People's
 * place): everything that is not Home, Search, the + or Needs attention.
 * The family; the person's Inbox, which is finished in the browser;
 * Account (the vault, what a guest may see, signed-in devices); and
 * Settings. Collections and notes join it later in the polish (P9).
 */
export default function MoreScreen() {
  const styles = useStyles(makeStyles);
  const { t } = useTranslation();
  const router = useRouter();
  const { vault, caps, who, offline, withTokenQuick } = useVault();
  // The Inbox, where the vault has batches and the person may add documents:
  // a viewer, and so a guest, has none.
  const inboxOn = caps?.features.batches === true && !!who && can(who.role, 'document.add');
  const [waiting, setWaiting] = useState<number | null>(null);
  useEffect(() => {
    if (!inboxOn || offline) return;
    let stopped = false;
    withTokenQuick((a, token) => waitingInInbox(a, token))
      .then((n) => {
        if (!stopped) setWaiting(n);
      })
      .catch(() => undefined);
    return () => {
      stopped = true;
    };
  }, [inboxOn, offline, withTokenQuick]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView testID="more" contentContainerStyle={styles.page}>
        <Text variant="hero">{t('more.title')}</Text>
        <View style={styles.group}>
          <Row
            testID="more-documents"
            icon={Files}
            label={t('documents.title')}
            hint={t('more.documentsHint')}
            onPress={() => router.push('/documents')}
          />
          <Row
            testID="more-people"
            icon={Users}
            label={t('more.people')}
            hint={t('more.peopleHint')}
            onPress={() => router.push('/people')}
          />
          {inboxOn && vault ? (
            <Row
              testID="more-inbox"
              icon={Inbox}
              label={t('more.inbox')}
              hint={waiting ? t('home.inbox', { count: waiting }) : t('more.inboxHint')}
              external
              onPress={() => void Linking.openURL(`${vault.origin}/inbox`)}
            />
          ) : null}
        </View>
        <View style={styles.group}>
          <Row
            testID="more-account"
            icon={UserRound}
            label={t('more.account')}
            hint={t('more.accountHint')}
            onPress={() => router.push('/account')}
          />
          <Row
            testID="more-settings"
            icon={Settings}
            label={t('settings.title')}
            hint={t('more.settingsHint')}
            onPress={() => router.push('/settings')}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/** One place to go: its icon, its name and what is there, then a chevron (or the browser's sign). */
function Row(props: {
  testID: string;
  icon: LucideIcon;
  label: string;
  hint: string;
  external?: boolean;
  onPress: () => void;
}) {
  const styles = useStyles(makeStyles);
  const colours = useColours();
  const Icon = props.icon;
  const After = props.external ? ExternalLink : ChevronRight;
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole={props.external ? 'link' : 'button'}
      accessibilityLabel={props.label}
      accessibilityHint={props.hint}
      onPress={props.onPress}
      style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
    >
      <View style={styles.icon}>
        <Icon color={colours.accent} size={22} accessibilityElementsHidden importantForAccessibility="no" />
      </View>
      <View style={styles.words}>
        <Text weight="600">{props.label}</Text>
        <Text variant="secondary" tone="soft">
          {props.hint}
        </Text>
      </View>
      <After color={colours.inkMuted} size={20} accessibilityElementsHidden importantForAccessibility="no" />
    </Pressable>
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colours.bg },
    page: { padding: sp(20), gap: sp(16) },
    group: {
      backgroundColor: colours.surface,
      borderRadius: radii.l,
      borderWidth: 1,
      borderColor: colours.border,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: sp(12),
      paddingHorizontal: sp(14),
      paddingVertical: sp(12),
      minHeight: 64,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colours.border,
    },
    pressed: { opacity: 0.8 },
    icon: {
      width: 40,
      height: 40,
      borderRadius: radii.pill,
      backgroundColor: colours.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    words: { flex: 1, gap: sp(4) },
  });
