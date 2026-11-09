import { Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { wordsFor } from '../errors/words';
import { emit } from '../state/events';
import { useStepUp } from '../state/step-up';
import { Button, Notice, Text } from '../ui';
import { Sheet } from '../ui/sheet';
import { sp } from '../ui/space';
import { useColours } from '../ui/theme';

/**
 * Move to the Trash (P8; the owner's decision of 7 Nov 2026), with the
 * web's "are you sure?": the document goes to the vault's Trash, where it
 * can be brought back in the browser. Nothing is removed for good from the
 * phone. Gone, the page it was on is left (`onGone`), and every list that
 * showed it looks again.
 */
export function TrashButton(props: { id: string; title: string; onGone: () => void }) {
  const { t } = useTranslation();
  const colours = useColours();
  const { guarded } = useStepUp();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const trash = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const done = await guarded(async (a, tk) => {
        await a.deleteDocument(tk, props.id);
        return true;
      });
      if (!done) return;
      setAsking(false);
      emit('documentChanged', props.id);
      props.onGone();
    } catch (err) {
      setProblem(wordsFor(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <Button
        testID="document-trash"
        kind="quiet"
        label={t('trash.button')}
        onPress={() => {
          setProblem(null);
          setAsking(true);
        }}
      />
      <Sheet visible={asking} onClose={() => setAsking(false)} testID="trash-question">
        <View style={styles.head}>
          <Trash2 color={colours.danger} size={24} accessibilityElementsHidden importantForAccessibility="no" />
          <Text variant="screen">{t('trash.title')}</Text>
        </View>
        <Text>{t('trash.words', { title: props.title })}</Text>
        {problem ? (
          <Notice tone="warn" testID="trash-problem">
            {problem}
          </Notice>
        ) : null}
        <Button testID="trash-yes" kind="danger" label={t('trash.yes')} busy={busy} onPress={() => void trash()} />
        <Button testID="trash-cancel" kind="quiet" label={t('common.cancel')} disabled={busy} onPress={() => setAsking(false)} />
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: sp(10) },
});
