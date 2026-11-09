import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { useEssentials, type EnrolOutcome } from '../state/essentials';
import { useLock } from '../state/lock';
import { Button, Card, Field, Notice, Text } from '../ui';
import { Sheet } from '../ui/sheet';
import { sp } from '../ui/space';
import { dayWords, useFamilyZone } from '../state/family-time';

/** A day, on the family's calendar (P5). */
export const day = (ms: number, zone: string) => dayWords(ms, zone);

/**
 * "On this phone" (4.10): a section of Home. Offered once; then what is
 * kept, each with Open and Show, how long it is kept for, and — when the
 * person has Only me Essentials not kept here — the way to keep them too.
 */
export function OnThisPhone() {
  const { t } = useTranslation();
  const zone = useFamilyZone();
  const e = useEssentials();
  const lock = useLock();
  const [asking, setAsking] = useState<null | { includePrivate: boolean; renew?: boolean }>(null);
  const [privateChoice, setPrivateChoice] = useState<null | { password: string; count: number }>(null);
  const [privateProblem, setPrivateProblem] = useState<string | null>(null);

  if (!e.available) return null;

  const afterPassword = async (password: string): Promise<EnrolOutcome> => {
    if (asking?.includePrivate) return e.enrol(password, true);
    // The password first (a wrong one is said here, on the sheet); then the
    // Only me ones, a separate, explicit choice — needing strong biometrics.
    const outcome = await e.enrol(password, false);
    if (outcome !== 'ok') return outcome;
    const count = lock.level === 'strong' ? await e.countOwnPrivate() : 0;
    if (count > 0) setPrivateChoice({ password, count });
    return 'ok';
  };

  const keepPrivateToo = async (password: string) => {
    const outcome = await e.enrol(password, true);
    // Not kept: the password again, with what went wrong.
    if (outcome !== 'ok') setAsking({ includePrivate: true });
  };

  const showPrivate = async () => {
    setPrivateProblem(null);
    const outcome = await e.openPrivate();
    if (outcome === 'changed') setPrivateProblem(t('essentials.privateChanged'));
    else if (outcome === 'unavailable') setPrivateProblem(t('essentials.privateUnavailable'));
  };

  const offer = !e.prefs.enrolled && !e.prefs.offered;
  const privateMissing = Math.max(0, e.privateInSet - e.privateKept);

  return (
    <View style={styles.section} testID="essentials">
      <EssentialsNotice />
      {offer ? (
        <Card>
          <Text>{t('essentials.offer')}</Text>
          <Button
            testID="essentials-keep"
            label={t('essentials.keep')}
            onPress={() => setAsking({ includePrivate: false })}
          />
          <Button testID="essentials-not-now" kind="quiet" label={t('essentials.notNow')} onPress={e.offered} />
        </Card>
      ) : null}
      {e.prefs.enrolled ? (
        <>
          <Text variant="screen">{t('essentials.title')}</Text>
          {e.age?.warn ? (
            <Notice tone="warn" testID="essentials-connect-by">
              {t('essentials.connectBy', { date: day(e.age.removeAt, zone) })}
            </Notice>
          ) : null}
          {e.renewDue ? (
            <Card>
              <Text>{t('essentials.renew')}</Text>
              <Button
                testID="essentials-renew"
                label={t('essentials.renewButton')}
                onPress={() => setAsking({ includePrivate: false, renew: true })}
              />
            </Card>
          ) : null}
          {e.items.length === 0 ? (
            <Text tone="soft" testID="essentials-none">
              {e.syncing ? t('essentials.syncing') : t('essentials.none')}
            </Text>
          ) : (
            <Text tone="soft" testID="essentials-count">
              {t('essentials.count', { count: e.items.length })}
            </Text>
          )}
          <KeptRows />
          {e.privateKept > 0 && !e.privateOpen && lock.level === 'strong' ? (
            <View style={styles.row}>
              <Text tone="soft" style={styles.rowText}>
                {t('essentials.privateKept', { count: e.privateKept })}
              </Text>
              <Button
                kind="quiet"
                testID="essentials-private-open"
                label={t('essentials.privateShow')}
                onPress={() => void showPrivate()}
              />
            </View>
          ) : null}
          {privateProblem ? <Notice tone="warn">{privateProblem}</Notice> : null}
          {privateMissing > 0 && lock.level === 'strong' ? (
            <View style={styles.row}>
              <Text tone="soft" style={styles.rowText}>
                {t('essentials.privateNotKept', { count: privateMissing })}
              </Text>
              <Button
                kind="quiet"
                label={t('essentials.keepThemToo')}
                onPress={() => setAsking({ includePrivate: true })}
              />
            </View>
          ) : null}
        </>
      ) : null}
      <PasswordSheet
        visible={asking !== null}
        onCancel={() => setAsking(null)}
        onPassword={async (password) => {
          const outcome = asking?.renew ? await e.regrant(password) : await afterPassword(password);
          if (outcome === 'ok') setAsking(null);
          return outcome;
        }}
      />
      <Sheet visible={privateChoice !== null} onClose={() => setPrivateChoice(null)} testID="essentials-private-choice">
        <Text>{t('essentials.alsoPrivate', { count: privateChoice?.count ?? 0 })}</Text>
        <Button
          testID="essentials-private-yes"
          label={t('essentials.alsoPrivateYes')}
          onPress={() => {
            const c = privateChoice;
            setPrivateChoice(null);
            if (c) void keepPrivateToo(c.password);
          }}
        />
        <Button
          testID="essentials-private-no"
          kind="quiet"
          label={t('essentials.alsoPrivateNo')}
          onPress={() => setPrivateChoice(null)}
        />
      </Sheet>
    </View>
  );
}

/**
 * Why kept copies went, where the person is when they go (Home, or the
 * sign-in screen after the vault signed the phone out); dismissable.
 */
export function EssentialsNotice() {
  const { t } = useTranslation();
  const e = useEssentials();
  if (!e.notice) return null;
  return (
    <Notice tone={e.notice === 'short_of_space' ? 'warn' : 'info'} testID="essentials-notice">
      <Text>
        {t(
          e.notice === 'removed_age'
            ? 'essentials.removedAge'
            : e.notice === 'signed_out'
              ? 'essentials.removedSignedOut'
              : 'essentials.shortOfSpace',
        )}
      </Text>
      <Button
        kind="quiet"
        label={t('essentials.dismiss')}
        onPress={e.dismissNotice}
        testID="essentials-notice-dismiss"
      />
    </Notice>
  );
}

/** What is kept: each with Open and Show, and how long it is kept for. */
function KeptRows() {
  const { t } = useTranslation();
  const zone = useFamilyZone();
  const router = useRouter();
  const e = useEssentials();
  return e.items.map((item) => (
    <View key={item.id} style={styles.row} testID={`essential-${item.id}`}>
      <Pressable
        style={styles.rowText}
        accessibilityRole="button"
        accessibilityLabel={`${t('essentials.open')}: ${item.document.title ?? t('essentials.untitled')}`}
        onPress={() => router.push({ pathname: '/essential/[id]', params: { id: item.id } })}
      >
        <Text weight="600">{item.document.title ?? t('essentials.untitled')}</Text>
        {e.age ? (
          <Text tone="soft" variant="secondary">
            {t('essentials.keptUntil', { date: day(e.age.removeAt, zone) })}
          </Text>
        ) : null}
      </Pressable>
      <Button
        kind="quiet"
        label={t('essentials.show')}
        testID={`essential-show-${item.id}`}
        onPress={() => router.push({ pathname: '/show/[id]', params: { id: item.id } })}
      />
    </View>
  ));
}

/**
 * On the sign-in screen, after the session simply expired: what is kept
 * can still be opened — behind the lock — though not brought up to date.
 */
export function KeptWhileSignedOut() {
  const { t } = useTranslation();
  const zone = useFamilyZone();
  const e = useEssentials();
  const lock = useLock();
  if (!e.keptWhileSignedOut) return null;
  return (
    <View style={styles.section} testID="essentials-signed-out">
      <Text variant="screen">{t('essentials.title')}</Text>
      <Notice tone="info">{t('essentials.signInToSync')}</Notice>
      {e.age?.warn ? (
        <Notice tone="warn" testID="essentials-connect-by">
          {t('essentials.connectBy', { date: day(e.age.removeAt, zone) })}
        </Notice>
      ) : null}
      {lock.status === 'unlocked' ? (
        <KeptRows />
      ) : (
        <Button
          kind="quiet"
          testID="essentials-open-kept"
          label={t('essentials.openKept')}
          onPress={() => void lock.unlock()}
        />
      )}
    </View>
  );
}

/** The password, once, for keeping Essentials (the vault's offline grant). */
export function PasswordSheet(props: {
  visible: boolean;
  onCancel: () => void;
  onPassword: (password: string) => Promise<EnrolOutcome>;
}) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => {
    setPassword('');
    setError(null);
    props.onCancel();
  };
  const go = async () => {
    setBusy(true);
    setError(null);
    const outcome = await props.onPassword(password);
    setBusy(false);
    if (outcome === 'ok') {
      setPassword('');
      return;
    }
    setError(
      t(
        outcome === 'wrong_password'
          ? 'essentials.wrongPassword'
          : outcome === 'offline'
            ? 'essentials.noConnection'
            : 'essentials.failed',
      ),
    );
  };
  return (
    <Sheet visible={props.visible} onClose={close} testID="essentials-password">
      <Text>{t('essentials.password')}</Text>
      <Field
        label={t('essentials.passwordLabel')}
        testID="essentials-password-field"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        error={error}
        onSubmitEditing={() => void go()}
      />
      <Button
        testID="essentials-password-go"
        label={t('essentials.keep')}
        onPress={() => void go()}
        disabled={busy || password.length === 0}
      />
      <Button kind="quiet" label={t('common.cancel')} onPress={close} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  section: { gap: sp(12) },
  row: { flexDirection: 'row', alignItems: 'center', gap: sp(12), minHeight: 56 },
  rowText: { flex: 1, gap: sp(4), minHeight: 44, justifyContent: 'center' },
});
