import { can, radii } from '@fdv/shared';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import {
  Activity,
  ChevronRight,
  ExternalLink,
  HeartHandshake,
  HeartPulse,
  Share2,
  FolderOpen,
  Inbox,
  Settings,
  Trash2,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { caregiversOffered } from '../../caregivers/rules';
import { collectionsOffered } from '../../collections/rules';
import { emergencyOffered } from '../../emergency/rules';
import { waitingInInbox } from '../../queue/inbox';
import { useVault } from '../../state/vault';
import { Text } from '../../ui';
import { sp } from '../../ui/space';
import { useColours, useStyles, type Palette } from '../../ui/theme';

/**
 * More (P6; the owner's choice of 7 Nov 2026: a More tab in People's
 * place): everything that is not a tab (R3: Home, Documents, the +,
 * Notes). People, where Notes is the tab; the person's Inbox, which is finished in the browser;
 * Account (the vault, what a guest may see, signed-in devices); and
 * Settings. Collections and notes since P9, where the vault has them.
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
  // Collections for whoever makes them, as the web offers them (a viewer, none). Notes is a
  // tab where the vault has them, and People a row here; on an older vault, People is the tab.
  const collectionsOn = collectionsOffered(caps, who?.role);
  // The Trash, for whoever may move things there (the gaps review, 11 Nov 2026).
  const trashOn = !!who && can(who.role, 'document.delete');
  // Sharing (the owner's ask of 11 Nov 2026): the links that still work, for whoever may share.
  const sharingOn = !!who && can(who.role, 'document.share');
  // Activity (app 0.17.0): who did what, for whoever reads the log (owners, adults, teens), as the web offers it.
  const activityOn = !!who && can(who.role, 'audit.read');
  const notesOn = caps?.features.notes === true;
  // Caregivers (H1b): whoever may name their own or be one, on a vault that has them.
  const caregiversOn = caregiversOffered(caps, who?.role);
  // Emergency information (H4): whoever may read a page — never a viewer or a guest.
  const emergencyOn = emergencyOffered(caps, who?.role);
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
    <SafeAreaView style={styles.safe} edges={[]}>
      <ScrollView testID="more" contentContainerStyle={styles.page}>
        <View style={styles.titleRow}>
          <Text variant="hero" style={styles.flex}>
            {t('more.title')}
          </Text>
        </View>
        <View style={styles.group}>
          {collectionsOn ? (
            <Row
              testID="more-collections"
              icon={FolderOpen}
              label={t('collections.title')}
              hint={t('more.collectionsHint')}
              onPress={() => router.push('/collections')}
            />
          ) : null}
          {notesOn ? (
            <Row
              testID="more-people"
              icon={Users}
              label={t('more.people')}
              hint={t('more.peopleHint')}
              onPress={() => router.push('/people')}
            />
          ) : null}
          {sharingOn ? (
            <Row
              testID="more-sharing"
              icon={Share2}
              label={t('sharing.title')}
              hint={t('more.sharingHint')}
              onPress={() => router.push('/sharing')}
            />
          ) : null}
          {activityOn ? (
            <Row
              testID="more-activity"
              icon={Activity}
              label={t('activity.title')}
              hint={t('more.activityHint')}
              onPress={() => router.push('/activity')}
            />
          ) : null}
          {emergencyOn ? (
            <Row
              testID="more-emergency"
              icon={HeartPulse}
              label={t('emergency.title')}
              hint={t('more.emergencyHint')}
              onPress={() => router.push('/emergency')}
            />
          ) : null}
          {caregiversOn ? (
            <Row
              testID="more-caregivers"
              icon={HeartHandshake}
              label={t('caregivers.title')}
              hint={t('more.caregiversHint')}
              onPress={() => router.push('/caregivers')}
            />
          ) : null}
          {trashOn ? (
            <Row
              testID="more-trash"
              icon={Trash2}
              label={t('trashList.title')}
              hint={t('more.trashHint')}
              onPress={() => router.push('/trash')}
            />
          ) : null}
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
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: sp(8) },
    flex: { flex: 1 },
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
      minHeight: 52,
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
