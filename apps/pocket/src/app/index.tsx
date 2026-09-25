import { can, colours, radii, TAP_MIN, type DocumentView, type ReminderView } from '@fdv/shared';
import { Image } from 'expo-image';
import { Link, useRouter } from 'expo-router';
import { Camera, FileUp, ImagePlus, Settings as SettingsIcon } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { sizeWords } from '../capture/ui';
import type { QueueItem } from '../queue/item';
import { useCapture, type SavedNote } from '../state/capture';
import { useVault } from '../state/vault';
import { Button, Card, Notice, StatusLine, Text } from '../ui';

interface HomeData {
  due: ReminderView[];
  recent: DocumentView[];
  /** Documents filed without saying what they are. */
  unnamed: number;
  token: string;
}

/**
 * Home: what needs attention, and what came in lately. It shows what it
 * last had when the vault cannot be reached, under a plain banner.
 */
export default function Home() {
  const { t } = useTranslation();
  const { caps, vault, offline, notice, withToken, api, who } = useVault();
  const capture = useCapture();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<HomeData | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [scannerFailed, setScannerFailed] = useState(false);
  const [dockHeight, setDockHeight] = useState(84);
  const canAdd = who ? can(who.role, 'document.add') : false;

  const load = useCallback(async () => {
    try {
      const next = await withToken(async (a, token) => {
        // The vault filters by status after it takes a page, so every page
        // is read: a scan skipped long ago still needs its name.
        const unnamedCount = async () => {
          let n = 0;
          let cursor: string | undefined;
          for (let page = 0; page < 25; page += 1) {
            const r = await a.documents(token, { status: 'needs_info', limit: 200, ...(cursor ? { cursor } : {}) });
            n += r.items.filter((d) => !d.type_key).length;
            if (!r.has_more || !r.next_cursor) break;
            cursor = r.next_cursor;
          }
          return n;
        };
        const [due, recent, unnamed] = await Promise.all([
          a.reminders(token, 'due'),
          a.documents(token, { limit: 20 }),
          unnamedCount(),
        ]);
        return { due: due.items, recent: recent.items, unnamed, token };
      });
      setData(next);
    } catch {
      // Offline or signed out: the banner or the sign-in screen says so.
    }
  }, [withToken]);

  useEffect(() => {
    // Loading on arrival, and again each time the vault takes a capture:
    // the state is set after the requests answer, not synchronously, which
    // is what the rule is about.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, capture.delivered]);

  const begin = async (how: 'scan' | 'file' | 'photo') => {
    const outcome = await capture.start(how);
    if (outcome === 'card') {
      setScannerFailed(false);
      router.push('/capture');
    } else if (outcome === 'failed' && how === 'scan') {
      setScannerFailed(true);
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const name = caps?.branding.display_name ?? vault?.displayName ?? '';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <FlatList
        testID="home-list"
        data={data?.recent ?? []}
        keyExtractor={(d) => d.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
        contentContainerStyle={[styles.page, { paddingBottom: dockHeight + insets.bottom + 32 }]}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <Text variant="hero" style={styles.flex}>
                {name}
              </Text>
              <Link href="/settings" asChild>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('home.settings')}
                  hitSlop={12}
                  style={styles.iconButton}
                >
                  <SettingsIcon color={colours.inkSoft} size={24} />
                </Pressable>
              </Link>
            </View>
            {notice === 'stranger' ? (
              <Notice tone="danger" testID="home-stranger">
                {t('connect.stranger', { host: vault?.origin.replace(/^https?:\/\//, '') ?? '' })}
              </Notice>
            ) : notice === 'wifi_only' ? (
              <Notice tone="warn" testID="home-wifi-only">
                {t('connect.refuseMobileData')}
              </Notice>
            ) : offline ? (
              <Notice tone="warn" testID="home-offline">
                {t('home.offline')}
              </Notice>
            ) : null}
            {capture.saved ? <SavedLine text={savedWords(capture.saved, t)} onDismiss={capture.dismissSaved} /> : null}
            {capture.queue.length > 0 ? (
              <View style={styles.queue}>
                <Text variant="screen">{t('home.queueTitle')}</Text>
                {capture.queue.map((item) => (
                  <QueueRow
                    key={item.id}
                    item={item}
                    offline={offline}
                    limit={caps?.limits.max_upload_bytes ?? null}
                    onRemove={() => void capture.remove(item.id)}
                  />
                ))}
              </View>
            ) : null}
            <Text variant="screen">{t('home.attentionTitle')}</Text>
            {data && data.unnamed > 0 ? (
              <Text weight="600" tone="warn" testID="home-unnamed">
                {t('home.needName', { count: data.unnamed })}
              </Text>
            ) : null}
            {data && data.due.length === 0 && data.unnamed === 0 ? (
              <Text tone="soft" testID="home-calm">
                {t('home.calm')}
              </Text>
            ) : null}
            {data?.due.map((r) => (
              <Card key={r.id} style={styles.dueCard}>
                <Text weight="600">{r.document_title ?? t('home.untitled')}</Text>
                <Text variant="secondary" tone="warn" weight="600">
                  {r.label}
                </Text>
              </Card>
            ))}
            <Text variant="screen" style={styles.recentTitle}>
              {t('home.recentTitle')}
            </Text>
            {data && data.recent.length === 0 ? <Text tone="soft">{t('home.none')}</Text> : null}
          </View>
        }
        renderItem={({ item }) => (
          <DocumentRow doc={item} token={data?.token ?? null} thumb={api && item.latest_version_id ? api.thumbnailUrl(item.latest_version_id) : null} />
        )}
      />
      {canAdd ? (
      <View
        style={[styles.dock, { bottom: 16 + insets.bottom }]}
        onLayout={(e) => setDockHeight(e.nativeEvent.layout.height)}
      >
        {scannerFailed ? (
          <View style={styles.dockNotice}>
            <Notice tone="warn" testID="home-scanner-failed">
              {t('home.scannerFailed')}
            </Notice>
          </View>
        ) : null}
        <DockButton icon={FileUp} label={t('home.addFile')} onPress={() => void begin('file')} testID="home-add-file" />
        {capture.scanner.scans ? (
          <Pressable
            testID="home-scan"
            accessibilityRole="button"
            accessibilityLabel={t('home.scan')}
            accessibilityHint={t('home.scanHint')}
            onPress={() => void begin('scan')}
            style={({ pressed }) => [styles.camera, pressed ? styles.pressed : null]}
          >
            <Camera color={colours.onAccent} size={30} accessibilityElementsHidden importantForAccessibility="no" />
          </Pressable>
        ) : null}
        <DockButton icon={ImagePlus} label={t('home.addPhoto')} onPress={() => void begin('photo')} testID="home-add-photo" />
      </View>
      ) : null}
    </SafeAreaView>
  );
}

function DockButton(props: { icon: typeof Camera; label: string; onPress: () => void; testID: string }) {
  const Icon = props.icon;
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      onPress={props.onPress}
      style={({ pressed }) => [styles.dockButton, pressed ? styles.pressed : null]}
    >
      <Icon color={colours.accent} size={22} accessibilityElementsHidden importantForAccessibility="no" />
      <Text variant="secondary" weight="600" tone="accent" role="text">
        {props.label}
      </Text>
    </Pressable>
  );
}

/** What Home says once a capture is safe on the phone. */
function savedWords(note: SavedNote, t: TFunction): string {
  if (note.unnamed) return t('home.savedSkipped');
  if (note.reminder) return t('home.savedReminder', { reminder: note.reminder });
  if (note.noExpiry) return t('home.savedNoExpiry');
  return t('home.savedDetails');
}

function SavedLine(props: { text: string; onDismiss: () => void }) {
  const { t } = useTranslation();
  return (
    <Notice tone="ok" testID="home-saved" announce={props.text}>
      <Text>{props.text}</Text>
      <Button label={t('home.dismiss')} kind="quiet" onPress={props.onDismiss} testID="home-saved-dismiss" />
    </Notice>
  );
}

/** A capture on its way: what it is, and where it stands — never "upload failed". */
function QueueRow(props: { item: QueueItem; offline: boolean; limit: number | null; onRemove: () => void }) {
  const { t } = useTranslation();
  const { item } = props;
  const p = item.problem;
  const words =
    item.state === 'needs_you'
      ? p?.status === 413
        ? t('queue.tooBigForVault', { limit: sizeWords(props.limit) })
        : p?.status === 415
          ? t('queue.wrongKind')
          : t('queue.refused', { reason: p?.message ?? p?.code ?? '' })
      : props.offline
        ? t('queue.notYet')
        : item.state === 'waiting' && item.attempts > 0
          ? t('queue.busy')
          : t('queue.sending');
  return (
    <Card style={item.state === 'needs_you' ? styles.needsYou : null}>
      <Text weight="600">{item.metadata?.title ?? t('queue.untitled')}</Text>
      <Text variant="secondary" tone={item.state === 'needs_you' ? 'danger' : 'soft'} testID="queue-state">
        {words}
      </Text>
      {item.state === 'needs_you' ? <Button label={t('queue.remove')} kind="quiet" onPress={props.onRemove} /> : null}
    </Card>
  );
}

function DocumentRow(props: { doc: DocumentView; token: string | null; thumb: string | null }) {
  const { t } = useTranslation();
  const { doc } = props;
  return (
    <View style={styles.row} accessible accessibilityLabel={doc.title ?? t('home.needsAName')}>
      <View style={styles.thumb}>
        {props.thumb && props.token ? (
          <Image
            source={{ uri: props.thumb, headers: { authorization: `Bearer ${props.token}` } }}
            // Held in memory only: a document's picture never lands in the
            // phone's disk cache.
            cachePolicy="memory"
            style={styles.thumbImage}
            contentFit="cover"
            accessibilityIgnoresInvertColors
          />
        ) : null}
      </View>
      <View style={styles.flex}>
        <Text weight="600">{doc.title ?? t('home.needsAName')}</Text>
        <StatusLine status={doc.status} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colours.bg },
  page: { padding: 20, gap: 10 },
  queue: { gap: 8 },
  needsYou: { gap: 6, borderColor: colours.danger },
  pressed: { opacity: 0.8 },
  dock: {
    position: 'absolute',
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    rowGap: 8,
  },
  dockNotice: { width: '100%' },
  camera: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colours.accent,
    elevation: 3,
  },
  dockButton: {
    minHeight: TAP_MIN,
    minWidth: 96,
    flexShrink: 1,
    paddingHorizontal: 12,
    borderRadius: radii.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colours.surface,
    borderWidth: 1,
    borderColor: colours.border,
  },
  header: { gap: 12, marginBottom: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1 },
  iconButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  dueCard: { gap: 4, borderColor: colours.warn },
  recentTitle: { marginTop: 12 },
  row: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    backgroundColor: colours.surface,
    borderRadius: radii.l,
    borderWidth: 1,
    borderColor: colours.border,
    padding: 10,
    minHeight: 72,
  },
  thumb: { width: 48, height: 64, borderRadius: radii.s, backgroundColor: colours.accentSoft, overflow: 'hidden' },
  thumbImage: { width: 48, height: 64 },
});
