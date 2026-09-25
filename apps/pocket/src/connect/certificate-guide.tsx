import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View } from 'react-native';
import type { CertificateTrouble } from '../net/tls';
import { Button, Notice, Text } from '../ui';

/**
 * A certificate this phone will not accept (4.15), in words, and — for a
 * vault that makes its own — how to install it once: Android's steps, and
 * iPhone's (a profile, then Full Trust).
 */
export function CertificateTroubleNotice(props: { trouble: CertificateTrouble }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (props.trouble === 'wrong_name') {
    return (
      <Notice tone="danger" testID="connect-certificate">
        {t('connect.certificateWrongName')}
      </Notice>
    );
  }
  if (props.trouble === 'expired') {
    return (
      <Notice tone="danger" testID="connect-certificate">
        {t('connect.certificateExpired')}
      </Notice>
    );
  }
  return (
    <View style={styles.stack}>
      <Notice tone="warn" testID="connect-certificate">
        <Text>{t('connect.certificateUntrusted')}</Text>
        {!open ? (
          <Button
            testID="connect-certificate-how"
            kind="quiet"
            label={t('connect.showHow')}
            onPress={() => setOpen(true)}
          />
        ) : null}
      </Notice>
      {open ? (
        <View style={styles.stack} testID="connect-certificate-guide">
          <Text variant="title">{t('connect.guideTitle')}</Text>
          {Platform.OS === 'ios' ? (
            <Text>{t('connect.guideIphone')}</Text>
          ) : (
            <>
              <Text>{t('connect.guideAndroid1')}</Text>
              <Text>{t('connect.guideAndroid2')}</Text>
              <Text>{t('connect.guideAndroid3')}</Text>
              <Text>{t('connect.guideAndroid4')}</Text>
              <Text tone="soft" variant="secondary">
                {t('connect.guideAndroidRemove')}
              </Text>
            </>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 8 },
});
