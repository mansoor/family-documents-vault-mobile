import { Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { wordsFor } from '../errors/words';
import { emit } from '../state/events';
import { useStepUp } from '../state/step-up';
import { Button } from '../ui';
import { ConfirmSheet } from '../ui/confirm';

/**
 * Move to the Trash (P8; the owner's decision of 7 Nov 2026), with the
 * web's "are you sure?": the document goes to the vault's Trash, where it
 * can be brought back in the browser. Nothing is removed for good from the
 * phone. Gone, the page it was on is left (`onGone`), and every list that
 * showed it looks again.
 */
export function TrashButton(props: { id: string; title: string; onGone: () => void }) {
  const { t } = useTranslation();
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
      <ConfirmSheet
        visible={asking}
        testID="trash-question"
        icon={Trash2}
        title={t('trash.title')}
        words={t('trash.words', { title: props.title })}
        confirmLabel={t('trash.yes')}
        busy={busy}
        problem={problem}
        onConfirm={() => void trash()}
        onCancel={() => setAsking(false)}
        confirmID="trash-yes"
        cancelID="trash-cancel"
        problemID="trash-problem"
      />
    </View>
  );
}

