import { EMERGENCY_AUDIENCE_LABELS, EMERGENCY_AUDIENCES, radii, type EmergencyAudience, type EmergencyView } from '@fdv/shared';
import { Check } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { wordsFor } from '../errors/words';
import { useStepUp } from '../state/step-up';
import { useVault } from '../state/vault';
import { Button, Notice, Text } from '../ui';
import { feel } from '../ui/feel';
import { Sheet } from '../ui/sheet';
import { sp } from '../ui/space';
import { useColours, useStyles, type Palette } from '../ui/theme';
import { chosenToStart, losing } from './edit-model';

/**
 * Who can see a person's emergency information (app 0.19.0; the vault's
 * H4), as the web's form: the person and the owners always can, and so can
 * a caregiver they keep; besides them, only them and the owners, every
 * adult too, or everyone in the family — and these people too, named from
 * the family's adults and teens who sign in. The person chooses, signed in
 * as a grown-up; an owner for anybody else (the vault's `can_choose`).
 */
export function AudienceSheet(props: {
  view: EmergencyView;
  name: string;
  mine: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const styles = useStyles(makeStyles);
  const colours = useColours();
  const { t } = useTranslation();
  const { offline } = useVault();
  const { guarded } = useStepUp();
  const [audience, setAudience] = useState<EmergencyAudience>(props.view.audience);
  const candidates = props.view.candidates ?? [];
  // Only those who may still be named: somebody since made a viewer or an owner is taken off, and said.
  const [start] = useState(() => chosenToStart(props.view.chosen, candidates));
  const [chosen, setChosen] = useState<string[]>(start.ids);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Anybody the new choice takes it from loses their exports of it (the vault ends them).
  const takesAway =
    losing(
      { audience: props.view.audience, chosen: props.view.chosen.map((c) => c.member_id) },
      { audience, chosen },
      candidates,
    ).length > 0;

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const saved = await guarded((a, tk) =>
        a.setEmergencyAudience(tk, props.view.member_id, { audience, chosen_member_ids: chosen }),
      );
      if (saved === null) return;
      feel('done');
      props.onSaved();
    } catch (err) {
      setProblem(wordsFor(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible onClose={() => (busy ? undefined : props.onClose())} testID="emergency-who-sheet" tall>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
        <Text variant="screen">
          {props.mine ? t('emergencyWho.titleMine') : t('emergencyWho.title', { name: props.name })}
        </Text>
        <Text variant="secondary" tone="soft" testID="emergency-who-always">
          {props.mine ? t('emergencyWho.alwaysMine') : t('emergencyWho.always', { name: props.name })}
        </Text>
        <View accessibilityRole="radiogroup" accessibilityLabel={t('emergencyWho.choose')} style={styles.choices}>
          {EMERGENCY_AUDIENCES.map((a) => {
            const on = audience === a;
            return (
              <Pressable
                key={a}
                testID={`emergency-who-${a}`}
                accessibilityRole="radio"
                accessibilityLabel={EMERGENCY_AUDIENCE_LABELS[a]}
                accessibilityState={{ checked: on, disabled: busy }}
                disabled={busy}
                onPress={() => setAudience(a)}
                style={({ pressed }) => [styles.choice, on ? styles.chosen : null, pressed ? styles.pressed : null]}
              >
                <Text weight={on ? '600' : '400'} style={styles.flex}>
                  {EMERGENCY_AUDIENCE_LABELS[a]}
                </Text>
                {on ? <Check color={colours.accent} size={20} accessibilityElementsHidden importantForAccessibility="no" /> : null}
              </Pressable>
            );
          })}
        </View>

        {candidates.length > 0 ? (
          <View style={styles.section} testID="emergency-who-people">
            <Text variant="secondary" weight="600" tone="soft">
              {t('emergencyWho.andThese')}
            </Text>
            {candidates.map((c) => {
              const on = chosen.includes(c.member_id);
              return (
                <Pressable
                  key={c.member_id}
                  testID={`emergency-who-person-${c.member_id}`}
                  accessibilityRole="checkbox"
                  accessibilityLabel={c.name}
                  accessibilityState={{ checked: on, disabled: busy }}
                  disabled={busy}
                  onPress={() =>
                    setChosen((now) => (on ? now.filter((x) => x !== c.member_id) : [...now, c.member_id]))
                  }
                  style={({ pressed }) => [styles.item, pressed ? styles.pressed : null]}
                >
                  <View style={[styles.box, on ? styles.boxOn : null]}>
                    {on ? <Check color={colours.accent} size={16} accessibilityElementsHidden importantForAccessibility="no" /> : null}
                  </View>
                  <Text style={styles.flex}>{c.name}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {start.dropped.length > 0 ? (
          <Text variant="small" tone="soft" testID="emergency-who-dropped">
            {t('emergencyWho.dropped', { count: start.dropped.length, names: start.dropped.join(', ') })}
          </Text>
        ) : null}
        {takesAway ? (
          <Text variant="small" tone="soft" testID="emergency-who-exports">
            {t('emergencyWho.exports')}
          </Text>
        ) : null}
        {offline ? (
          <Notice tone="warn" testID="emergency-who-offline">
            {t('emergency.changeNeedsConnection')}
          </Notice>
        ) : null}
        {problem ? (
          <Notice tone="warn" testID="emergency-who-problem">
            {problem}
          </Notice>
        ) : null}
        <Button
          label={t('emergencyEdit.save')}
          busy={busy}
          disabled={offline}
          onPress={() => void save()}
          testID="emergency-who-save"
        />
        <Button kind="quiet" label={t('common.cancel')} disabled={busy} onPress={props.onClose} testID="emergency-who-cancel" />
      </ScrollView>
    </Sheet>
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    scroll: { flexGrow: 0, flexShrink: 1 },
    body: { gap: sp(12) },
    section: { gap: sp(6) },
    choices: { gap: sp(8) },
    choice: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: sp(10),
      minHeight: 48,
      paddingHorizontal: sp(12),
      paddingVertical: sp(8),
      borderRadius: radii.m,
      borderWidth: 1,
      borderColor: colours.border,
      backgroundColor: colours.surface,
    },
    chosen: { borderColor: colours.accent },
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
  });
