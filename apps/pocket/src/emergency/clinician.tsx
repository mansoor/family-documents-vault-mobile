import {
  EMERGENCY_FIELD_LABELS,
  EMERGENCY_LINK_DEFAULT_HOURS,
  radii,
  shareEndWords,
  type CreatedShare,
  type EmergencyFieldKey,
  type EmergencyView,
} from '@fdv/shared';
import { Check } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Share as SystemShare, StyleSheet, Switch, View } from 'react-native';
import { wordsFor } from '../errors/words';
import { copyForAMinute, nativeClipboard } from '../identity/clipboard';
import { EmailTheLink } from '../sharing/email-link';
import { useFamilyZone } from '../state/family-time';
import { useStepUp } from '../state/step-up';
import { useVault } from '../state/vault';
import { Button, Field, Notice, Text } from '../ui';
import { Chip, ChipRow } from '../ui/chip';
import { feel } from '../ui/feel';
import { Sheet } from '../ui/sheet';
import { sp } from '../ui/space';
import { useColours, useStyles, type Palette } from '../ui/theme';
import { LINK_HOURS, shareable, tick } from './rules';

type Lock = 'pin' | 'password' | 'none';

/**
 * Share with a clinician (H4), as the web's sheet: a link to look at the
 * parts ticked and nothing else — no documents — for the hours chosen (4
 * unless changed, 24 at most), with a PIN to tell them by default, and who
 * it is for (seen only by the family). Off, the page they see first says
 * neither whose it is nor, for the person's own, who sent it. The vault asks
 * who is holding the phone first (`share_emergency`).
 *
 * Made, the link — and its PIN or password — is shown here once: Send gives
 * the phone's own share menu, Copy puts it on the clipboard for a minute,
 * and the vault can email it where it can.
 */
export function ClinicianSheet(props: {
  view: EmergencyView;
  name: string;
  mine: boolean;
  onClose: () => void;
  onMade: () => void;
}) {
  const styles = useStyles(makeStyles);
  const colours = useColours();
  const { t } = useTranslation();
  const zone = useFamilyZone();
  const { caps, vault } = useVault();
  const { guarded } = useStepUp();
  const parts = shareable(props.view);
  const [ticked, setTicked] = useState<EmergencyFieldKey[]>(parts);
  const [hours, setHours] = useState(EMERGENCY_LINK_DEFAULT_HOURS);
  const [lock, setLock] = useState<Lock>('pin');
  const [label, setLabel] = useState('');
  const [showName, setShowName] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [made, setMade] = useState<CreatedShare | null>(null);
  const [copied, setCopied] = useState<'link' | 'secret' | null>(null);
  const passwords = caps?.features.share_second_factor === true;
  const whose = props.mine ? t('emergency.you') : props.name;

  const make = async () => {
    if (busy) return;
    if (ticked.length === 0) {
      setProblem(t('emergency.tickOne'));
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const created = await guarded((a, tk) =>
        a.makeEmergencyLink(tk, props.view.member_id, {
          fields: ticked,
          expires_in_hours: hours,
          ...(lock === 'pin' ? { with_pin: true } : lock === 'password' ? { with_password: true } : {}),
          ...(label.trim() ? { recipient_label: label.trim() } : {}),
          ...(showName ? { show_title: true } : {}),
        }),
      );
      // Not confirmed: nothing made, the sheet stays as it was.
      if (!created) return;
      feel('done');
      setMade(created);
      props.onMade();
    } catch (err) {
      setProblem(wordsFor(err, t));
    } finally {
      setBusy(false);
    }
  };

  if (made) {
    const link = made.link_url ?? `${vault?.origin ?? ''}/s#${made.link_token}`;
    const secret = made.pin ?? made.password ?? null;
    const clipboard = nativeClipboard();
    const copy = (what: 'link' | 'secret', text: string) => {
      if (clipboard && copyForAMinute(clipboard, text)) setCopied(what);
    };
    return (
      <Sheet visible onClose={props.onClose} testID="clinician-sheet" tall>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
          <Text variant="screen">{t('emergency.madeTitle')}</Text>
          <Text variant="secondary" tone="soft" testID="clinician-made-words">
            {props.mine
              ? t('emergency.madeWordsMine', { end: shareEndWords(new Date(made.share.expires_at), zone) })
              : t('emergency.madeWords', { end: shareEndWords(new Date(made.share.expires_at), zone) })}
          </Text>
          <Button label={t('share.send')} onPress={() => void SystemShare.share({ message: link })} testID="clinician-send" />
          {clipboard ? (
            <Button
              kind="quiet"
              label={copied === 'link' ? t('share.copied') : t('share.copyLink')}
              onPress={() => copy('link', link)}
              testID="clinician-copy-link"
            />
          ) : null}
          <EmailTheLink share={made.share} testID="clinician-email" />
          {secret ? (
            <View style={styles.secret}>
              <Text variant="secondary" weight="600" tone="soft">
                {made.pin ? t('share.pin') : t('share.password')}
              </Text>
              <Text variant="title" testID="clinician-secret">
                {secret}
              </Text>
              <Text variant="small" tone="soft">
                {t('share.secretApart')}
              </Text>
              {clipboard ? (
                <Button
                  kind="quiet"
                  label={copied === 'secret' ? t('share.copied') : made.pin ? t('share.copyPin') : t('share.copyPassword')}
                  onPress={() => copy('secret', secret)}
                  testID="clinician-copy-secret"
                />
              ) : null}
            </View>
          ) : null}
          <Notice tone="warn">{t('share.onlyNow')}</Notice>
          <Button kind="quiet" label={t('share.done')} onPress={props.onClose} testID="clinician-done" />
        </ScrollView>
      </Sheet>
    );
  }

  return (
    <Sheet visible onClose={() => (busy ? undefined : props.onClose())} testID="clinician-sheet" keyboard tall>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text variant="screen">{t('emergency.share')}</Text>
        <Text variant="secondary" tone="soft">
          {t('emergency.shareWords')}
        </Text>

        <View style={styles.section} testID="clinician-parts">
          <Text variant="secondary" weight="600" tone="soft">
            {t('emergency.whatItShows')}
          </Text>
          {parts.map((k) => {
            const on = ticked.includes(k);
            return (
              <Pressable
                key={k}
                testID={`clinician-part-${k}`}
                accessibilityRole="checkbox"
                accessibilityLabel={EMERGENCY_FIELD_LABELS[k]}
                accessibilityState={{ checked: on }}
                onPress={() => setTicked((now) => tick(now, k, !on))}
                style={({ pressed }) => [styles.item, pressed ? styles.pressed : null]}
              >
                <View style={[styles.box, on ? styles.boxOn : null]}>
                  {on ? <Check color={colours.accent} size={16} accessibilityElementsHidden importantForAccessibility="no" /> : null}
                </View>
                <Text style={styles.flex}>{EMERGENCY_FIELD_LABELS[k]}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.section}>
          <Text variant="secondary" weight="600" tone="soft">
            {t('emergency.worksFor')}
          </Text>
          <ChipRow label={t('emergency.worksFor')}>
            {LINK_HOURS.map((h) => (
              <Chip
                key={h}
                label={t('emergency.hours', { count: h })}
                selected={hours === h}
                onPress={() => setHours(h)}
                testID={`clinician-hours-${h}`}
              />
            ))}
          </ChipRow>
        </View>

        <View style={styles.section}>
          <Text variant="secondary" weight="600" tone="soft">
            {t('emergency.alsoNeed')}
          </Text>
          <ChipRow label={t('emergency.alsoNeed')}>
            {(['pin', ...(passwords ? (['password'] as const) : []), 'none'] as Lock[]).map((l) => (
              <Chip
                key={l}
                label={t(`emergency.lock_${l}`)}
                selected={lock === l}
                onPress={() => setLock(l)}
                testID={`clinician-lock-${l}`}
              />
            ))}
          </ChipRow>
        </View>

        <Field
          label={t('emergency.forWhom')}
          value={label}
          onChangeText={setLabel}
          maxLength={80}
          autoCapitalize="words"
          placeholder={t('emergency.forWhomExample')}
          testID="clinician-label"
        />

        <View style={styles.section}>
          <View style={styles.switchRow}>
            <Text style={styles.flex}>{t('emergency.sayWhose')}</Text>
            <Switch
              testID="clinician-show-name"
              accessibilityLabel={t('emergency.sayWhose')}
              value={showName}
              onValueChange={setShowName}
              trackColor={{ true: colours.accent, false: colours.border }}
            />
          </View>
          <Text variant="small" tone="soft" testID="clinician-show-name-words">
            {showName
              ? props.mine
                ? t('emergency.sayWhoseOnMine')
                : t('emergency.sayWhoseOn', { name: whose })
              : props.mine
                ? t('emergency.sayWhoseOffMine')
                : t('emergency.sayWhoseOff', { name: whose })}
          </Text>
        </View>

        {problem ? (
          <Notice tone="warn" testID="clinician-problem">
            {problem}
          </Notice>
        ) : null}
        <Button
          label={t('emergency.make')}
          busy={busy}
          disabled={ticked.length === 0}
          onPress={() => void make()}
          testID="clinician-make"
        />
        <Button kind="quiet" label={t('common.cancel')} disabled={busy} onPress={props.onClose} testID="clinician-cancel" />
      </ScrollView>
    </Sheet>
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    scroll: { flexGrow: 0, flexShrink: 1 },
    body: { gap: sp(12) },
    section: { gap: sp(8) },
    flex: { flex: 1 },
    item: { flexDirection: 'row', alignItems: 'center', gap: sp(10), minHeight: 44 },
    pressed: { opacity: 0.8 },
    box: {
      width: 22,
      height: 22,
      borderRadius: 6,
      borderWidth: 2,
      borderColor: colours.borderInput,
      alignItems: 'center',
      justifyContent: 'center',
    },
    boxOn: { borderColor: colours.accent },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: sp(12), minHeight: 48 },
    secret: { gap: sp(4), padding: sp(12), borderRadius: radii.m, borderWidth: 1, borderColor: colours.border },
  });
