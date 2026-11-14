import { isShareAddress, SHARE_LINK_EMAIL_MESSAGE_MAX, shareLinkMessage, type Share } from '@fdv/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { wordsFor } from '../errors/words';
import { emit } from '../state/events';
import { useStepUp } from '../state/step-up';
import { useVault } from '../state/vault';
import { Button, Field, Notice, Text } from '../ui';
import { feel } from '../ui/feel';
import { sp } from '../ui/space';
import { useStyles } from '../ui/theme';

/** Whether "Email the link" can work for this link: the vault sends it, and the person made it. */
export function canEmailLink(share: Share, emailing: boolean | undefined): boolean {
  // `emailable` is the vault's word that the caller made it and a copy is kept: false for anybody else's.
  return emailing === true && share.emailable === true;
}

/**
 * Email the link (0.9.0, a vault of 0.9.0-dev.39; the owner's decision of
 * 13 Nov 2026): the vault emails the link to an address its maker types,
 * through the mail server of whoever runs it — with a short message of
 * their own, if they like. Beside Send and Copy, never in their place: it
 * is absent where it cannot work (no mail server, `features.share_link_email`;
 * a link the person did not make, or made before the vault kept copies,
 * `Share.emailable`), and Copy stays whatever happens here.
 *
 * The address and the message are checked here by the vault's own rules
 * (`isShareAddress`, `shareLinkMessage`), so what is wrong is said before
 * anything is sent; the vault checks again. Past the first 15 minutes it
 * asks to confirm it is them (`email_share`), as Show the link does. Sent,
 * it says where, masked, and how many more times today.
 */
export function EmailTheLink(props: { share: Share; testID: string }) {
  const styles = useStyles(makeStyles);
  const { t } = useTranslation();
  const { caps } = useVault();
  const { guarded } = useStepUp();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState('');
  const [message, setMessage] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState<{ to: string; left: number } | null>(null);
  if (!canEmailLink(props.share, caps?.features.share_link_email)) return null;

  const id = props.testID;
  const address = to.trim();
  const addressProblem = tried && !isShareAddress(address) ? t('share.emailBadAddress') : null;
  const words = shareLinkMessage(message);
  const messageProblem = 'problem' in words ? words.problem : null;

  const send = async () => {
    setTried(true);
    setProblem(null);
    if (!isShareAddress(address) || 'problem' in words || busy) return;
    setBusy(true);
    try {
      // Confirming it is them first when the vault asks (email_share).
      const done = await guarded((a, tk) =>
        a.emailShare(tk, props.share.id, { to: address, ...(words.message ? { message: words.message } : {}) }),
      );
      if (!done) return;
      feel('done');
      setSent({ to: done.sent_to, left: done.sends_left });
      setOpen(false);
      setTo('');
      setMessage('');
      setTried(false);
      emit('sharesChanged');
    } catch (err) {
      setProblem(wordsFor(err, t));
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    setOpen(false);
    setTo('');
    setMessage('');
    setTried(false);
    setProblem(null);
  };

  const lastTo = sent?.to ?? props.share.emailed_to ?? null;
  return (
    <View style={styles.box} testID={id}>
      {sent ? (
        <Notice tone="ok" testID={`${id}-sent`}>
          {sent.left > 0
            ? t('share.emailSent', { to: sent.to, count: sent.left })
            : t('share.emailSentNoMore', { to: sent.to })}
        </Notice>
      ) : lastTo ? (
        <Text variant="small" tone="soft" testID={`${id}-before`}>
          {t('share.emailedBefore', { to: lastTo })}
        </Text>
      ) : null}
      {!open && (!sent || sent.left > 0) ? (
        <Button
          kind="quiet"
          label={t('share.emailLink')}
          onPress={() => {
            setSent(null);
            setOpen(true);
          }}
          testID={`${id}-open`}
        />
      ) : null}
      {open ? (
        <View style={styles.form}>
          <Text variant="secondary" weight="600">
            {t('share.emailLink')}
          </Text>
          <Field
            label={t('share.emailTo')}
            value={to}
            onChangeText={setTo}
            keyboardType="email-address"
            autoComplete="off"
            textContentType="none"
            importantForAutofill="no"
            maxLength={254}
            placeholder="name@example.com"
            error={addressProblem}
            testID={`${id}-to`}
          />
          <Field
            label={t('share.emailMessage')}
            value={message}
            onChangeText={setMessage}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            autoCapitalize="sentences"
            autoCorrect
            error={messageProblem}
            testID={`${id}-message`}
          />
          <Text variant="small" tone="soft">
            {t('share.emailMessageRules', { max: SHARE_LINK_EMAIL_MESSAGE_MAX })}
          </Text>
          <Text variant="small" tone="soft">
            {t('share.emailNote')}
          </Text>
          {problem ? (
            <Notice tone="warn" testID={`${id}-problem`}>
              {problem}
            </Notice>
          ) : null}
          <View style={styles.row}>
            <View style={styles.flex}>
              <Button
                kind="quiet"
                label={t('common.cancel')}
                disabled={busy}
                onPress={cancel}
                testID={`${id}-cancel`}
              />
            </View>
            <View style={styles.flex}>
              <Button
                label={t('share.emailSend')}
                busy={busy}
                disabled={!!messageProblem}
                onPress={() => void send()}
                testID={`${id}-send`}
              />
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = () =>
  StyleSheet.create({
    box: { gap: sp(8) },
    form: { gap: sp(10) },
    row: { flexDirection: 'row', gap: sp(8) },
    flex: { flex: 1 },
  });
