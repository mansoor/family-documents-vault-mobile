import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colours, radii } from '@fdv/shared';
import { day, PasswordSheet } from '../essentials/ui';
import { useEssentials } from '../state/essentials';
import { useLock } from '../state/lock';
import { Button, Card, Text } from '../ui';

/** Bytes as people say them: "4.2 MB". */
export function sizeWords(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Settings → Offline copies (4.15): what this phone keeps for when there
 * is no signal — how many, how much room they take, when the vault last
 * checked them — whether the person's own Only me ones are among them,
 * and a way to remove them all (the vault is told: this phone keeps
 * nothing now).
 */
export function OfflineCopies() {
  const { t } = useTranslation();
  const e = useEssentials();
  const lock = useLock();
  const insets = useSafeAreaInsets();
  const [size, setSize] = useState<number | null>(null);
  const [asking, setAsking] = useState<boolean | null>(null);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const { copiesSize } = e;
  const count = e.items.length;

  useEffect(() => {
    let live = true;
    void copiesSize().then((n) => {
      if (live) setSize(n);
    });
    return () => {
      live = false;
    };
  }, [copiesSize, count]);

  if (!e.available) return null;

  const remove = async () => {
    setBusy(true);
    try {
      await e.removeCopies();
    } finally {
      setBusy(false);
      setRemoving(false);
    }
  };

  return (
    <Card>
      <Text variant="title">{t('settings.offline')}</Text>
      {!e.prefs.enrolled ? (
        <Text tone="soft" testID="settings-offline-none">
          {t('settings.offlineNone')}
        </Text>
      ) : (
        <>
          <Text testID="settings-offline-summary">
            {t('settings.offlineSummary', { count, size: size === null ? '…' : sizeWords(size) })}
          </Text>
          <Text tone="soft" variant="secondary">
            {e.checked ? t('settings.offlineChecked', { date: day(e.checked.at) }) : t('settings.offlineNotChecked')}
          </Text>
          <Text tone="soft" variant="secondary">
            {t('settings.offlineScope')}
          </Text>
          {lock.level === 'strong' ? (
            <View style={styles.row}>
              <View style={styles.flex}>
                <Text weight="600">{t('settings.offlinePrivate')}</Text>
                <Text tone="soft" variant="secondary">
                  {t('settings.offlinePrivateHint')}
                </Text>
              </View>
              <Switch
                testID="settings-offline-private"
                accessibilityLabel={t('settings.offlinePrivate')}
                value={e.prefs.private}
                onValueChange={(v) => setAsking(v)}
              />
            </View>
          ) : null}
          <Button
            testID="settings-offline-remove"
            kind="danger"
            label={t('settings.offlineRemove')}
            onPress={() => setRemoving(true)}
          />
        </>
      )}
      <PasswordSheet
        visible={asking !== null}
        onCancel={() => setAsking(null)}
        onPassword={async (password) => {
          const outcome = await e.enrol(password, asking === true);
          if (outcome === 'ok') setAsking(null);
          return outcome;
        }}
      />
      <Modal visible={removing} transparent animationType="fade" onRequestClose={() => setRemoving(false)}>
        <View style={styles.scrim}>
          <View
            style={[styles.sheet, { paddingBottom: 20 + insets.bottom }]}
            accessibilityViewIsModal
            testID="settings-offline-remove-question"
          >
            <Text variant="screen">{t('settings.offlineRemoveTitle')}</Text>
            <Text>{t('settings.offlineRemoveWords')}</Text>
            <Button
              testID="settings-offline-remove-yes"
              kind="danger"
              label={t('settings.offlineRemoveYes')}
              busy={busy}
              onPress={() => void remove()}
            />
            <Button kind="quiet" label={t('common.cancel')} onPress={() => setRemoving(false)} />
          </View>
        </View>
      </Modal>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1 },
  scrim: { flex: 1, backgroundColor: 'rgba(28,26,23,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colours.bg,
    padding: 20,
    gap: 12,
    borderTopLeftRadius: radii.l,
    borderTopRightRadius: radii.l,
  },
});
