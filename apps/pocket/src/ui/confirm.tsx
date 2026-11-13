import { radii } from '@fdv/shared';
import { AlertTriangle, type LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Button, Notice, Text } from './index';
import { Sheet } from './sheet';
import { sp } from './space';
import { useColours, useStyles, type Palette } from './theme';

/** What a confirmation says and does. */
export interface Confirmation {
  title: string;
  /** What happens, and what stays: "The document stays in the vault." */
  words: string;
  /** Who else it touches, said apart: a collection shared outside the family. */
  warning?: string | null;
  /** The red button, named for what it does — never "OK". */
  confirmLabel: string;
  /** The quiet button, when Cancel would be unclear ("Keep editing"). */
  cancelLabel?: string;
  icon?: LucideIcon;
  busy?: boolean;
  /** What went wrong, if it did: said here, the question still open. */
  problem?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  /** testIDs: the action, Cancel and the problem. */
  confirmID: string;
  cancelID: string;
  problemID?: string;
  children?: ReactNode;
}

/**
 * The question asked before anything is lost (R2; the owner, 10 Nov 2026:
 * every destructive action confirms first): what is about to happen, to
 * what, what stays and who else it touches, then the action in red and
 * Cancel. The body alone, for a sheet already open (a row's ⋯).
 */
export function ConfirmBody(props: Confirmation) {
  const styles = useStyles(makeStyles);
  const colours = useColours();
  const { t } = useTranslation();
  const Icon = props.icon ?? AlertTriangle;
  return (
    <View style={styles.body} accessibilityRole="alert">
      <View style={styles.head}>
        <View style={styles.icon}>
          <Icon color={colours.danger} size={20} accessibilityElementsHidden importantForAccessibility="no" />
        </View>
        <View style={styles.words}>
          <Text variant="screen">{props.title}</Text>
          <Text variant="secondary">{props.words}</Text>
        </View>
      </View>
      {props.warning ? <Notice tone="warn">{props.warning}</Notice> : null}
      {props.children}
      {props.problem ? (
        <Notice tone="warn" {...(props.problemID ? { testID: props.problemID } : {})}>
          {props.problem}
        </Notice>
      ) : null}
      <Button
        testID={props.confirmID}
        kind="danger"
        label={props.confirmLabel}
        busy={props.busy === true}
        onPress={props.onConfirm}
      />
      <Button
        testID={props.cancelID}
        kind="quiet"
        label={props.cancelLabel ?? t('common.cancel')}
        disabled={props.busy === true}
        onPress={props.onCancel}
      />
    </View>
  );
}

/** The same question in a sheet of its own. A tap outside does not answer it; Back cancels. */
export function ConfirmSheet(props: Confirmation & { visible: boolean; testID: string }) {
  return (
    <Sheet visible={props.visible} onClose={() => (props.busy ? undefined : props.onCancel())} testID={props.testID}>
      <ConfirmBody {...props} />
    </Sheet>
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    body: { gap: sp(12) },
    head: { flexDirection: 'row', alignItems: 'flex-start', gap: sp(12) },
    icon: {
      width: 40,
      height: 40,
      borderRadius: radii.pill,
      backgroundColor: colours.surface,
      borderWidth: 1,
      borderColor: colours.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    words: { flex: 1, gap: sp(4) },
  });
