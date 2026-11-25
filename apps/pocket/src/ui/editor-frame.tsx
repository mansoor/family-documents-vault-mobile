import { useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ConfirmSheet } from './confirm';
import { Button } from './index';
import { AboveKeyboard, FormScroll } from './keyboard';
import { sp } from './space';
import { useStyles, type Palette } from './theme';

/**
 * A screen that edits something, full height (New note, Edit note, Edit
 * details): what is being written scrolls, and Cancel and Save stay in one
 * row at the foot, above the phone's own Back and Home and above the
 * keyboard (the owner, 12 Nov 2026: Cancel went behind Android's buttons).
 * Cancel, or Back, with something changed asks first: what was typed is
 * lost. Save answers with where to go once it has saved, or nothing to
 * stay: then nothing asks.
 *
 * With the keyboard up (0.26.0), Cancel and Save ride on it, and the field
 * being typed in is scrolled to just above them — on Android too, where
 * the screen no longer shrinks for the keyboard.
 */
export function EditorFrame(props: {
  testID: string;
  children: ReactNode;
  /** Something here differs from what was opened. */
  changed: boolean;
  busy: boolean;
  save: { testID: string; label: string; disabled?: boolean; onPress: () => Promise<(() => void) | null> };
  cancelID: string;
}) {
  const styles = useStyles(makeStyles);
  const { t } = useTranslation();
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [asking, setAsking] = useState(false);
  // How tall Cancel and Save are, so a field is kept above them, not only above the keyboard.
  const [barHeight, setBarHeight] = useState(0);
  const blocked = useRef<unknown>(null);
  const leaving = useRef(false);
  const changed = useRef(props.changed);
  const busy = useRef(props.busy);
  useEffect(() => {
    changed.current = props.changed;
    busy.current = props.busy;
  }, [props.changed, props.busy]);

  // Back with something changed: ask. While a Save is under way, Back waits.
  useEffect(
    () =>
      navigation.addListener('beforeRemove', (e: { preventDefault: () => void; data: { action: unknown } }) => {
        if (leaving.current || !changed.current) return;
        e.preventDefault();
        if (busy.current) return;
        blocked.current = e.data.action;
        setAsking(true);
      }),
    [navigation],
  );

  const cancel = () => {
    if (props.changed) {
      blocked.current = null;
      setAsking(true);
      return;
    }
    leaving.current = true;
    router.back();
  };

  const leave = useCallback(() => {
    leaving.current = true;
    setAsking(false);
    if (blocked.current) navigation.dispatch(blocked.current as never);
    else router.back();
  }, [navigation, router]);

  const save = async () => {
    const go = await props.save.onPress();
    if (!go) return;
    leaving.current = true;
    go();
  };

  return (
    <View style={styles.screen}>
      <FormScroll
        testID={props.testID}
        style={styles.screen}
        contentContainerStyle={[styles.page, { paddingTop: sp(20) + insets.top }]}
        // What the keyboard covers of the bar is the phone's own buttons' room.
        gap={Math.max(0, barHeight - insets.bottom)}
      >
        {props.children}
      </FormScroll>
      <AboveKeyboard under={insets.bottom}>
        <View
          style={[styles.bar, { paddingBottom: sp(12) + insets.bottom }]}
          testID={`${props.testID}-bar`}
          onLayout={(e) => setBarHeight(e.nativeEvent.layout.height)}
        >
          <View style={styles.flex}>
            <Button testID={props.cancelID} kind="quiet" label={t('common.cancel')} disabled={props.busy} onPress={cancel} />
          </View>
          <View style={styles.flex}>
            <Button
              testID={props.save.testID}
              label={props.save.label}
              busy={props.busy}
              disabled={props.save.disabled === true}
              onPress={() => void save()}
            />
          </View>
        </View>
      </AboveKeyboard>
      <ConfirmSheet
        visible={asking}
        testID={`${props.cancelID}-ask`}
        title={t('editor.leaveTitle')}
        words={t('editor.leaveWords')}
        confirmLabel={t('editor.leave')}
        cancelLabel={t('editor.keep')}
        onConfirm={leave}
        onCancel={() => {
          blocked.current = null;
          setAsking(false);
        }}
        confirmID={`${props.cancelID}-yes`}
        cancelID={`${props.cancelID}-no`}
      />
    </View>
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colours.bg },
    page: { padding: sp(20), paddingBottom: sp(24), gap: sp(16), backgroundColor: colours.bg },
    bar: {
      flexDirection: 'row',
      gap: sp(12),
      paddingHorizontal: sp(20),
      paddingTop: sp(12),
      borderTopWidth: 1,
      borderTopColor: colours.border,
      backgroundColor: colours.bg,
    },
    flex: { flex: 1 },
  });
