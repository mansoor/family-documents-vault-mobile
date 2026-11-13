import { radii } from '@fdv/shared';
import { Check, Ellipsis } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Field, Text } from './index';
import { Chip } from './chip';
import { Sheet } from './sheet';
import { sp } from './space';
import { useColours, useStyles, type Palette } from './theme';

/** One thing to choose: its value, its words, and the group it is listed under. */
export interface PickOption {
  value: string;
  label: string;
  /** A short label for its chip, where the full one is long ("Bill" for "Utility / bill"). */
  short?: string;
  group?: string;
  /** A small letter before it on its chip: a person's initial. */
  leading?: string;
}

/**
 * Any long list to choose from (R2, the redesign): a sheet with a box to
 * find by words, the options under their groups, scrolling within the
 * sheet. One choice (`multi` off) is made by a tap, which closes it; several
 * are ticked, then Done. Instead of rows of chips that wrap down the screen.
 */
export function PickerSheet(props: {
  visible: boolean;
  title: string;
  options: readonly PickOption[];
  chosen: readonly string[];
  multi?: boolean;
  onDone: (values: string[]) => void;
  onClose: () => void;
  testID: string;
  /** The find box's testID; none, no find box (a short list). */
  findID?: string;
  /** Each option's testID: `${optionID}-${value}`. */
  optionID?: string;
}) {
  const styles = useStyles(makeStyles);
  const colours = useColours();
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [ticked, setTicked] = useState<string[]>([...props.chosen]);
  // Opened: from what is chosen now. Set while drawing, as React allows,
  // rather than on the window's onShow, which not every renderer sends.
  const chosenKey = JSON.stringify(props.chosen);
  const [openedWith, setOpenedWith] = useState<string | null>(null);
  if (props.visible && openedWith !== chosenKey) {
    setOpenedWith(chosenKey);
    setTicked([...props.chosen]);
  } else if (!props.visible && openedWith !== null) {
    setOpenedWith(null);
  }
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = props.options.filter((o) => words.every((w) => o.label.toLowerCase().includes(w)));
  const groups = useMemo(() => {
    const out: { name: string; options: PickOption[] }[] = [];
    for (const o of shown) {
      const name = o.group ?? '';
      const at = out.find((g) => g.name === name);
      if (at) at.options.push(o);
      else out.push({ name, options: [o] });
    }
    return out;
  }, [shown]);

  const close = () => {
    setQ('');
    props.onClose();
  };
  const pick = (value: string) => {
    if (!props.multi) {
      setQ('');
      props.onDone([value]);
      return;
    }
    setTicked((had) => (had.includes(value) ? had.filter((v) => v !== value) : [...had, value]));
  };

  return (
    <Sheet
      visible={props.visible}
      onClose={close}
      testID={props.testID}
      outside
      tall
      keyboard={!!props.findID}
    >
      <View style={styles.head}>
        <Text variant="screen" style={styles.flex}>
          {props.title}
        </Text>
        {props.multi && ticked.length > 0 ? (
          <Text variant="secondary" tone="soft">
            {t('picker.chosen', { count: ticked.length })}
          </Text>
        ) : null}
      </View>
      {props.findID ? (
        <Field
          label={t('picker.find')}
          value={q}
          onChangeText={setQ}
          autoCapitalize="none"
          returnKeyType="search"
          clear={{ label: t('common.clearSearch'), onClear: () => setQ('') }}
          testID={props.findID}
        />
      ) : null}
      <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
        {groups.length === 0 ? (
          <Text tone="soft" testID={`${props.testID}-none`}>
            {t('picker.none')}
          </Text>
        ) : null}
        {groups.map((g) => (
          <View key={g.name} accessibilityRole={props.multi ? undefined : 'radiogroup'} accessibilityLabel={g.name || props.title}>
            {g.name ? (
              <Text variant="small" weight="700" tone="soft" style={styles.group} role="header">
                {g.name.toUpperCase()}
              </Text>
            ) : null}
            {g.options.map((o) => {
              const on = props.multi ? ticked.includes(o.value) : props.chosen.includes(o.value);
              return (
                <Pressable
                  key={o.value}
                  testID={props.optionID ? `${props.optionID}-${o.value}` : undefined}
                  accessibilityRole={props.multi ? 'checkbox' : 'radio'}
                  accessibilityLabel={o.label}
                  accessibilityState={{ checked: on }}
                  onPress={() => pick(o.value)}
                  style={({ pressed }) => [styles.option, pressed ? styles.pressed : null]}
                >
                  <Text style={styles.flex} weight={on ? '600' : '400'}>
                    {o.label}
                  </Text>
                  {on ? <Check color={colours.accent} size={20} accessibilityElementsHidden importantForAccessibility="no" /> : null}
                </Pressable>
              );
            })}
          </View>
        ))}
      </ScrollView>
      {props.multi ? (
        <View style={styles.foot}>
          <Button kind="quiet" label={t('picker.clear')} onPress={() => setTicked([])} testID={`${props.testID}-clear`} />
          <View style={styles.flex}>
            <Button
              label={t('picker.done')}
              onPress={() => {
                setQ('');
                props.onDone(ticked);
              }}
              testID={`${props.testID}-done`}
            />
          </View>
        </View>
      ) : (
        <Button kind="quiet" label={t('common.cancel')} onPress={close} testID={`${props.testID}-cancel`} />
      )}
    </Sheet>
  );
}

/**
 * A few choices on one line, then ⋯ for the rest (R2): what is chosen
 * first, then the most used, `max` in all — never rows of chips. The ⋯
 * opens the picker, where everything is.
 */
export function ChipLine(props: {
  label: string;
  options: readonly PickOption[];
  chosen: readonly string[];
  onToggle: (value: string) => void;
  onMore: () => void;
  /** How many chips before the ⋯. */
  max?: number;
  moreID: string;
  /** Its picker is open. */
  expanded?: boolean;
  /** Each chip's testID: `${chipID}-${value}`. */
  chipID?: string;
  disabled?: boolean;
}) {
  const styles = useStyles(makeStyles);
  const colours = useColours();
  const { t } = useTranslation();
  const max = props.max ?? 3;
  const chosen = props.options.filter((o) => props.chosen.includes(o.value));
  const rest = props.options.filter((o) => !props.chosen.includes(o.value));
  const shown = [...chosen, ...rest].slice(0, Math.max(max, chosen.length));
  const hidden = props.options.length - shown.length;
  // The chips scroll sideways, smoothly, and the ⋯ stays in sight at the end
  // (the owner's ask of 12 Nov 2026: past the edge they were cut off, and a
  // drag landed as a tap on whichever was under the finger).
  return (
    <View style={styles.lineWrap}>
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      style={styles.flex}
      contentContainerStyle={styles.line}
      accessibilityRole="radiogroup"
      accessibilityLabel={props.label}
    >
      {shown.map((o) => (
        <Chip
          key={o.value}
          label={o.short ?? o.label}
          {...(o.leading ? { leading: o.leading } : {})}
          selected={props.chosen.includes(o.value)}
          disabled={props.disabled === true}
          onPress={() => props.onToggle(o.value)}
          {...(props.chipID ? { testID: `${props.chipID}-${o.value}` } : {})}
        />
      ))}
    </ScrollView>
      {hidden > 0 || props.options.length > max ? (
        <Pressable
          testID={props.moreID}
          accessibilityRole="button"
          accessibilityLabel={t('picker.more', { label: props.label, count: hidden })}
          accessibilityState={{ expanded: props.expanded === true, disabled: props.disabled === true }}
          disabled={props.disabled === true}
          hitSlop={6}
          onPress={props.onMore}
          style={({ pressed }) => [styles.more, pressed ? styles.pressed : null]}
        >
          <Ellipsis color={colours.inkSoft} size={18} accessibilityElementsHidden importantForAccessibility="no" />
          {hidden > 0 ? (
            <Text variant="secondary" weight="600" tone="soft" role="text">
              {`+${hidden}`}
            </Text>
          ) : null}
        </Pressable>
      ) : null}
    </View>
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    head: { flexDirection: 'row', alignItems: 'center', gap: sp(8) },
    flex: { flex: 1 },
    scroll: { flexGrow: 0, maxHeight: 420 },
    group: { paddingTop: sp(12), paddingBottom: sp(4), letterSpacing: 0.5 },
    option: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: sp(12),
      minHeight: 44,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colours.border,
    },
    pressed: { opacity: 0.7 },
    foot: { flexDirection: 'row', alignItems: 'center', gap: sp(8) },
    line: { flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'center', gap: sp(8), paddingRight: sp(4) },
    lineWrap: { flexDirection: 'row', alignItems: 'center', gap: sp(8) },
    more: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: sp(4),
      minHeight: 32,
      minWidth: 44,
      paddingHorizontal: sp(10),
      justifyContent: 'center',
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: colours.borderInput,
      backgroundColor: colours.surface,
    },
  });
