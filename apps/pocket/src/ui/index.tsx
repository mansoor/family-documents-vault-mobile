import { colours, radii, statusTone, TAP_MIN, type as typeScale, type Status } from '@fdv/shared';
import { AlertTriangle, CheckCircle2, Clock, Info, XCircle, type LucideIcon } from 'lucide-react-native';
import { useEffect, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  Pressable,
  Text as RNText,
  TextInput,
  View,
  StyleSheet,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useTextScale } from './text-scale';

/**
 * The app's building blocks, drawn from @fdv/shared's tokens so the phone
 * and the web say things in the same colours. Every text size goes through
 * Large text; every pressable is at least 44 dp with its hit slop.
 */

type Variant = 'hero' | 'title' | 'screen' | 'body' | 'secondary' | 'small';

const SIZES: Record<Variant, number> = {
  hero: typeScale.display.hero,
  title: typeScale.display.title,
  screen: typeScale.display.screen,
  body: typeScale.body,
  secondary: typeScale.secondary,
  small: typeScale.small,
};

export function Text(props: {
  children: ReactNode;
  variant?: Variant;
  tone?: 'ink' | 'soft' | 'muted' | 'accent' | 'warn' | 'danger' | 'onAccent';
  weight?: '400' | '500' | '600' | '700';
  style?: StyleProp<TextStyle>;
  role?: 'header' | 'text' | 'alert';
  testID?: string;
}) {
  const { scale } = useTextScale();
  const variant = props.variant ?? 'body';
  const size = SIZES[variant] * scale;
  const display = variant === 'hero' || variant === 'title' || variant === 'screen';
  const color = {
    ink: colours.ink,
    soft: colours.inkSoft,
    muted: colours.inkMuted,
    accent: colours.accent,
    warn: colours.warn,
    danger: colours.danger,
    onAccent: colours.onAccent,
  }[props.tone ?? 'ink'];
  return (
    <RNText
      testID={props.testID}
      accessibilityRole={props.role ?? (display ? 'header' : 'text')}
      style={[
        {
          fontSize: size,
          lineHeight: Math.round(size * (display ? 1.2 : 1.45)),
          color,
          fontWeight: props.weight ?? (display ? '600' : '400'),
        },
        props.style,
      ]}
    >
      {props.children}
    </RNText>
  );
}

export function Button(props: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'quiet' | 'danger';
  disabled?: boolean;
  busy?: boolean;
  hint?: string;
  testID?: string;
  /** What a screen reader says, when the label is a symbol ("‹", "+"). */
  accessibilityLabel?: string;
}) {
  const kind = props.kind ?? 'primary';
  const disabled = props.disabled === true || props.busy === true;
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      {...(props.hint ? { accessibilityHint: props.hint } : {})}
      accessibilityState={{ disabled, busy: props.busy === true }}
      disabled={disabled}
      onPress={props.onPress}
      hitSlop={8}
      style={({ pressed }) => [
        styles.button,
        kind === 'quiet' ? styles.quiet : kind === 'danger' ? styles.danger : styles.primary,
        disabled ? styles.disabled : null,
        pressed ? styles.pressed : null,
      ]}
    >
      <Text weight="700" tone={kind === 'quiet' ? 'ink' : 'onAccent'} role="text">
        {props.label}
      </Text>
    </Pressable>
  );
}

export function Card(props: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, props.style]}>{props.children}</View>;
}

const NOTICE: Record<'info' | 'ok' | 'warn' | 'danger', { icon: LucideIcon; ink: string; bg: string }> = {
  info: { icon: Info, ink: colours.accent, bg: colours.accentSoft },
  ok: { icon: CheckCircle2, ink: colours.ok, bg: colours.accentSoft },
  warn: { icon: AlertTriangle, ink: colours.warn, bg: colours.warnSoft },
  danger: { icon: XCircle, ink: colours.danger, bg: colours.dangerSoft },
};

/**
 * A sentence with an icon and a tone — never a colour alone. Said aloud
 * when it appears: Android reads out neither a new view nor the alert
 * role by itself. `announce` is what to say when the children are more
 * than words.
 */
export function Notice(props: { tone?: keyof typeof NOTICE; children: ReactNode; testID?: string; announce?: string }) {
  const n = NOTICE[props.tone ?? 'info'];
  const Icon = n.icon;
  const words = props.announce ?? (typeof props.children === 'string' ? props.children : null);
  useEffect(() => {
    if (words) AccessibilityInfo.announceForAccessibility(words);
  }, [words]);
  return (
    <View
      testID={props.testID}
      accessibilityRole="alert"
      accessibilityLiveRegion={props.tone === 'danger' ? 'assertive' : 'polite'}
      style={[styles.notice, { backgroundColor: n.bg }]}
    >
      <Icon color={n.ink} size={20} accessibilityElementsHidden importantForAccessibility="no" />
      <View style={styles.noticeText}>
        {typeof props.children === 'string' ? <Text>{props.children}</Text> : props.children}
      </View>
    </View>
  );
}

const STATUS_ICON: Record<string, LucideIcon> = {
  check: CheckCircle2,
  clock: Clock,
  alert: AlertTriangle,
  x: XCircle,
  info: Info,
};

/** A document's status: an icon and its words, from @fdv/shared's statusTone. */
export function StatusLine(props: { status: Status }) {
  const tone = statusTone(props.status);
  if (!tone) return null;
  const Icon = STATUS_ICON[tone.icon] ?? Info;
  const ink = tone.tone === 'danger' ? colours.danger : tone.tone === 'warn' ? colours.warn : tone.tone === 'ok' ? colours.ok : colours.inkMuted;
  return (
    <View style={styles.status}>
      <Icon color={ink} size={16} accessibilityElementsHidden importantForAccessibility="no" />
      <Text variant="secondary" style={{ color: ink }} weight="600">
        {tone.words}
      </Text>
    </View>
  );
}

export function Field(
  props: {
    label: string;
    error?: string | null;
    testID?: string;
  } & Omit<TextInputProps, 'style'>,
) {
  const { label, error, testID, ...input } = props;
  const { scale } = useTextScale();
  return (
    <View style={styles.field}>
      <Text variant="secondary" weight="600" tone="soft">
        {label}
      </Text>
      <TextInput
        testID={testID}
        accessibilityLabel={label}
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor={colours.inkMuted}
        style={[styles.input, { fontSize: typeScale.body * scale }, error ? styles.inputError : null]}
        {...input}
      />
      {error ? (
        <Text variant="secondary" tone="danger" role="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: TAP_MIN,
    borderRadius: radii.m,
    paddingHorizontal: 18,
    paddingVertical: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  primary: { backgroundColor: colours.accent },
  danger: { backgroundColor: colours.danger },
  quiet: { backgroundColor: colours.surface, borderWidth: 1, borderColor: colours.borderInput },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
  card: {
    backgroundColor: colours.surface,
    borderRadius: radii.l,
    borderWidth: 1,
    borderColor: colours.border,
    padding: 16,
    gap: 12,
  },
  notice: { flexDirection: 'row', gap: 10, padding: 12, borderRadius: radii.m, alignItems: 'flex-start' },
  noticeText: { flex: 1, gap: 8 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  field: { gap: 6 },
  input: {
    minHeight: TAP_MIN,
    borderWidth: 1,
    borderColor: colours.borderInput,
    borderRadius: radii.m,
    paddingHorizontal: 14,
    color: colours.ink,
    backgroundColor: colours.surface,
  },
  inputError: { borderColor: colours.danger },
});
