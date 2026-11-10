import { radii } from '@fdv/shared';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { Clock, FileQuestion, Inbox, X } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { reminderHeadline } from '../documents/reminders';
import { Text } from '../ui';
import { PickerSheet } from '../ui/picker';
import { sp } from '../ui/space';
import { useColours, useStyles, type Palette } from '../ui/theme';
import { HIDE_CHOICES, hide, prune, readHidden, shows, unhide, writeHidden, type HideFor, type HomeAlert } from './alerts';

/** How many alerts Home shows before "and N more", which the bell holds. */
const SHOWN = 3;

/**
 * Home's alerts (R4): each a card that says what needs doing and does it —
 * Open, Scan the new one, Name them, Open your Inbox — and a ✕ that hides
 * it on this phone for a day, a week, 30 days or until it changes, with
 * Undo for a moment after. Three at most; the rest are behind the bell.
 * With none, nothing is said: Home has no "nothing to do".
 */
export function AlertCards(props: {
  alerts: readonly HomeAlert[];
  /** Whose these are: the vault and the person, for what this phone keeps hidden. */
  who: string;
  canRenew: (alert: HomeAlert) => boolean;
  onRenew: (documentId: string) => void;
  inboxOrigin: string | null;
}) {
  const styles = useStyles(makeStyles);
  const { t } = useTranslation();
  const router = useRouter();
  const [hidden, setHidden] = useState(() => readHidden(props.who));
  const [hiding, setHiding] = useState<HomeAlert | null>(null);
  const [undo, setUndo] = useState<{ alert: HomeAlert; by: HideFor } | null>(null);
  // The time, taken again each time the alerts are: a day's hiding ends with it.
  const [now, setNow] = useState(() => Date.now());

  // What was hidden for alerts that have gone, or whose days are over, is let go of.
  const { alerts, who } = props;
  useEffect(() => {
    const at = Date.now();
    // Set as the alerts arrive, not while drawing.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(at);
    writeHidden(who, prune(readHidden(who), alerts, at));
  }, [alerts, who]);

  const visible = useMemo(() => alerts.filter((a) => shows(a, hidden, now)), [alerts, hidden, now]);
  const more = visible.length - SHOWN;

  const hideBy = (alert: HomeAlert, by: HideFor) => {
    const next = hide(hidden, alert, by, Date.now());
    setHidden(next);
    writeHidden(who, next);
    setUndo({ alert, by });
  };
  const putBack = () => {
    if (!undo) return;
    const next = unhide(hidden, undo.alert);
    setHidden(next);
    writeHidden(who, next);
    setUndo(null);
  };

  const hideWords = (by: HideFor) => t(`alerts.hide_${by}`);

  return (
    <View style={styles.list} testID="home-alerts">
      {visible.slice(0, SHOWN).map((a) => (
        <AlertCard
          key={a.key}
          alert={a}
          onHide={() => setHiding(a)}
          renew={props.canRenew(a) && a.reminder ? () => props.onRenew(a.reminder?.document_id ?? '') : null}
          inboxOrigin={props.inboxOrigin}
        />
      ))}
      {more > 0 ? (
        <Pressable
          testID="home-alerts-more"
          accessibilityRole="button"
          accessibilityLabel={t('alerts.more', { count: more })}
          hitSlop={6}
          onPress={() => router.push('/attention')}
          style={({ pressed }) => [styles.more, pressed ? styles.pressed : null]}
        >
          <Text variant="secondary" weight="600" tone="accent">
            {t('alerts.more', { count: more })}
          </Text>
        </Pressable>
      ) : null}
      {undo ? (
        <View style={styles.undo} testID="home-alert-hidden" accessibilityLiveRegion="polite">
          <Text variant="secondary" tone="soft" style={styles.flex}>
            {t('alerts.hidden', { when: t(`alerts.back_${undo.by}`) })}
          </Text>
          <Pressable
            testID="home-alert-undo"
            accessibilityRole="button"
            accessibilityLabel={t('alerts.undo')}
            hitSlop={8}
            onPress={putBack}
            style={({ pressed }) => [styles.undoButton, pressed ? styles.pressed : null]}
          >
            <Text variant="secondary" weight="700" tone="accent">
              {t('alerts.undo')}
            </Text>
          </Pressable>
        </View>
      ) : null}
      <PickerSheet
        visible={hiding !== null}
        title={t('alerts.hideTitle')}
        options={HIDE_CHOICES.map((by) => ({ value: String(by), label: hideWords(by) }))}
        chosen={[]}
        onDone={([v]) => {
          const alert = hiding;
          setHiding(null);
          if (alert && v) hideBy(alert, v === 'change' ? 'change' : (Number(v) as HideFor));
        }}
        onClose={() => setHiding(null)}
        testID="alert-hide"
        optionID="alert-hide"
      />
    </View>
  );
}

function AlertCard(props: {
  alert: HomeAlert;
  onHide: () => void;
  renew: (() => void) | null;
  inboxOrigin: string | null;
}) {
  const styles = useStyles(makeStyles);
  const colours = useColours();
  const { t } = useTranslation();
  const router = useRouter();
  const a = props.alert;
  const r = a.reminder;
  const address = props.inboxOrigin ? `${props.inboxOrigin}/inbox`.replace(/^https?:\/\//, '') : '';
  const [Icon, title, words, testID] =
    a.kind === 'reminder' && r
      ? [Clock, r.document_title ?? t('home.untitled'), reminderHeadline(r), `home-alert-${r.id}`]
      : a.kind === 'unnamed'
        ? [FileQuestion, t('home.needName', { count: a.count ?? 0 }), t('alerts.unnamedWords'), 'home-unnamed']
        : [Inbox, t('home.inbox', { count: a.count ?? 0 }), t('home.inboxAt', { address }), 'home-inbox'];
  const actions: { label: string; onPress: () => void; testID: string; hint?: string }[] =
    a.kind === 'reminder' && r
      ? [
          {
            label: t('alerts.open'),
            onPress: () => router.push({ pathname: '/document/[id]', params: { id: r.document_id } }),
            testID: `home-alert-open-${r.id}`,
          },
          ...(props.renew ? [{ label: t('home.renew'), onPress: props.renew, testID: `renew-${r.document_id}`, hint: t('home.renewHint') }] : []),
        ]
      : a.kind === 'unnamed'
        ? [
            {
              label: t('alerts.nameThem'),
              onPress: () => router.push({ pathname: '/documents', params: { status: 'needs_info' } }),
              testID: 'home-unnamed-open',
            },
          ]
        : props.inboxOrigin
          ? [
              {
                label: t('home.inboxOpen'),
                onPress: () => void Linking.openURL(`${props.inboxOrigin}/inbox`),
                testID: 'home-inbox-open',
                hint: t('home.inboxOpenHint', { address }),
              },
            ]
          : [];
  return (
    <View style={styles.card} testID={testID}>
      <Icon color={colours.warn} size={18} accessibilityElementsHidden importantForAccessibility="no" />
      <View style={styles.flex}>
        <Text weight="600">{title}</Text>
        <Text variant="secondary" tone="soft" {...(a.kind === 'inbox' ? { testID: 'home-inbox-address' } : {})}>
          {words}
        </Text>
        {actions.length > 0 ? (
          <View style={styles.actions}>
            {actions.map((x) => (
              <Pressable
                key={x.testID}
                testID={x.testID}
                accessibilityRole="button"
                accessibilityLabel={x.label}
                {...(x.hint ? { accessibilityHint: x.hint } : {})}
                hitSlop={8}
                onPress={x.onPress}
                style={({ pressed }) => [styles.action, pressed ? styles.pressed : null]}
              >
                <Text variant="secondary" weight="700" tone="accent">
                  {x.label}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
      <Pressable
        testID={`${testID}-hide`}
        accessibilityRole="button"
        accessibilityLabel={t('alerts.hideLabel', { title })}
        hitSlop={6}
        onPress={props.onHide}
        style={({ pressed }) => [styles.close, pressed ? styles.pressed : null]}
      >
        <X color={colours.inkSoft} size={18} accessibilityElementsHidden importantForAccessibility="no" />
      </Pressable>
    </View>
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    list: { gap: sp(8) },
    card: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: sp(10),
      paddingVertical: sp(10),
      paddingLeft: sp(12),
      paddingRight: sp(4),
      borderRadius: radii.l,
      borderWidth: 1,
      borderColor: colours.border,
      backgroundColor: colours.surface,
    },
    flex: { flex: 1, gap: sp(4) },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: sp(16), marginTop: sp(4) },
    action: { minHeight: 28, justifyContent: 'center' },
    close: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
    more: { minHeight: 32, justifyContent: 'center', paddingHorizontal: sp(4) },
    undo: { flexDirection: 'row', alignItems: 'center', gap: sp(8), paddingHorizontal: sp(4) },
    undoButton: { minHeight: 32, justifyContent: 'center' },
    pressed: { opacity: 0.7 },
  });
