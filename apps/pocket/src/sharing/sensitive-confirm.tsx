import { ApiRequestError } from '@fdv/client';
import { sensitiveStillSharedWords } from '@fdv/shared';
import { Link2Off, ShieldAlert } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { wordsFor } from '../errors/words';
import { Button, Text } from '../ui';
import { ConfirmBody, ConfirmSheet, type Confirmation } from '../ui/confirm';
import { Sheet } from '../ui/sheet';
import { sp } from '../ui/space';
import { useStyles } from '../ui/theme';

/** How a sensitive question is asked: its title, its button, and the testIDs' stem. */
export interface SensitiveAsk {
  title: string;
  confirmLabel: string;
  /** `<id>` on its sheet, `<id>-yes` and `<id>-cancel` on its buttons. */
  id: string;
}

/**
 * Asked before a sensitive document goes outside the family (0.9.0-dev.41,
 * H1a), as the web's useSensitiveConfirm asks it: a link to it, a
 * collection's link with it ticked, a collection whose link keeps up with
 * it, and a paused link turned back on that gives it. `ask(run)` runs
 * `run(false)`; answered `409 sensitive_confirm`, it asks the vault's own
 * question, and on Yes runs `run(true)` — which sends `confirm_sensitive:
 * true`. Cancel is an answer: nothing is sent, and `ask` gives null. With
 * `first`, the question is asked in those words before anything is sent,
 * for a document the phone already knows is sensitive.
 *
 * `body` is the question for a sheet already open (drawn in its place);
 * `sheet`, the same in a sheet of its own. An older vault never answers
 * `sensitive_confirm`, so nothing is ever asked there.
 */
export function useSensitiveConfirm(words: SensitiveAsk): {
  ask: <T>(run: (confirmed: boolean) => Promise<T>, first?: string | null) => Promise<T | null>;
  asking: boolean;
  /** Cancel, as Back does it while the question is open. */
  cancel: () => void;
  body: ReactElement | null;
  sheet: ReactElement;
} {
  const [asking, setAsking] = useState<string | null>(null);
  const answer = useRef<((yes: boolean) => void) | null>(null);
  // Gone while asking (the sheet closed): nothing is sent.
  useEffect(
    () => () => {
      answer.current?.(false);
      answer.current = null;
    },
    [],
  );
  const question = useCallback(
    (message: string) =>
      new Promise<boolean>((resolve) => {
        answer.current = resolve;
        setAsking(message);
      }),
    [],
  );
  const done = useCallback((yes: boolean) => {
    const resolve = answer.current;
    answer.current = null;
    setAsking(null);
    resolve?.(yes);
  }, []);
  const ask = useCallback(
    async <T,>(run: (confirmed: boolean) => Promise<T>, first?: string | null): Promise<T | null> => {
      if (first) {
        if (!(await question(first))) return null;
        return run(true);
      }
      try {
        return await run(false);
      } catch (err) {
        if (!(err instanceof ApiRequestError) || err.code !== 'sensitive_confirm') throw err;
        if (!(await question(err.message))) return null;
        return run(true);
      }
    },
    [question],
  );
  const confirmation: Confirmation = {
    title: words.title,
    words: asking ?? '',
    icon: ShieldAlert,
    confirmLabel: words.confirmLabel,
    onConfirm: () => done(true),
    onCancel: () => done(false),
    confirmID: `${words.id}-yes`,
    cancelID: `${words.id}-cancel`,
  };
  return {
    ask,
    asking: asking !== null,
    cancel: () => done(false),
    body: asking !== null ? <ConfirmBody {...confirmation} /> : null,
    sheet: <ConfirmSheet visible={asking !== null} testID={words.id} {...confirmation} />,
  };
}

/**
 * A paper made sensitive while links outside the family still give it
 * (0.9.0-dev.41, H1a), asked once the edit is saved — never in its way:
 * Keep leaves them; End ends them (`onEnd`, which answers what it did, in
 * words) and says so before the screen moves on. `onDone` either way.
 */
export function StillSharedSheet(props: {
  links: number;
  onEnd: () => Promise<string>;
  onDone: () => void;
  testID: string;
}) {
  const styles = useStyles(makeStyles);
  const { t } = useTranslation();
  const [phase, setPhase] = useState<'ask' | 'ending' | { said: string }>('ask');
  const [problem, setProblem] = useState<string | null>(null);
  const one = props.links === 1;
  if (typeof phase === 'object') {
    return (
      <Sheet visible onClose={props.onDone} testID={`${props.testID}-said`}>
        <View style={styles.body} accessibilityRole="alert">
          <Text variant="screen">{t('sensitive.endedTitle')}</Text>
          <Text variant="secondary" testID={`${props.testID}-words`}>
            {phase.said}
          </Text>
          <Button label={t('share.done')} onPress={props.onDone} testID={`${props.testID}-done`} />
        </View>
      </Sheet>
    );
  }
  const end = () => {
    setPhase('ending');
    setProblem(null);
    props.onEnd().then(
      (said) => setPhase({ said }),
      (err: unknown) => {
        setProblem(wordsFor(err, t));
        setPhase('ask');
      },
    );
  };
  return (
    <ConfirmSheet
      visible
      testID={props.testID}
      icon={Link2Off}
      title={t('sensitive.stillTitle')}
      words={sensitiveStillSharedWords(props.links)}
      confirmLabel={t(one ? 'sensitive.endOne' : 'sensitive.endMany')}
      cancelLabel={t(one ? 'sensitive.keepOne' : 'sensitive.keepMany')}
      busy={phase === 'ending'}
      problem={problem}
      onConfirm={end}
      onCancel={props.onDone}
      confirmID={`${props.testID}-end`}
      cancelID={`${props.testID}-keep`}
      problemID={`${props.testID}-problem`}
    />
  );
}

const makeStyles = () =>
  StyleSheet.create({
    body: { gap: sp(12) },
  });
