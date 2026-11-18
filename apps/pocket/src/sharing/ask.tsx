import { ApiRequestError } from '@fdv/client';
import {
  can,
  maskEmail,
  radii,
  SHARE_CODE_UNAVAILABLE,
  SHARE_MAX_DAYS,
  SHARE_PASSWORD_MAX,
  shareEndWords,
  UPLOAD_PASSWORD_MIN,
  UPLOAD_REQUEST_ITEM_LABEL_MAX,
  UPLOAD_REQUEST_ITEMS_MAX,
  UPLOAD_REQUEST_MAX_FILES,
  UPLOAD_REQUEST_MESSAGE_MAX,
  UPLOAD_REQUEST_TITLE_MAX,
  uploadRequestTypesWords,
  type CreatedUploadRequest,
  type Member,
  type UploadRequestView,
} from '@fdv/shared';
import { useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, ScrollView, Share as SystemShare, StyleSheet, Switch, View } from 'react-native';
import { wordsFor } from '../errors/words';
import { copyForAMinute, nativeClipboard } from '../identity/clipboard';
import { emit } from '../state/events';
import { useFamilyZone } from '../state/family-time';
import { useStepUp } from '../state/step-up';
import { useVault } from '../state/vault';
import { Button, Field, Notice, Text } from '../ui';
import { Chip, ChipRow } from '../ui/chip';
import { feel } from '../ui/feel';
import { sp } from '../ui/space';
import { LoadFailed, loadFailure, Placeholder } from '../ui/states';
import { useColours, useStyles, type Palette } from '../ui/theme';
import {
  ASK_MAX_MB,
  ASK_VISITS_MAX,
  askStart,
  MB,
  readAsk,
  readRequestChange,
  startRequestChange,
  type AskOptions,
  type RequestChangeOptions,
  type RequestSecret,
} from './ask-model';
import { EmailTheLink } from './email-link';
import { sayInSharing } from './requests';

/**
 * Ask for documents (5.22) on the phone (app 0.18.0), as the web's form:
 * somebody outside the family — the accountant, a solicitor — is sent a
 * link to put files in, and sees nothing of the vault. What is asked for
 * and why, whom it is for (and, for whoever reviews, whose they probably
 * are), when it stops, what protects it (a password, an emailed code where
 * the vault can send one, this browser only, so many visits), how much it
 * takes and of what kinds, and who looks at what comes in. Owners and
 * adults only, as the vault has it (`upload_request.create`).
 *
 * Made, the link and a password the vault made up are shown once, with
 * Send, Copy and Email the link where the vault can; the vault keeps a copy
 * to show again in Sharing where it does (LK). What the request will do is
 * said under them.
 */

/** Whether the person may ask, on a vault that takes requests. */
export function useMayAsk(): boolean {
  const { caps, who } = useVault();
  return caps?.features.upload_requests === true && !!who && can(who.role, 'upload_request.create');
}

export function AskForDocuments(props: { person?: string }) {
  const styles = useStyles(makeStyles);
  const { t } = useTranslation();
  const router = useRouter();
  const zone = useFamilyZone();
  const { withToken, caps, offline } = useVault();
  const { guarded } = useStepUp();
  const mayAsk = useMayAsk();
  const [v, setV] = useState<AskOptions>(() => askStart(props.person ? { person: props.person } : {}));
  const set = (change: Partial<AskOptions>) => setV((o) => ({ ...o, ...change }));
  const [data, setData] = useState<{ emailCode: boolean; members: Member[] } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [made, setMade] = useState<CreatedUploadRequest | null>(null);
  // The first thing to put right, moved to and focused on each failed press (as the web).
  const [goTo, setGoTo] = useState<GoTo | null>(null);
  const maxDays = caps?.limits?.share_max_days ?? SHARE_MAX_DAYS;

  const load = useCallback(async () => {
    if (!mayAsk) return;
    try {
      const [requests, members] = await withToken((a, tk) => Promise.all([a.uploadRequests(tk), a.members(tk)]));
      setData({ emailCode: requests.email_code_available, members: members.items });
      setFailed(null);
    } catch (err) {
      setFailed(loadFailure('ask', err, t) ?? t('ask.needsConnection'));
    }
  }, [mayAsk, withToken, t]);
  useEffect(() => {
    // Asked on arrival and when the connection returns; set once the vault answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, offline]);

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/sharing');
  };

  if (!mayAsk) {
    return (
      <View style={[styles.screen, styles.page]} testID="ask">
        <Text tone="soft" testID="ask-not-allowed">
          {t('ask.notAllowed')}
        </Text>
      </View>
    );
  }

  const emailCode = data?.emailCode === true;
  const read = readAsk(v, { timezone: zone, maxDays, emailCode });

  const make = async () => {
    setTried(true);
    if (!read.body) {
      setGoTo({ key: firstWrong(read) });
      return;
    }
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const body = read.body;
      const created = await guarded((a, tk) => a.createUploadRequest(tk, body));
      if (!created) return;
      feel('done');
      setMade(created);
      emit('requestsChanged');
    } catch (err) {
      // About the address a code goes to: said under it, until it is changed.
      if (err instanceof ApiRequestError && (err.code === 'email_code_unavailable' || err.detail?.startsWith('recipient_email'))) {
        set({ emailRefused: err.message || t('ask.codeUnavailableWords') });
      } else {
        setProblem(wordsFor(err, t));
      }
    } finally {
      setBusy(false);
    }
  };

  if (made) return <RequestHandOver created={made} onDone={close} />;

  const person = data?.members.find((m) => m.id === v.person) ?? null;
  const shown = (p: string | null) => (tried ? p : null);
  const at = (key: string) => (goTo?.key === key ? goTo : null);
  const codeWords =
    read.codeProblem && (v.email || tried)
      ? read.codeProblem === 'address'
        ? t('ask.emailProblem')
        : read.codeProblem
      : null;
  return (
    <Form testID="ask">
      <Text variant="secondary" tone="soft">
        {t('ask.lede')}
      </Text>
      {offline ? (
        <Notice tone="warn" testID="ask-offline">
          {t('ask.needsConnection')}
        </Notice>
      ) : null}
      {failed ? <LoadFailed words={failed} onRetry={() => void load()} testID="ask-failed" /> : null}
      {!data && !failed && !offline ? <Placeholder rows={2} /> : null}

      <Section title={t('ask.whatH')}>
        <Field
          label={t('ask.titleField')}
          required={t('capture.required')}
          value={v.title}
          onChangeText={(title) => set({ title })}
          maxLength={UPLOAD_REQUEST_TITLE_MAX}
          autoCapitalize="sentences"
          placeholder={t('ask.titleExample')}
          error={shown(read.titleProblem) ? t('ask.titleProblem') : null}
          goTo={at('title')}
          testID="ask-title"
        />
        {!shown(read.titleProblem) ? <Small>{t('ask.titleNote')}</Small> : null}
        <Field
          label={t('ask.message')}
          value={v.message}
          onChangeText={(message) => set({ message })}
          maxLength={UPLOAD_REQUEST_MESSAGE_MAX}
          autoCapitalize="sentences"
          multiline
          testID="ask-message"
        />
        <Small>{t('ask.messageHint')}</Small>
        <ItemsFields items={v.items} onChange={(items) => set({ items })} />
      </Section>

      <Section title={t('ask.whoH')}>
        <Field
          label={t('ask.label')}
          value={v.label}
          onChangeText={(label) => set({ label })}
          maxLength={80}
          autoCapitalize="words"
          placeholder={t('ask.labelExample')}
          testID="ask-label"
        />
        <Small>{t('ask.labelHint')}</Small>
        <Label>{t('ask.person')}</Label>
        <ChipRow label={t('ask.person')}>
          {[{ id: '', display_name: t('ask.personNone') }, ...(data?.members ?? [])].map((m) => (
            <Chip
              key={m.id || 'none'}
              label={m.display_name}
              selected={v.person === m.id}
              onPress={() => set({ person: m.id })}
              testID={`ask-person-${m.id || 'none'}`}
            />
          ))}
        </ChipRow>
        <Small>{t('ask.personHint')}</Small>
      </Section>

      <Section title={t('ask.safeH')}>
        <Label>{t('ask.ends')}</Label>
        <ChipRow label={t('ask.ends')}>
          {[...read.picks.map((p) => p.key), 'other' as const].map((key) => (
            <Chip
              key={key}
              label={t(`share.end_${key}`)}
              selected={read.end === key}
              onPress={() => set({ end: key })}
              testID={`ask-end-${key}`}
            />
          ))}
        </ChipRow>
        {read.end === 'other' ? (
          <DayTime
            day={v.day}
            time={v.time}
            dayPlaceholder={read.fallback.date}
            onDay={(day) => set({ day })}
            onTime={(time) => set({ time })}
            at={at}
          />
        ) : null}
        <EndWords at={read.endAt} problem={read.endProblem} latest={null} tried={tried} />
        <Small>{t('ask.endNote', { days: maxDays })}</Small>

        <Label>{t('ask.protect')}</Label>
        <SwitchRow
          label={t('ask.withPassword')}
          value={v.withPassword}
          onChange={(withPassword) => set({ withPassword })}
          testID="ask-with-password"
        />
        {v.withPassword ? (
          <PasswordFields
            mode={v.passwordMode}
            password={v.password}
            problem={read.passwordProblem && (v.password || tried) ? passwordWords(read.passwordProblem, t) : null}
            onMode={(passwordMode) => set({ passwordMode })}
            onPassword={(password) => set({ password })}
            goTo={at('password')}
            typedNote={t('ask.passwordTypedNote', { min: UPLOAD_PASSWORD_MIN })}
            madeNote={t('ask.passwordMadeNote')}
          />
        ) : null}
        <SwitchRow
          label={t('ask.withCode')}
          value={emailCode && v.withCode}
          disabled={!emailCode}
          onChange={(withCode) => set({ withCode })}
          testID="ask-with-code"
        />
        {emailCode ? (
          <Small>{t('ask.codeTruth')}</Small>
        ) : (
          <Small testID="ask-code-unavailable">{`${t('ask.codeUnavailable')} ${SHARE_CODE_UNAVAILABLE}`}</Small>
        )}
        {emailCode && v.withCode ? (
          <>
            <Field
              label={t('ask.email')}
              value={v.email}
              onChangeText={(email) => set({ email, emailRefused: null })}
              keyboardType="email-address"
              autoComplete="off"
              maxLength={254}
              error={codeWords}
              goTo={at('email')}
              testID="ask-email"
            />
            {!codeWords ? <Small>{t('ask.emailNote')}</Small> : null}
          </>
        ) : null}
        <SwitchRow
          label={t('ask.deviceOnly')}
          value={v.thisDeviceOnly}
          onChange={(thisDeviceOnly) => set({ thisDeviceOnly })}
          testID="ask-device-only"
        />
        <Small>{t('ask.deviceOnlyNote')}</Small>
        <VisitsFields v={v} set={set} problem={read.visitsProblem} at={at} />
      </Section>

      <Section title={t('ask.takesH')}>
        <TakesFields v={v} set={set} read={read} at={at} />
      </Section>

      <Section title={t('ask.reviewH')}>
        <ChipRow label={t('ask.reviewH')}>
          {(['me', 'adults'] as const).map((r) => (
            <Chip
              key={r}
              label={t(`ask.review_${r}`)}
              selected={v.reviewBy === r}
              onPress={() => set({ reviewBy: r })}
              testID={`ask-review-${r}`}
            />
          ))}
        </ChipRow>
        <Small testID="ask-review-words">
          {person
            ? `${t(`ask.reviewNote_${v.reviewBy}`)} ${t('ask.probably', { name: person.display_name })}`
            : t(`ask.reviewNote_${v.reviewBy}`)}
        </Small>
      </Section>

      {problem ? (
        <Notice tone="warn" testID="ask-problem">
          {problem}
        </Notice>
      ) : null}
      {tried && !read.body ? (
        <Text variant="secondary" tone="danger" role="alert" testID="ask-put-right">
          {t('ask.putRight')}
        </Text>
      ) : null}
      <Button
        label={t('ask.make')}
        busy={busy}
        disabled={data === null || offline}
        onPress={() => void make()}
        testID="ask-make"
      />
      <Button kind="quiet" label={t('common.cancel')} disabled={busy} onPress={close} testID="ask-cancel" />
    </Form>
  );
}

/**
 * A request changed after it is made (0.9.0-dev.49, LK), for whoever asked —
 * or an owner — while it works or is only paused: the form it was made
 * with, filled in as it is now. Its title, message, whom it is for, when it
 * stops, its password (whoever asked only), its visits, what it takes and
 * whether it closes once sent can change; what it asks for, who looks at
 * what comes in, its emailed code and "this browser only" stay as they were
 * made, and are said. Only what is changed is sent, If-Match its version;
 * anything that lets it do more asks to confirm it's you. A new password
 * the vault made up is shown once. A request changed meanwhile, or ended,
 * is read again and the form starts again from it as it is now, saying why,
 * so nothing somebody else changed is undone by a Save here.
 */
export function ChangeRequest(props: { id: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { withToken, offline, who } = useVault();
  const [request, setRequest] = useState<UploadRequestView | null | undefined>(undefined);
  const [failed, setFailed] = useState<string | null>(null);
  // Why the form started again: changed meanwhile, or ended.
  const [again, setAgain] = useState<string | null>(null);
  // The request as last read: a later read with another version is said, never taken in quietly.
  const held = useRef<UploadRequestView | null | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const r = await withToken((a, tk) => a.uploadRequests(tk));
      const next = r.items.find((x) => x.id === props.id) ?? null;
      const was = held.current;
      if (was && next && was.version !== next.version) setAgain((why) => why ?? t('ask.changedMeanwhile'));
      held.current = next;
      setRequest(next);
      setFailed(null);
    } catch (err) {
      setFailed(loadFailure('ask', err, t) ?? t('ask.needsConnection'));
    }
  }, [withToken, props.id, t]);
  // Asked on arrival; and when the connection returns only while it isn't read yet, or failed,
  // so a form being filled in is never started again under the person's fingers.
  const settled = request !== undefined && failed === null;
  useEffect(() => {
    if (settled) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, offline]);

  if (request === undefined) {
    return (
      <Form testID="ask-change">
        {failed ? <LoadFailed words={failed} onRetry={() => void load()} testID="ask-failed" /> : <Placeholder rows={3} />}
      </Form>
    );
  }
  if (!request || request.changeable !== true) {
    return (
      <Form testID="ask-change">
        {again ? (
          <Notice tone="warn" testID="ask-problem">
            {again}
          </Notice>
        ) : null}
        <Text tone="soft" testID="ask-cannot-change">
          {t(who?.role === 'owner' ? 'ask.cannotChangeOwner' : 'ask.cannotChange')}
        </Text>
        <Button label={t('requests.ask')} onPress={() => router.replace('/ask')} testID="ask-instead" />
      </Form>
    );
  }
  return (
    <ChangeRequestForm
      key={`${request.id}:${request.version ?? 0}`}
      request={request}
      said={again}
      onReload={async (why) => {
        setAgain(why);
        await load();
      }}
    />
  );
}

function ChangeRequestForm(props: {
  request: UploadRequestView;
  /** Why it starts again, said until it is saved. */
  said: string | null;
  onReload: (why: string) => Promise<void>;
}) {
  const styles = useStyles(makeStyles);
  const { t } = useTranslation();
  const router = useRouter();
  const zone = useFamilyZone();
  const { offline } = useVault();
  const { guarded } = useStepUp();
  const r = props.request;
  const [v, setV] = useState<RequestChangeOptions>(() => startRequestChange(r, zone));
  const set = (change: Partial<RequestChangeOptions>) => setV((o) => ({ ...o, ...change }));
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(props.said);
  const [newPassword, setNewPassword] = useState<{ password: string; revealable: boolean; title: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [goTo, setGoTo] = useState<GoTo | null>(null);
  const at = (key: string) => (goTo?.key === key ? goTo : null);
  const read = readRequestChange(r, v, { timezone: zone });

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/sharing');
  };

  const save = async () => {
    setTried(true);
    if (read.problem) {
      setGoTo({ key: firstWrong(read) });
      return;
    }
    if (read.nothing || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const body = read.body;
      const done = await guarded((a, tk) => a.changeUploadRequest(tk, r.id, body, r.version));
      if (!done) return;
      feel('done');
      // Said of the request as it is now: its title may be what changed.
      sayInSharing(t('requests.saidChanged', { title: done.request.title }));
      if (done.password) {
        setNewPassword({ password: done.password, revealable: done.request.revealable === true, title: done.request.title });
      } else close();
    } catch (err) {
      const words = wordsFor(err, t);
      setProblem(words);
      // Changed meanwhile (409), or ended (410): read again, and the form starts again from it as it is now.
      if (err instanceof ApiRequestError && (err.code === 'conflict' || err.code === 'request_ended')) {
        emit('requestsChanged');
        await props.onReload(words);
      }
    } finally {
      setBusy(false);
    }
  };

  if (newPassword) {
    const clipboard = nativeClipboard();
    return (
      <Form testID="ask-new-password">
        <Text variant="screen">{t('changeLink.new_password')}</Text>
        <Text variant="secondary" tone="soft">
          {t('ask.newPasswordWords')}
        </Text>
        <View style={styles.box}>
          {/* Not selectable: a copy would sit on the clipboard with nobody to clear it; Copy clears it in a minute. */}
          <Text variant="title" testID="ask-new-password-words">
            {newPassword.password}
          </Text>
        </View>
        {clipboard ? (
          <Button
            kind="quiet"
            label={copied ? t('share.copied') : t('share.copyPassword')}
            onPress={() => {
              if (copyForAMinute(clipboard, newPassword.password)) setCopied(true);
            }}
            testID="ask-new-password-copy"
          />
        ) : null}
        <Small>
          {`${t('changeLink.tellApart_password')} ${newPassword.revealable ? t('changeLink.seeAgain') : t('changeLink.onlyNow')}`}
        </Small>
        <Button label={t('share.done')} onPress={close} testID="ask-new-password-done" />
      </Form>
    );
  }

  const fixed = [
    ...(r.protection.includes('email_code')
      ? [t('ask.codeFixed', { to: r.recipient_email ? maskEmail(r.recipient_email) : t('ask.codeSomewhere') })]
      : []),
    ...(r.protection.includes('this_device') ? [t('ask.deviceFixed')] : []),
  ];
  const secretChoices: [RequestSecret, string][] = [
    ['keep', read.has ? t('ask.keepPassword') : t('ask.noneAsNow')],
    ...(read.has ? [['none', t('ask.noPassword')] as [RequestSecret, string]] : []),
    ['password', read.has ? t('ask.newPassword') : t('ask.aPassword')],
  ];
  const endChoices = ['keep' as const, ...read.picks.map((p) => p.key), 'other' as const];
  const review = r.review_by === 'adults' ? 'adults' : r.mine ? 'mine' : 'theirs';
  return (
    <Form testID="ask-change">
      <Text variant="secondary" tone="soft">
        {t('ask.changeLede')}
      </Text>
      {offline ? (
        <Notice tone="warn" testID="ask-offline">
          {t('ask.needsConnection')}
        </Notice>
      ) : null}

      <Section title={t('ask.whatH')}>
        <Field
          label={t('ask.titleField')}
          required={t('capture.required')}
          value={v.title}
          onChangeText={(title) => set({ title })}
          maxLength={UPLOAD_REQUEST_TITLE_MAX}
          autoCapitalize="sentences"
          error={read.titleProblem ? t('ask.titleProblem') : null}
          goTo={at('title')}
          testID="ask-title"
        />
        <Field
          label={t('ask.message')}
          value={v.message}
          onChangeText={(message) => set({ message })}
          maxLength={UPLOAD_REQUEST_MESSAGE_MAX}
          autoCapitalize="sentences"
          multiline
          testID="ask-message"
        />
        {r.items.length > 0 ? (
          <View testID="ask-items-fixed">
            <Label>{t('ask.items')}</Label>
            {r.items.map((i) => (
              <Text key={i.id} variant="secondary">
                {`• ${i.label}`}
              </Text>
            ))}
          </View>
        ) : null}
        <Small testID="ask-fixed-words">{`${t(`ask.fixedReview_${review}`)} ${t('ask.fixedNote')}`}</Small>
      </Section>

      <Section title={t('ask.whoH')}>
        <Field
          label={t('ask.label')}
          value={v.label}
          onChangeText={(label) => set({ label })}
          maxLength={80}
          autoCapitalize="words"
          placeholder={t('ask.labelExample')}
          testID="ask-label"
        />
        <Small>{t('ask.labelHint')}</Small>
      </Section>

      <Section title={t('ask.safeH')}>
        <Label>{t('ask.ends')}</Label>
        <ChipRow label={t('ask.ends')}>
          {endChoices.map((key) => (
            <Chip
              key={key}
              label={key === 'keep' ? t('changeLink.endAsNow') : t(`share.end_${key}`)}
              selected={v.changeEnd === key}
              onPress={() => set({ changeEnd: key })}
              testID={`ask-end-${key}`}
            />
          ))}
        </ChipRow>
        {v.changeEnd === 'other' ? (
          <DayTime day={v.day} time={v.time} onDay={(day) => set({ day })} onTime={(time) => set({ time })} at={at} />
        ) : null}
        <EndWords at={read.endAt ?? new Date(r.expires_at)} problem={read.endProblem} latest={read.latest} tried={tried} />

        <Label>{t('ask.protect')}</Label>
        {read.maker ? (
          <>
            <ChipRow label={t('ask.protect')}>
              {secretChoices.map(([key, label]) => (
                <Chip
                  key={key}
                  label={label}
                  selected={v.secret === key}
                  onPress={() => set({ secret: key })}
                  testID={`ask-secret-${key}`}
                />
              ))}
            </ChipRow>
            {v.secret === 'password' ? (
              <PasswordFields
                mode={v.passwordMode}
                password={v.password}
                problem={read.passwordProblem && (v.password || tried) ? passwordWords(read.passwordProblem, t) : null}
                onMode={(passwordMode) => set({ passwordMode })}
                onPassword={(password) => set({ password })}
                goTo={at('password')}
                typedNote={t('changeLink.typedNote')}
                madeNote={t('changeLink.madeNote')}
              />
            ) : null}
            {v.secret !== 'keep' && read.has ? <Small testID="ask-old-stops">{t('ask.oldStops')}</Small> : null}
          </>
        ) : (
          <Small testID="ask-not-maker">{read.has ? t('ask.notMaker') : t('ask.notMakerNone')}</Small>
        )}
        {fixed.map((words) => (
          <Small key={words}>{words}</Small>
        ))}
        <VisitsFields v={v} set={set} problem={read.visitsProblem} at={at} />
      </Section>

      <Section title={t('ask.takesH')}>
        <TakesFields v={v} set={set} read={read} at={at} />
      </Section>

      {problem ? (
        <Notice tone="warn" testID="ask-problem">
          {problem}
        </Notice>
      ) : null}
      {read.nothing ? (
        <Small testID="ask-nothing">{t('changeLink.nothing')}</Small>
      ) : read.problem && tried ? (
        <Text variant="secondary" tone="danger" role="alert" testID="ask-put-right">
          {t('ask.putRight')}
        </Text>
      ) : (
        <Small>{t('changeLink.asksMore')}</Small>
      )}
      <Button
        label={t('changeLink.save')}
        busy={busy}
        disabled={read.nothing || offline}
        onPress={() => void save()}
        testID="ask-save"
      />
      <Button kind="quiet" label={t('common.cancel')} disabled={busy} onPress={close} testID="ask-cancel" />
    </Form>
  );
}

/**
 * The link and a password the vault made up, shown here once (5.22): Send
 * gives the phone's own share menu, Copy puts it on the clipboard for a
 * minute, and Email the link has the vault email it where it can — never
 * what it asks for, nor its password. What the request will do is said
 * under them.
 */
export function RequestHandOver(props: { created: CreatedUploadRequest; onDone: () => void }) {
  const styles = useStyles(makeStyles);
  const { t } = useTranslation();
  const zone = useFamilyZone();
  const { vault } = useVault();
  const [copied, setCopied] = useState<'link' | 'secret' | null>(null);
  const { created } = props;
  const r = created.request;
  // The secret after the #: on the vault's public-only site when it has one.
  const link = created.link_url ?? `${vault?.origin ?? ''}/drop#${created.link_token}`;
  const clipboard = nativeClipboard();
  const copy = (what: 'link' | 'secret', text: string) => {
    if (clipboard && copyForAMinute(clipboard, text)) setCopied(what);
  };
  const insecure = /^http:\/\//i.test(link) && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(link);
  const visits =
    r.max_visits == null
      ? null
      : r.max_visits === 1
        ? t('ask.termsOnce')
        : r.max_visits === 2
          ? t('ask.termsTwice')
          : t('ask.termsTimes', { count: r.max_visits });
  const terms = [
    t('ask.termsUntil', { end: shareEndWords(new Date(r.expires_at), zone) }),
    r.items.length > 0 ? t('ask.termsItems', { items: r.items.map((i) => i.label).join(', ') }) : null,
    t('ask.termsSends', {
      files: t('ask.files', { count: r.max_files }),
      mb: Math.floor(r.max_total_bytes / MB),
      types: uploadRequestTypesWords(r.accept_types),
    }),
    visits,
    r.protection.includes('password') && !created.password ? t('ask.termsChosenPassword') : null,
    r.protection.includes('email_code') && r.recipient_email ? t('ask.termsCode', { to: maskEmail(r.recipient_email) }) : null,
    r.protection.includes('this_device') ? t('ask.termsDevice') : null,
    r.close_after_submit ? t('ask.termsCloses') : null,
    t(`ask.termsReview_${r.review_by === 'adults' ? 'adults' : 'me'}`),
  ].filter((x): x is string => !!x);
  return (
    <Form testID="ask-made">
      <Text variant="screen" role="header">
        {r.recipient_label ? t('ask.linkFor', { who: r.recipient_label }) : t('ask.linkToSend')}
      </Text>
      <Text variant="secondary" tone="soft">{`“${r.title}”`}</Text>
      <View style={styles.box}>
        {/* Not selectable, as the emergency page's: Copy clears the clipboard in a minute. */}
        <Text testID="ask-made-link">
          {link}
        </Text>
      </View>
      {insecure ? (
        <Notice tone="warn" testID="ask-made-insecure">
          {t('ask.insecure')}
        </Notice>
      ) : null}
      <Button label={t('share.send')} onPress={() => void SystemShare.share({ message: link })} testID="ask-made-send" />
      {clipboard ? (
        <Button
          kind="quiet"
          label={copied === 'link' ? t('share.copied') : t('share.copyLink')}
          onPress={() => copy('link', link)}
          testID="ask-made-copy-link"
        />
      ) : null}
      {created.password ? (
        <View style={styles.secret} testID="ask-made-password">
          <Label>{t('ask.thePassword')}</Label>
          <Text variant="title" testID="ask-made-password-words">
            {created.password}
          </Text>
          <Small>{t('ask.passwordApart')}</Small>
          {clipboard ? (
            <Button
              kind="quiet"
              label={copied === 'secret' ? t('share.copied') : t('share.copyPassword')}
              onPress={() => copy('secret', created.password as string)}
              testID="ask-made-copy-password"
            />
          ) : null}
        </View>
      ) : null}
      <EmailTheLink request={r} testID="ask-made-email" />
      <View style={styles.terms} testID="ask-made-terms">
        {terms.map((words) => (
          <Text key={words} variant="small" tone="soft">
            {`• ${words}`}
          </Text>
        ))}
      </View>
      <Small>{t('ask.anyone')}</Small>
      {r.revealable === true ? (
        <Notice tone="info" testID="ask-made-again-later">
          {t('ask.againLater')}
        </Notice>
      ) : (
        <Notice tone="warn">{t('ask.onlyNow')}</Notice>
      )}
      <Button kind="quiet" label={t('share.done')} onPress={props.onDone} testID="ask-made-done" />
    </Form>
  );
}

// ---------------------------------------------------------------- pieces

/** Where a failed press moves to: a new one each time, so a second press moves again. */
type GoTo = { key: string };
type At = (key: string) => GoTo | null;

/** The first field with something to put right, in the form's order. */
function firstWrong(read: {
  titleProblem: string | null;
  endProblem: string | null;
  passwordProblem: string | null;
  codeProblem?: string | null;
  visitsProblem: string | null;
  filesProblem: string | null;
  sizeProblem: string | null;
}): string {
  if (read.titleProblem) return 'title';
  if (read.endProblem) return read.endProblem === 'time' ? 'time' : 'day';
  if (read.passwordProblem) return 'password';
  if (read.codeProblem) return 'email';
  if (read.visitsProblem) return 'visits';
  if (read.filesProblem) return 'maxFiles';
  return 'maxMb';
}

/** A typed password's problem in words: too short, or too long. */
function passwordWords(problem: string, t: TFunction): string {
  return problem === 'passwordLong'
    ? t('ask.passwordLong', { max: SHARE_PASSWORD_MAX })
    : t('ask.passwordProblem', { min: UPLOAD_PASSWORD_MIN });
}

function Form(props: { children: ReactNode; testID: string }) {
  const styles = useStyles(makeStyles);
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.screen}>
      <ScrollView testID={props.testID} style={styles.screen} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        {props.children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Section(props: { title: string; children: ReactNode }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.card}>
      <Text variant="title" role="header">
        {props.title}
      </Text>
      {props.children}
    </View>
  );
}

function Label(props: { children: string }) {
  return (
    <Text variant="secondary" weight="600" tone="soft">
      {props.children}
    </Text>
  );
}

function Small(props: { children: string; testID?: string }) {
  return (
    <Text variant="small" tone="soft" {...(props.testID ? { testID: props.testID } : {})}>
      {props.children}
    </Text>
  );
}

function SwitchRow(props: { label: string; value: boolean; disabled?: boolean; onChange: (on: boolean) => void; testID: string }) {
  const styles = useStyles(makeStyles);
  const colours = useColours();
  return (
    <View style={styles.switchRow}>
      <Text style={styles.flex}>{props.label}</Text>
      <Switch
        testID={props.testID}
        accessibilityLabel={props.label}
        value={props.value}
        disabled={props.disabled === true}
        onValueChange={props.onChange}
        trackColor={{ true: colours.accent, false: colours.border }}
      />
    </View>
  );
}

/** The things to send, each its own field, up to the most; one taken away, or another added. */
function ItemsFields(props: { items: string[]; onChange: (items: string[]) => void }) {
  const styles = useStyles(makeStyles);
  const { t } = useTranslation();
  const { items } = props;
  return (
    <View style={styles.section} testID="ask-items">
      <Label>{t('ask.items')}</Label>
      <Small>{t('ask.itemsNote', { max: UPLOAD_REQUEST_ITEMS_MAX })}</Small>
      {items.map((item, i) => (
        <View key={i} style={styles.itemRow}>
          <View style={styles.flex}>
            <Field
              label={t('ask.item', { n: i + 1 })}
              value={item}
              onChangeText={(text) => props.onChange(items.map((x, j) => (j === i ? text : x)))}
              maxLength={UPLOAD_REQUEST_ITEM_LABEL_MAX}
              autoCapitalize="sentences"
              placeholder={i === 0 ? 'W-2' : i === 1 ? '1099' : ''}
              testID={`ask-item-${i}`}
            />
          </View>
          <Button
            size="small"
            kind="quiet"
            label={t('ask.itemRemove')}
            accessibilityLabel={t('ask.itemRemoveFor', { what: item.trim() || t('ask.item', { n: i + 1 }) })}
            onPress={() => props.onChange(items.filter((_, j) => j !== i))}
            testID={`ask-item-remove-${i}`}
          />
        </View>
      ))}
      <Button
        kind="quiet"
        label={items.length === 0 ? t('ask.itemFirst') : t('ask.itemAdd')}
        disabled={items.length >= UPLOAD_REQUEST_ITEMS_MAX}
        onPress={() => props.onChange([...items, ''])}
        testID="ask-item-add"
      />
    </View>
  );
}

function DayTime(props: {
  day: string;
  time: string;
  dayPlaceholder?: string;
  onDay: (d: string) => void;
  onTime: (t: string) => void;
  at: At;
}) {
  const styles = useStyles(makeStyles);
  const { t } = useTranslation();
  return (
    <View style={styles.row}>
      <View style={styles.flex}>
        <Field
          label={t('share.day')}
          value={props.day}
          onChangeText={props.onDay}
          {...(props.dayPlaceholder ? { placeholder: props.dayPlaceholder } : {})}
          goTo={props.at('day')}
          testID="ask-day"
        />
      </View>
      <View style={styles.time}>
        <Field
          label={t('share.time')}
          value={props.time}
          onChangeText={props.onTime}
          placeholder="17:00"
          goTo={props.at('time')}
          testID="ask-time"
        />
      </View>
    </View>
  );
}

/** When it stops, in words; or why it cannot — announced once a save or a make has been tried. */
function EndWords(props: { at: Date | null; problem: string | null; latest: Date | null; tried: boolean }) {
  const { t } = useTranslation();
  const zone = useFamilyZone();
  const p = props.problem;
  if (p) {
    const words =
      p === 'day'
        ? t('share.badDay')
        : p === 'time'
          ? t('share.badTime')
          : p === 'latest' && props.latest
            ? t('ask.latest', { end: shareEndWords(props.latest, zone) })
            : p;
    return (
      <Text variant="secondary" tone="danger" {...(props.tried ? { role: 'alert' as const } : {})} testID="ask-end-problem">
        {words}
      </Text>
    );
  }
  return props.at ? <Small testID="ask-end-words">{t('ask.endsAt', { end: shareEndWords(props.at, zone) })}</Small> : null;
}

function PasswordFields(props: {
  mode: 'made' | 'typed';
  password: string;
  problem: string | null;
  onMode: (m: 'made' | 'typed') => void;
  onPassword: (p: string) => void;
  typedNote: string;
  madeNote: string;
  goTo: GoTo | null;
}) {
  const { t } = useTranslation();
  return (
    <>
      <ChipRow label={t('changeLink.passwordHow')}>
        {(['made', 'typed'] as const).map((m) => (
          <Chip
            key={m}
            label={t(`changeLink.password_${m}`)}
            selected={props.mode === m}
            onPress={() => props.onMode(m)}
            testID={`ask-password-${m}`}
          />
        ))}
      </ChipRow>
      {props.mode === 'typed' ? (
        <Field
          label={t('ask.thePassword')}
          value={props.password}
          onChangeText={props.onPassword}
          autoCapitalize="none"
          autoComplete="off"
          maxLength={SHARE_PASSWORD_MAX}
          error={props.problem}
          goTo={props.goTo}
          testID="ask-password"
        />
      ) : null}
      <Small>{props.mode === 'typed' ? props.typedNote : props.madeNote}</Small>
    </>
  );
}

/** Only so many visits: the switch, and how many. A request's form and its Change's. */
function VisitsFields<V extends AskOptions>(props: { v: V; set: (c: Partial<V>) => void; problem: string | null; at: At }) {
  const { t } = useTranslation();
  const { v, set } = props;
  return (
    <>
      <SwitchRow
        label={t('ask.limitVisits')}
        value={v.limitVisits}
        onChange={(limitVisits) => set({ limitVisits } as Partial<V>)}
        testID="ask-limit-visits"
      />
      <Small>{t('ask.limitVisitsNote')}</Small>
      {v.limitVisits ? (
        <Field
          label={t('ask.visits')}
          value={v.visits}
          onChangeText={(visits) => set({ visits } as Partial<V>)}
          keyboardType="number-pad"
          maxLength={4}
          error={props.problem ? t('ask.visitsProblem', { max: ASK_VISITS_MAX }) : null}
          goTo={props.at('visits')}
          testID="ask-visits"
        />
      ) : null}
    </>
  );
}

/** What it takes: how many files, how much, what kinds, and closing once sent. */
function TakesFields<V extends AskOptions>(props: {
  v: V;
  set: (c: Partial<V>) => void;
  read: { filesProblem: string | null; sizeProblem: string | null };
  at: At;
}) {
  const styles = useStyles(makeStyles);
  const { t } = useTranslation();
  const { v, set, read } = props;
  return (
    <>
      <View style={styles.row}>
        <View style={styles.flex}>
          <Field
            label={t('ask.maxFiles')}
            value={v.maxFiles}
            onChangeText={(maxFiles) => set({ maxFiles } as Partial<V>)}
            keyboardType="number-pad"
            maxLength={2}
            error={read.filesProblem ? t('ask.filesProblem', { max: UPLOAD_REQUEST_MAX_FILES }) : null}
            goTo={props.at('maxFiles')}
            testID="ask-max-files"
          />
          {!read.filesProblem ? <Small>{t('ask.maxFilesNote', { max: UPLOAD_REQUEST_MAX_FILES })}</Small> : null}
        </View>
        <View style={styles.flex}>
          <Field
            label={t('ask.maxMb')}
            value={v.maxMegabytes}
            onChangeText={(maxMegabytes) => set({ maxMegabytes } as Partial<V>)}
            keyboardType="number-pad"
            maxLength={3}
            error={read.sizeProblem ? t('ask.sizeProblem', { max: ASK_MAX_MB }) : null}
            goTo={props.at('maxMb')}
            testID="ask-max-mb"
          />
          {!read.sizeProblem ? <Small>{t('ask.maxMbNote', { max: ASK_MAX_MB })}</Small> : null}
        </View>
      </View>
      <Label>{t('ask.kinds')}</Label>
      <ChipRow label={t('ask.kinds')}>
        {(['standard', 'office'] as const).map((a) => (
          <Chip
            key={a}
            label={t(`ask.accept_${a}`)}
            selected={v.accept === a}
            onPress={() => set({ accept: a } as Partial<V>)}
            testID={`ask-accept-${a}`}
          />
        ))}
      </ChipRow>
      <Small>{t(`ask.acceptNote_${v.accept}`)}</Small>
      <SwitchRow
        label={t('ask.closeAfter')}
        value={v.closeAfter}
        onChange={(closeAfter) => set({ closeAfter } as Partial<V>)}
        testID="ask-close-after"
      />
      <Small>{t('ask.closeAfterNote')}</Small>
    </>
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colours.bg },
    page: { padding: sp(20), gap: sp(12) },
    card: {
      gap: sp(8),
      padding: sp(14),
      borderRadius: radii.l,
      borderWidth: 1,
      borderColor: colours.border,
      backgroundColor: colours.surface,
    },
    section: { gap: sp(8) },
    row: { flexDirection: 'row', gap: sp(8) },
    itemRow: { flexDirection: 'row', alignItems: 'flex-end', gap: sp(8) },
    flex: { flex: 1 },
    time: { width: 104 },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: sp(12), minHeight: 48 },
    box: {
      padding: sp(12),
      borderRadius: radii.m,
      borderWidth: 1,
      borderColor: colours.border,
      backgroundColor: colours.surface,
    },
    secret: { gap: sp(4) },
    terms: { gap: 2 },
  });
