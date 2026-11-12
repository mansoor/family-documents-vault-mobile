import {
  Bold,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  Quote,
  RemoveFormatting,
  ScanText,
  Strikethrough,
  Underline,
  type LucideIcon,
} from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { radii } from '@fdv/shared';
import { Field, Notice, Text } from '../ui';
import { Chip, ChipRow } from '../ui/chip';
import { sp } from '../ui/space';
import { useColours, useStyles, type Palette } from '../ui/theme';
import { applyCommand, insertText, type NoteCommand, type Selection } from './markdown-edit';
import { NoteText } from './notes';
import { scanTextOnPhone, textScanOffered } from './scan-text';

const TOOLS: { command: NoteCommand; icon: LucideIcon; label: string }[] = [
  { command: 'bold', icon: Bold, label: 'notesEditor.bold' },
  { command: 'italic', icon: Italic, label: 'notesEditor.italic' },
  { command: 'underline', icon: Underline, label: 'notesEditor.underline' },
  { command: 'strike', icon: Strikethrough, label: 'notesEditor.strike' },
  { command: 'heading1', icon: Heading1, label: 'notesEditor.heading1' },
  { command: 'heading2', icon: Heading2, label: 'notesEditor.heading2' },
  { command: 'heading3', icon: Heading3, label: 'notesEditor.heading3' },
  { command: 'bullet', icon: List, label: 'notesEditor.bullet' },
  { command: 'numbered', icon: ListOrdered, label: 'notesEditor.numbered' },
  { command: 'checklist', icon: ListChecks, label: 'notesEditor.checklist' },
  { command: 'quote', icon: Quote, label: 'notesEditor.quote' },
  { command: 'link', icon: Link, label: 'notesEditor.link' },
  { command: 'clear', icon: RemoveFormatting, label: 'notesEditor.clear' },
];

/**
 * The notes editor (the owner's ask of 12 Nov 2026: "to match with the
 * web"): the web's toolbar — bold, italic, underline, struck through, three
 * headings, lists, a checklist, a quote, a link and Clear formatting —
 * acting on the note's words where the cursor is (markdown-edit.ts), and
 * Write / Preview, the preview drawn exactly as the note's page draws it.
 * Scan text reads a page with the phone's own text recognition and puts its
 * words where the cursor is: nothing leaves the phone.
 */
export function NoteEditor(props: {
  label: string;
  value: string;
  onChange: (words: string) => void;
  testID: string;
}) {
  const styles = useStyles(makeStyles);
  const colours = useColours();
  const { t } = useTranslation();
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const [selection, setSelection] = useState<Selection>({ start: props.value.length, end: props.value.length });
  const [scanning, setScanning] = useState(false);
  const [scanSaid, setScanSaid] = useState<string | null>(null);

  const press = (command: NoteCommand) => {
    const edited = applyCommand(props.value, selection, command);
    props.onChange(edited.text);
    setSelection(edited.selection);
  };

  const scan = async () => {
    setScanning(true);
    setScanSaid(null);
    try {
      const read = await scanTextOnPhone();
      if (read.kind === 'cancelled') return;
      if (read.kind === 'nothing' || read.kind === 'failed') {
        setScanSaid(t(read.kind === 'nothing' ? 'notesEditor.scanNothing' : 'notesEditor.scanFailed'));
        return;
      }
      const edited = insertText(props.value, selection, read.text);
      props.onChange(edited.text);
      setSelection(edited.selection);
      setMode('write');
    } finally {
      setScanning(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <ChipRow label={props.label}>
        <Chip
          label={t('notesEditor.write')}
          selected={mode === 'write'}
          onPress={() => setMode('write')}
          testID={`${props.testID}-write`}
        />
        <Chip
          label={t('notesEditor.preview')}
          selected={mode === 'preview'}
          onPress={() => setMode('preview')}
          testID={`${props.testID}-preview`}
        />
      </ChipRow>
      {mode === 'write' ? (
        <>
          {/* One line of buttons, scrolled sideways; a tap never leaves the words being written. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="always"
            contentContainerStyle={styles.tools}
            accessibilityRole="toolbar"
            accessibilityLabel={t('notesEditor.toolbar')}
            testID={`${props.testID}-toolbar`}
          >
            {TOOLS.map((tool) => (
              <Pressable
                key={tool.command}
                testID={`${props.testID}-${tool.command}`}
                accessibilityRole="button"
                accessibilityLabel={t(tool.label)}
                hitSlop={2}
                onPress={() => press(tool.command)}
                style={({ pressed }) => [styles.tool, pressed ? styles.pressed : null]}
              >
                <tool.icon color={colours.ink} size={18} accessibilityElementsHidden importantForAccessibility="no" />
              </Pressable>
            ))}
            {textScanOffered() ? (
              <Pressable
                testID={`${props.testID}-scan`}
                accessibilityRole="button"
                accessibilityLabel={t('notesEditor.scan')}
                accessibilityState={{ busy: scanning, disabled: scanning }}
                disabled={scanning}
                hitSlop={2}
                onPress={() => void scan()}
                style={({ pressed }) => [styles.tool, styles.scan, pressed ? styles.pressed : null]}
              >
                {scanning ? (
                  <ActivityIndicator color={colours.accent} />
                ) : (
                  <ScanText color={colours.accent} size={18} accessibilityElementsHidden importantForAccessibility="no" />
                )}
                <Text variant="small" weight="600" tone="accent">
                  {t('notesEditor.scanShort')}
                </Text>
              </Pressable>
            ) : null}
          </ScrollView>
          <Field
            label={props.label}
            value={props.value}
            onChangeText={props.onChange}
            selection={selection}
            onSelectionChange={(e) => setSelection(e.nativeEvent.selection)}
            multiline
            numberOfLines={10}
            textAlignVertical="top"
            autoCapitalize="sentences"
            testID={props.testID}
          />
        </>
      ) : (
        <View style={styles.preview} testID={`${props.testID}-shown`}>
          {props.value.trim() ? (
            <NoteText source={props.value} />
          ) : (
            <Text tone="soft">{t('notesEditor.empty')}</Text>
          )}
        </View>
      )}
      {scanSaid ? (
        <Notice tone="warn" testID={`${props.testID}-scan-said`}>
          {scanSaid}
        </Notice>
      ) : null}
    </View>
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    wrap: { gap: sp(8) },
    tools: { gap: sp(4), alignItems: 'center' },
    tool: {
      minWidth: 40,
      height: 40,
      borderRadius: radii.m,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colours.border,
      backgroundColor: colours.surface,
    },
    scan: { flexDirection: 'row', gap: sp(6), paddingHorizontal: sp(10) },
    pressed: { opacity: 0.7 },
    preview: {
      minHeight: 160,
      padding: sp(12),
      borderRadius: radii.m,
      borderWidth: 1,
      borderColor: colours.border,
      backgroundColor: colours.surface,
    },
  });
