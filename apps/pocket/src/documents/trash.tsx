import { sensitiveBackupsWords } from '@fdv/shared';
import { Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { wordsFor } from '../errors/words';
import { emit } from '../state/events';
import { useStepUp } from '../state/step-up';
import { useVault } from '../state/vault';
import { Text } from '../ui';
import { ConfirmBody } from '../ui/confirm';

/**
 * Move to the Trash (P8; the owner's decision of 7 Nov 2026), with the
 * web's "are you sure?": the document goes to the vault's Trash, where it
 * can be brought back in the browser. Nothing is removed for good from the
 * phone. Gone, the page it was on is left (`onGone`), and every list that
 * showed it looks again. Since R6 it is asked in the sheet a document's ⋯
 * opens, in place of the choices it offered.
 *
 * A sensitive one (the vault's 0.9.0-dev.51, H5; app 0.17.0) says, as the
 * web does, that older backups still hold it until they age out, and for
 * how long the vault keeps its nightly ones, where it has said.
 */
export function TrashConfirm(props: {
  id: string;
  title: string;
  sensitive?: boolean;
  onGone: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const { caps } = useVault();
  const backups =
    props.sensitive === true && caps?.features.share_opens === true
      ? sensitiveBackupsWords(caps.limits?.backup_retain_days ?? null, { forGood: false })
      : null;
  const { guarded } = useStepUp();
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
      emit('documentChanged', props.id);
      props.onGone();
    } catch (err) {
      setProblem(wordsFor(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmBody
      icon={Trash2}
      title={t('trash.title')}
      words={t('trash.words', { title: props.title })}
      confirmLabel={t('trash.yes')}
      busy={busy}
      problem={problem}
      onConfirm={() => void trash()}
      onCancel={props.onCancel}
      confirmID="trash-yes"
      cancelID="trash-cancel"
      problemID="trash-problem"
    >
      {backups ? (
        <Text variant="secondary" tone="soft" testID="trash-backups">
          {backups}
        </Text>
      ) : null}
    </ConfirmBody>
  );
}
