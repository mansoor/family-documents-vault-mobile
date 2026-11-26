import type { Me } from '@fdv/shared';
import { usePathname } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { BackHandler, Linking, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { APP_RELEASES_URL, APP_VERSION } from '../config';
import { KeptRows } from '../essentials/ui';
import { wordsFor } from '../errors/words';
import { RecoveryCodesShown } from '../settings/recovery';
import { TextCodes } from '../settings/text-codes';
import { TwoStep } from '../settings/two-step';
import { useEssentials } from '../state/essentials';
import { useStepUp } from '../state/step-up';
import { twoStepReason, useVault, type Blocked, type TwoStepNeeded } from '../state/vault';
import { Button, Card, Field, Notice, Text } from '../ui';
import { ConfirmSheet } from '../ui/confirm';
import { FormScroll } from '../ui/keyboard';
import { sp } from '../ui/space';
import { useStyles, type Palette } from '../ui/theme';

/** Where a vault's owner is shown how to update it (the Connect screen's Show how). */
const VAULT_UPGRADE_URL = 'https://github.com/mansoor/family-documents-vault#upgrading';

/**
 * What the app shows over everything else while it can't go on (0.20.0),
 * until it can:
 *
 *  - the app and the vault can't work together until one is updated
 *    (`blocked`): this app too old for the vault — its capability document
 *    said so, or any request or renewal was answered `426
 *    app_update_required` — or the vault too old for the app;
 *  - this session must set up two-step sign-in first (`twoStep`) — and,
 *    where the vault has recovery codes (0.9.0-dev.104), keep the ones made
 *    beside it, shown once, before the app goes on.
 *
 * Drawn over the screens, never instead of them: what was being written —
 * a scan's card, a note, an edit — stays as it was underneath, hidden from
 * touch and from TalkBack, and is there again once the app carries on.
 * Back does nothing here. A kept Essential opened from the update screen is
 * shown above it (they need no vault), and the screen is back after it.
 * Neither signs anybody out or removes anything kept on the phone: Sign out
 * is there, asked first, and does only what it says.
 */
export function Blockers(props: { children: ReactNode }) {
  const styles = useStyles(makeStyles);
  const { blocked, twoStep, phase } = useVault();
  const pathname = usePathname();
  // Recovery codes made as two-step sign-in was set up here (0.9.0-dev.104):
  // shown until they are kept, even once the vault lets the session go on —
  // a renewal meanwhile never takes them off the screen unseen.
  const [codes, setCodes] = useState<string[] | null>(null);
  const showingCodes = codes !== null && phase === 'ready';
  const update = blocked !== null && (phase === 'ready' || phase === 'sign_in');
  const held = !update && (twoStep !== null || showingCodes) && phase === 'ready';
  const reading = update && (pathname.startsWith('/essential/') || pathname.startsWith('/show/'));
  const over = (update && !reading) || held;
  useEffect(() => {
    // Signed out meanwhile: nothing of theirs stays to be shown.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (phase !== 'ready') setCodes(null);
  }, [phase]);
  return (
    <View style={styles.fill}>
      <View
        style={styles.fill}
        importantForAccessibility={over ? 'no-hide-descendants' : 'auto'}
        accessibilityElementsHidden={over}
      >
        {props.children}
      </View>
      {over ? (
        <View style={styles.over}>
          {update && blocked ? (
            <UpdateScreen blocked={blocked} />
          ) : showingCodes ? (
            <CodesScreen codes={codes} onKept={() => setCodes(null)} />
          ) : (
            <TwoStepScreen reason={twoStep ?? 'enrol'} onCodes={setCodes} />
          )}
        </View>
      ) : null}
    </View>
  );
}

function Page(props: { testID: string; children: ReactNode }) {
  const styles = useStyles(makeStyles);
  // Back would move the screens hidden underneath: here it does nothing.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);
  return (
    <SafeAreaView style={styles.safe} testID={props.testID}>
      <FormScroll contentContainerStyle={styles.page}>
        {props.children}
      </FormScroll>
    </SafeAreaView>
  );
}

/** Sign out, asked first; the Essentials kept on the phone go with the session, and the question says so. */
function SignOut(props: { testID: string }) {
  const { t } = useTranslation();
  const { signOut } = useVault();
  const [asking, setAsking] = useState(false);
  return (
    <>
      <Button testID={props.testID} kind="quiet" label={t('settings.signOut')} onPress={() => setAsking(true)} />
      <ConfirmSheet
        visible={asking}
        testID={`${props.testID}-confirm`}
        title={t('settings.signOutTitle')}
        words={t('update.signOutWords')}
        confirmLabel={t('settings.signOut')}
        onConfirm={() => {
          setAsking(false);
          void signOut();
        }}
        onCancel={() => setAsking(false)}
        confirmID={`${props.testID}-yes`}
        cancelID={`${props.testID}-no`}
      />
    </>
  );
}

/** What is kept on this phone, opened as it is offline: an Essential needs no vault (0.20.0). */
function Kept() {
  const { t } = useTranslation();
  const e = useEssentials();
  const [open, setOpen] = useState(false);
  if (e.items.length === 0) return null;
  return open ? (
    <View testID="update-kept">
      <Card>
        <Text variant="screen">{t('essentials.title')}</Text>
        <KeptRows />
      </Card>
    </View>
  ) : (
    <Button testID="update-show-kept" kind="quiet" label={t('update.showKept')} onPress={() => setOpen(true)} />
  );
}

function UpdateScreen(props: { blocked: Blocked }) {
  const { t } = useTranslation();
  const { recheck, phase, chooseAnotherVault } = useVault();
  const [checking, setChecking] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const b = props.blocked;

  const tryAgain = async () => {
    setChecking(true);
    setSaid(null);
    try {
      // Answered, and still too old: this screen stays, and says so. Answered
      // and fine: it goes, and the app carries on where it was.
      const answered = await recheck();
      setSaid(answered ? t('update.notYet') : t('reach.unreachable'));
    } finally {
      setChecking(false);
    }
  };

  return (
    <Page testID="update-screen">
      {b.kind === 'update_app' ? (
        <>
          <Text variant="hero">{t('update.title')}</Text>
          <Text testID="update-words">{t('update.words')}</Text>
          <Text tone="soft" testID="update-needed">
            {b.needed
              ? t('update.needed', { needed: b.needed, client: APP_VERSION })
              : t('update.thisVersion', { client: APP_VERSION })}
          </Text>
          <Button
            testID="update-open"
            label={t('update.button')}
            onPress={() => void Linking.openURL(APP_RELEASES_URL).catch(() => undefined)}
          />
        </>
      ) : (
        <>
          <Text variant="hero">{t('update.vaultTitle')}</Text>
          <Text testID="update-words">{t('update.vaultWords', { server: b.server, needed: b.needed })}</Text>
          <Button
            testID="update-show-how"
            label={t('connect.showHow')}
            onPress={() => void Linking.openURL(VAULT_UPGRADE_URL).catch(() => undefined)}
          />
        </>
      )}
      {phase === 'ready' ? (
        <Text tone="soft" variant="secondary" testID="update-kept-words">
          {t('update.kept')}
        </Text>
      ) : null}
      {said ? (
        <Notice tone="info" testID="update-said">
          {said}
        </Notice>
      ) : null}
      <Button
        testID="update-try-again"
        kind="quiet"
        label={t('common.tryAgain')}
        busy={checking}
        onPress={() => void tryAgain()}
      />
      <Kept />
      {phase === 'ready' ? <SignOut testID="update-sign-out" /> : null}
      {phase === 'sign_in' ? (
        <Button
          testID="update-other-vault"
          kind="quiet"
          label={t('signIn.otherVault')}
          onPress={() => void chooseAnotherVault()}
        />
      ) : null}
    </Page>
  );
}

/**
 * The recovery codes made beside a second step just set up, shown once
 * (0.9.0-dev.104); kept, the vault is asked again and the app goes on.
 */
function CodesScreen(props: { codes: string[]; onKept: () => void }) {
  const { recheckTwoStep } = useVault();
  return (
    <Page testID="two-step-codes">
      <RecoveryCodesShown
        codes={props.codes}
        onDone={() => {
          props.onKept();
          void recheckTwoStep().catch(() => undefined);
        }}
      />
    </Page>
  );
}

function TwoStepScreen(props: { reason: TwoStepNeeded; onCodes: (codes: string[]) => void }) {
  const { t } = useTranslation();
  const { caps, recheckTwoStep, withToken } = useVault();
  const { guarded } = useStepUp();
  const [me, setMe] = useState<Me | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [code, setCode] = useState('');
  // A second step set up here, and its recovery codes asked for (0.9.0-dev.104).
  const [asked, setAsked] = useState(false);
  const [making, setMaking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const { onCodes } = props;

  // Why, and what this person has set up: the screen offers what fits.
  useEffect(() => {
    let gone = false;
    void withToken((a, tk) => a.me(tk))
      .then((m) => {
        if (!gone) setMe(m);
      })
      .catch(() => undefined);
    return () => {
      gone = true;
    };
  }, [withToken]);

  /** GET /me again, whatever was offered: the app carries on once it need not wait. */
  const carryOn = useCallback(async () => {
    setBusy(true);
    setSaid(null);
    try {
      const r = await recheckTwoStep();
      setMe(r.me);
      if (!r.done) setSaid(t('twoStepNeeded.notYet'));
    } catch (err) {
      setSaid(wordsFor(err, t));
    } finally {
      setBusy(false);
    }
  }, [recheckTwoStep, t]);

  /**
   * A second step set up here: its recovery codes made and shown once
   * before the app goes on, as the web does (0.9.0-dev.104). After a
   * recovery the vault waits for them; a vault without them goes straight on.
   */
  const setUp = useCallback(async () => {
    if (caps?.features.recovery_codes !== true) {
      await carryOn();
      return;
    }
    setAsked(true);
    setMaking(true);
    setProblem(null);
    try {
      const made = await guarded((a, tk) => a.makeRecoveryCodes(tk));
      if (made) onCodes(made.codes);
      else setProblem(t('recovery.notMade'));
    } catch (err) {
      setProblem(wordsFor(err, t));
    } finally {
      setMaking(false);
    }
  }, [caps, carryOn, guarded, onCodes, t]);

  const confirm = async () => {
    setBusy(true);
    setSaid(null);
    try {
      await withToken((a, tk) => a.stepUp(tk, { code: code.replace(/\s/g, '') }));
      setCode('');
      const r = await recheckTwoStep();
      setMe(r.me);
      if (!r.done) setSaid(t('twoStepNeeded.notYet'));
    } catch (err) {
      setSaid(wordsFor(err, t));
    } finally {
      setBusy(false);
    }
  };

  // The vault's own word, once /me has said it; until then, what the refusal said.
  const reason = me?.two_step_reason ? twoStepReason(me.two_step_reason) : props.reason;
  // Confirming takes a code from the authenticator app: a passkey alone is the browser's.
  const passkeyOnly = reason === 'confirm' && me !== null && !me.totp_enabled;
  // A second step there and no codes yet — making them failed, "Confirm it's
  // you" was cancelled, or the app started again: made again on request.
  const secondStepThere = me?.totp_enabled === true || me?.has_passkey === true;
  const makeAgain =
    caps?.features.recovery_codes === true &&
    !making &&
    (asked || (reason === 'recovered' && secondStepThere)) ? (
      <Button testID="two-step-needed-make-codes" label={t('recovery.makeMine')} onPress={() => void setUp()} />
    ) : null;
  const makingWords = (
    <>
      {making ? (
        <Text tone="soft" variant="secondary" testID="two-step-needed-making">
          {t('recovery.making')}
        </Text>
      ) : null}
      {problem ? (
        <Notice tone="warn" testID="two-step-needed-codes-problem">
          {problem}
        </Notice>
      ) : null}
      {makeAgain}
    </>
  );

  return (
    <Page testID="two-step-needed">
      <Text variant="hero">
        {reason === 'confirm'
          ? t('twoStepNeeded.confirmTitle')
          : reason === 'recovered'
            ? t('twoStepNeeded.recoveredTitle')
            : t('twoStepNeeded.title')}
      </Text>
      {reason === 'recovered' ? (
        <>
          <Text testID="two-step-needed-words">{t('twoStepNeeded.recovered')}</Text>
          <TwoStep onTurnedOn={() => void setUp()} />
          {/* Codes by text too, unless they are an owner, as the web offers them. */}
          {me && me.role !== 'owner' ? <TextCodes onTurnedOn={() => void setUp()} /> : null}
          {makingWords}
        </>
      ) : reason === 'enrol' ? (
        <>
          <Text testID="two-step-needed-words">{t('twoStepNeeded.enrol')}</Text>
          <TwoStep onTurnedOn={() => void setUp()} />
          {makingWords}
          <Text tone="soft" variant="secondary">
            {t('twoStepNeeded.browser')}
          </Text>
        </>
      ) : passkeyOnly ? (
        <Text testID="two-step-needed-words">{t('twoStepNeeded.passkey')}</Text>
      ) : (
        <Card>
          <Text testID="two-step-needed-words">{t('twoStepNeeded.confirm')}</Text>
          <Field
            testID="two-step-needed-code"
            label={t('twoStep.code')}
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            maxLength={9}
            returnKeyType="go"
            onSubmitEditing={() => void confirm()}
          />
          <Button
            testID="two-step-needed-confirm"
            label={t('signIn.confirm')}
            busy={busy}
            disabled={code.replace(/\s/g, '').length < 6}
            onPress={() => void confirm()}
          />
        </Card>
      )}
      {said ? (
        <Notice tone="warn" testID="two-step-needed-said">
          {said}
        </Notice>
      ) : null}
      <View>
        <Button
          testID="two-step-needed-carry-on"
          kind="quiet"
          label={t('twoStepNeeded.carryOn')}
          busy={busy}
          onPress={() => void carryOn()}
        />
        <SignOut testID="two-step-needed-sign-out" />
      </View>
    </Page>
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    fill: { flex: 1 },
    over: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colours.bg },
    safe: { flex: 1, backgroundColor: colours.bg },
    page: { padding: sp(20), gap: sp(16) },
  });
