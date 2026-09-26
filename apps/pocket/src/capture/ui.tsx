import { colours, radii, TAP_MIN } from '@fdv/shared';
import { Image } from 'expo-image';
import { ArrowLeft, ArrowRight, Camera, FileText, Plus, Trash2 } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type PlatformOSType,
  type TextInputProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { PageRef, PickedFile } from '../queue/commit';
import { Button, Text } from '../ui';

/**
 * One choice among several: a chip that says whether it is chosen — or,
 * given `expanded`, one that opens more (More…), and says whether it is open.
 */
export function Chip(props: {
  label: string;
  selected?: boolean;
  expanded?: boolean;
  disabled?: boolean;
  onPress: () => void;
  testID?: string;
  leading?: string;
}) {
  const selected = props.selected === true || props.expanded === true;
  const disabled = props.disabled === true;
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={
        props.expanded === undefined ? { selected, disabled } : { expanded: props.expanded, disabled }
      }
      disabled={disabled}
      onPress={props.onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.chip,
        selected ? styles.chipOn : null,
        disabled ? styles.chipOff : null,
        pressed ? styles.pressed : null,
      ]}
    >
      {props.leading ? (
        <View style={[styles.avatar, selected ? styles.avatarOn : null]}>
          <Text weight="700" tone={selected ? 'accent' : 'soft'} role="text">
            {props.leading}
          </Text>
        </View>
      ) : null}
      <Text weight="600" tone={selected ? 'onAccent' : 'ink'} role="text">
        {props.label}
      </Text>
    </Pressable>
  );
}

/** Chips in a row that wraps: a single choice (a radio group), or just actions side by side. */
export function ChipRow(props: { children: ReactNode; label: string; role?: 'radiogroup' | 'none' }) {
  if (props.role === 'none') return <View style={styles.chips}>{props.children}</View>;
  return (
    <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={props.label}>
      {props.children}
    </View>
  );
}

function IconButton(props: { label: string; onPress: () => void; disabled?: boolean; icon: typeof Camera }) {
  const Icon = props.icon;
  const disabled = props.disabled === true;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={props.onPress}
      style={({ pressed }) => [styles.iconButton, disabled ? styles.chipOff : null, pressed ? styles.pressed : null]}
    >
      <Icon color={colours.ink} size={20} accessibilityElementsHidden importantForAccessibility="no" />
    </Pressable>
  );
}

/**
 * The scanned pages, in order, each with its own buttons — Move earlier,
 * Move later, Remove, Retake — so nothing needs dragging or two fingers.
 */
export function PageStrip(props: {
  pages: PageRef[];
  /** While a Save is under way: look, don't touch. */
  disabled?: boolean;
  canScan: boolean;
  canAdd: boolean;
  onMoveEarlier: (i: number) => void;
  onMoveLater: (i: number) => void;
  onRemove: (i: number) => void;
  onRetake: (i: number) => void;
  onAdd: () => void;
}) {
  const { t } = useTranslation();
  const n = props.pages.length;
  const off = props.disabled === true;
  return (
    <ScrollView horizontal contentContainerStyle={styles.strip} testID="page-strip">
      {props.pages.map((p, i) => (
        <View key={p.uri} style={styles.page}>
          <Image
            source={{ uri: p.uri }}
            // A scanned page never lands in the phone's image cache: after
            // Save it lives only in the encrypted queue.
            cachePolicy="none"
            style={styles.thumb}
            contentFit="cover"
            accessibilityLabel={t('capture.page', { n: i + 1 })}
            accessibilityIgnoresInvertColors
          />
          <View style={styles.pageButtons}>
            <IconButton
              icon={ArrowLeft}
              label={t('capture.moveEarlier', { n: i + 1 })}
              disabled={off || i === 0}
              onPress={() => props.onMoveEarlier(i)}
            />
            <IconButton
              icon={ArrowRight}
              label={t('capture.moveLater', { n: i + 1 })}
              disabled={off || i === n - 1}
              onPress={() => props.onMoveLater(i)}
            />
          </View>
          <View style={styles.pageButtons}>
            <IconButton
              icon={Trash2}
              label={t('capture.removePage', { n: i + 1 })}
              disabled={off || n === 1}
              onPress={() => props.onRemove(i)}
            />
            {props.canScan ? (
              <IconButton
                icon={Camera}
                label={t('capture.retake', { n: i + 1 })}
                disabled={off}
                onPress={() => props.onRetake(i)}
              />
            ) : null}
          </View>
        </View>
      ))}
      {props.canScan ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('capture.addPage')}
          {...(props.canAdd ? {} : { accessibilityHint: t('capture.pageLimit') })}
          accessibilityState={{ disabled: off || !props.canAdd }}
          disabled={off || !props.canAdd}
          onPress={props.onAdd}
          style={({ pressed }) => [
            styles.addPage,
            !props.canAdd ? styles.chipOff : null,
            pressed ? styles.pressed : null,
          ]}
        >
          <Plus color={colours.accent} size={24} accessibilityElementsHidden importantForAccessibility="no" />
          <Text weight="600" tone="accent" role="text">
            {t('capture.addPage')}
          </Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

type DetailInput = Pick<TextInputProps, 'autoCapitalize' | 'multiline' | 'keyboardType' | 'placeholder'>;

/**
 * How each kind of the type's own details is typed: the keyboard, and an
 * example. Each platform gets a keyboard it has: Android opens its letters
 * for one it does not know (numbers-and-punctuation is iOS's), and its
 * `numeric` takes a sign and a point. A decimal is typed with a point
 * (readDetail), which iOS's decimal pad may not offer — it shows the
 * region's separator, a comma in much of Europe — so iOS types numbers
 * and amounts on its numbers-and-punctuation keyboard.
 */
export function detailInput(kind: string, os: PlatformOSType = Platform.OS): DetailInput | undefined {
  const ios = os === 'ios';
  switch (kind) {
    case 'text':
      return { autoCapitalize: 'sentences' };
    case 'long_text':
      return { autoCapitalize: 'sentences', multiline: true };
    case 'date':
      return { placeholder: '14 Mar 2031' };
    case 'year':
      return { keyboardType: 'number-pad', placeholder: '2026' };
    case 'number':
      return { keyboardType: ios ? 'numbers-and-punctuation' : 'numeric' };
    case 'money':
      return { keyboardType: ios ? 'numbers-and-punctuation' : 'decimal-pad', placeholder: '12.50' };
    default:
      return undefined;
  }
}

export function sizeWords(bytes: number | null): string {
  if (bytes === null) return '';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

/** A picked file shows as one row: its name and its size. */
export function FileRow(props: { file: PickedFile }) {
  const { t } = useTranslation();
  const size = sizeWords(props.file.size);
  return (
    <View
      style={styles.fileRow}
      accessible
      accessibilityLabel={size ? t('capture.file', { name: props.file.name, size }) : props.file.name}
    >
      <FileText color={colours.accent} size={28} accessibilityElementsHidden importantForAccessibility="no" />
      <Text weight="600" style={styles.flex}>
        {size ? t('capture.file', { name: props.file.name, size }) : props.file.name}
      </Text>
    </View>
  );
}

/** Back with a scan on the card: keep it, lose it, or carry on. */
export function LeaveQuestion(props: {
  visible: boolean;
  onSaveWithout: () => void;
  onThrowAway: () => void;
  onKeepEditing: () => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  // The sheet sits above the navigation bar, which the window now draws under.
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={props.visible} transparent animationType="fade" onRequestClose={props.onKeepEditing}>
      <View style={styles.scrim}>
        <View
          style={[styles.sheet, { paddingBottom: 20 + insets.bottom }]}
          accessibilityViewIsModal
          testID="leave-question"
        >
          <Text variant="screen">{t('capture.backTitle')}</Text>
          <Button
            label={t('capture.saveWithout')}
            onPress={props.onSaveWithout}
            disabled={props.disabled === true}
            testID="leave-save"
          />
          <Button
            label={t('capture.throwAway')}
            kind="danger"
            onPress={props.onThrowAway}
            disabled={props.disabled === true}
            testID="leave-throw"
          />
          <Button label={t('capture.keepEditing')} kind="quiet" onPress={props.onKeepEditing} testID="leave-keep" />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    minHeight: TAP_MIN,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colours.borderInput,
    backgroundColor: colours.surface,
  },
  chipOn: { backgroundColor: colours.accent, borderColor: colours.accent },
  chipOff: { opacity: 0.45 },
  pressed: { opacity: 0.8 },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colours.accentSoft,
  },
  avatarOn: { backgroundColor: colours.surface },
  strip: { gap: 12, paddingVertical: 4 },
  page: { gap: 6, alignItems: 'center' },
  thumb: {
    width: 96,
    height: 128,
    borderRadius: radii.s,
    backgroundColor: colours.accentSoft,
  },
  pageButtons: { flexDirection: 'row', gap: 4 },
  iconButton: {
    width: TAP_MIN,
    height: TAP_MIN,
    borderRadius: radii.s,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colours.border,
    backgroundColor: colours.surface,
  },
  addPage: {
    width: 96,
    height: 128,
    borderRadius: radii.s,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colours.accent,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    minHeight: TAP_MIN,
    borderRadius: radii.l,
    borderWidth: 1,
    borderColor: colours.border,
    backgroundColor: colours.surface,
  },
  flex: { flex: 1 },
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(28,26,23,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colours.bg,
    padding: 20,
    gap: 12,
    borderTopLeftRadius: radii.l,
    borderTopRightRadius: radii.l,
  },
});
