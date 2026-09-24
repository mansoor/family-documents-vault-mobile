import { colours, TAP_MIN } from '@fdv/shared';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

/** The few pieces the spike and probe screens are drawn with. Spike only. */

export function Button(props: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  quiet?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: props.disabled === true }}
      disabled={props.disabled === true}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.button,
        props.quiet ? styles.quiet : null,
        props.disabled ? styles.disabled : null,
        pressed ? styles.pressed : null,
      ]}
    >
      <Text style={[styles.buttonText, props.quiet ? styles.quietText : null]}>{props.label}</Text>
    </Pressable>
  );
}

export function Field(props: { label: string } & TextInputProps) {
  const { label, ...input } = props;
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
        placeholderTextColor={colours.inkMuted}
        {...input}
      />
    </View>
  );
}

export function Card(props: { title: string; children: ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle} accessibilityRole="header">
        {props.title}
      </Text>
      {props.children}
    </View>
  );
}

export function Line(props: { children: ReactNode; tone?: 'ok' | 'danger' | 'muted' }) {
  const tone =
    props.tone === 'ok' ? colours.ok : props.tone === 'danger' ? colours.danger : props.tone === 'muted' ? colours.inkMuted : colours.ink;
  return <Text style={[styles.line, { color: tone }]}>{props.children}</Text>;
}

const styles = StyleSheet.create({
  button: {
    minHeight: TAP_MIN,
    borderRadius: 12,
    backgroundColor: colours.accent,
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  quiet: { backgroundColor: colours.surface, borderWidth: 1, borderColor: colours.borderInput },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.8 },
  buttonText: { color: colours.onAccent, fontSize: 16, fontWeight: '700' },
  quietText: { color: colours.ink },
  field: { gap: 4 },
  label: { color: colours.inkSoft, fontSize: 14, fontWeight: '600' },
  input: {
    minHeight: TAP_MIN,
    borderWidth: 1,
    borderColor: colours.borderInput,
    borderRadius: 12,
    paddingHorizontal: 12,
    fontSize: 16,
    color: colours.ink,
    backgroundColor: colours.surface,
  },
  card: {
    backgroundColor: colours.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colours.border,
    padding: 14,
    gap: 10,
  },
  cardTitle: { fontSize: 18, fontWeight: '700', color: colours.ink },
  line: { fontSize: 15, fontVariant: ['tabular-nums'] },
});
