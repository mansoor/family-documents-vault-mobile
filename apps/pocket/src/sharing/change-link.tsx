import { ApiRequestError } from '@fdv/client';
import { radii, shareEndWords, SHOW_TITLE_LABEL, type ChangedShare, type Share } from '@fdv/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';
import { wordsFor } from '../errors/words';
import { copyForAMinute, nativeClipboard } from '../identity/clipboard';
import { emit } from '../state/events';
import { useFamilyZone } from '../state/family-time';
import { useStepUp } from '../state/step-up';
import { useVault } from '../state/vault';
import { Button, Field, Notice, Text } from '../ui';
import { Chip, ChipRow } from '../ui/chip';
import { feel } from '../ui/feel';
import { Sheet } from '../ui/sheet';
import { sp } from '../ui/space';
import { useColours, useStyles, type Palette } from '../ui/theme';
import { readChange, startChange, type ChangeEnd, type ChangeOptions, type SecretChange } from './change-model';

/**
 * Change a link (0.9.0-dev.49, LK; the owner's decision of 15 Nov 2026), from
 * Sharing, as the web's Sharing does it: the form it was made with, filled
 * in as it is now — whom it is for, when it stops, View or View and
 * download, how often it opens, its PIN or password, and whether its page
 * shows the title. From a document's page and a person's emergency page
 * too (app 0.18.0), each link there with Change, as the web has them; a
 * clinician's stays to view. It stays the same link, to the same thing; a code by
 * email or text, and "This browser only", stay as they were made, and the
 * sheet says so. Only what is changed is sent, If-Match its version.
 *
 * Making it reach further — a later end, View to download, more opens or
 * none, its PIN or password taken away or weakened, its title shown — asks
 * to confirm it is you (the vault asks, the step-up answers). A new PIN or
 * a password the vault made up is shown here once, with Copy, and can be
 * shown again with Show the link. An owner changing somebody else's link
 * changes all but its PIN or password, which stay with whoever made it.
 */
export function ChangeLinkSheet(props: { link: Share; what: string; onClose: () => void; onDone: (said: string) => void }) {
  const styles = useStyles(makeStyles);
  const colours = useColours();
  const { t } = useTranslation();
  const zone = useFamilyZone();
  const { caps } = useVault();
  const { guarded } = useStepUp();
  const { link } = props;
  const [v, setV] = useState<ChangeOptions>(() => startChange(link, zone));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [made, setMade] = useState<ChangedShare | null>(null);
  const [copied, setCopied] = useState(false);
  const set = (change: Partial<ChangeOptions>) => setV((o) => ({ ...o, ...change }));
  const protects = caps?.features.sensitive_protects === true;
  const read = readChange(link, v, {
    timezone: zone,
    protects,
    ...(caps?.limits?.share_max_days ? { maxDays: caps.limits.share_max_days } : {}),
  });
  const said = t('changeLink.changed', { what: props.what });

  const save = async () => {
    if (read.nothing || read.problem || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const done = await guarded((a, tk) => a.changeShare(tk, link.id, read.body, link.version));
      if (!done) return;
      feel('done');
      emit('sharesChanged');
      if (done.pin || done.password) setMade(done);
      else props.onDone(said);
    } catch (err) {
      setProblem(wordsFor(err, t));
      // Changed meanwhile (409), or ended (410): Sharing reads the links again, so
      // Change opened again starts from the link as it is now.
      if (err instanceof ApiRequestError && (err.code === 'conflict' || err.code === 'share_ended')) {
        emit('sharesChanged');
      }
    } finally {
      setBusy(false);
    }
  };

  if (made) {
    const secret = made.pin ?? made.password ?? '';
    const which = made.pin ? 'pin' : 'password';
    const clipboard = nativeClipboard();
    return (
      <Sheet visible onClose={() => props.onDone(said)} testID="change-link-secret" keyboard>
        <Text variant="screen">{t(`changeLink.new_${which}`)}</Text>
        <Text variant="secondary" tone="soft">
          {t(`changeLink.newWords_${which}`)}
        </Text>
        <View style={styles.secretBox}>
          <Text variant="title" testID="change-link-new-secret">
            {secret}
          </Text>
        </View>
        {clipboard ? (
          <Button
            kind="quiet"
            label={copied ? t('share.copied') : made.pin ? t('share.copyPin') : t('share.copyPassword')}
            onPress={() => {
              if (copyForAMinute(clipboard, secret)) setCopied(true);
            }}
            testID="change-link-copy"
          />
        ) : null}
        <Text variant="small" tone="soft">
          {t(`changeLink.tellApart_${which}`)}{' '}
          {made.share.revealable === true ? t('changeLink.seeAgain') : t('changeLink.onlyNow')}
        </Text>
        <Button label={t('share.done')} onPress={() => props.onDone(said)} testID="change-link-done" />
      </Sheet>
    );
  }

  const endWords = (p: string | null) =>
    p === 'day'
      ? t('share.badDay')
      : p === 'time'
        ? t('share.badTime')
        : p === 'latest' && read.latest
          ? t('changeLink.latest', { end: shareEndWords(read.latest, zone) })
          : p;
  // What else protects it, said where its protection is: each stays as it was made.
  const fixed = [
    ...((link.protection ?? []).includes('code')
      ? [
          t(link.second_factor === 'sms' ? 'changeLink.codeByText' : 'changeLink.codeByEmail', {
            to: link.code_to ?? t('changeLink.codeSomewhere'),
          }),
        ]
      : []),
    ...(link.this_device_only ? [t('changeLink.oneBrowser')] : []),
  ];
  const secretChoices: [SecretChange, string][] = [
    ['keep', read.has === 'pin' ? t('changeLink.keepPin') : read.has === 'password' ? t('changeLink.keepPassword') : t('changeLink.noneAsNow')],
    ...(read.has ? [['none', t('changeLink.noSecret')] as [SecretChange, string]] : []),
    ['pin', read.has === 'pin' ? t('changeLink.newPin') : t('changeLink.aPin')],
    ...(caps?.features.share_second_factor === true
      ? [['password', read.has === 'password' ? t('changeLink.newPassword') : t('changeLink.aPassword')] as [SecretChange, string]]
      : []),
  ];
  const endChoices: ChangeEnd[] = ['keep', ...read.picks.map((p) => p.key), 'other'];

  return (
    <Sheet visible onClose={props.onClose} testID="change-link" keyboard tall>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text variant="screen">{t('changeLink.title')}</Text>
        <Text variant="secondary" tone="soft" testID="change-link-what">
          {props.what}
        </Text>
        <Text variant="small" tone="soft">
          {t(read.emergency ? 'changeLink.wordsEmergency' : link.collection_id ? 'changeLink.wordsCollection' : 'changeLink.words')}
        </Text>
        <Field
          label={t('share.forWhom')}
          value={v.label}
          onChangeText={(label) => set({ label })}
          maxLength={100}
          autoCapitalize="words"
          testID="change-link-label"
        />

        <View style={styles.section}>
          <Text variant="secondary" weight="600" tone="soft">
            {t('share.ends')}
          </Text>
          <ChipRow label={t('share.ends')}>
            {endChoices.map((key) => (
              <Chip
                key={key}
                label={key === 'keep' ? t('changeLink.endAsNow') : t(`share.end_${key}`)}
                selected={v.end === key}
                onPress={() => set({ end: key })}
                testID={`change-link-end-${key}`}
              />
            ))}
          </ChipRow>
          {v.end === 'other' ? (
            <View style={styles.row}>
              <View style={styles.flex}>
                <Field label={t('share.day')} value={v.day} onChangeText={(day) => set({ day })} testID="change-link-day" />
              </View>
              <View style={styles.time}>
                <Field
                  label={t('share.time')}
                  value={v.time}
                  onChangeText={(time) => set({ time })}
                  placeholder="17:00"
                  testID="change-link-time"
                />
              </View>
            </View>
          ) : null}
          {!read.endProblem ? (
            <Text variant="small" tone="soft" testID="change-link-end-words">
              {t('share.endsAt', { end: shareEndWords(read.endAt ?? new Date(link.expires_at), zone) })}
            </Text>
          ) : (
            <Text variant="secondary" tone="danger" role="alert" testID="change-link-end-problem">
              {endWords(read.endProblem)}
            </Text>
          )}
        </View>

        {read.emergency ? (
          <Text variant="small" tone="soft" testID="change-link-view-only">
            {t('changeLink.emergencyView')}
          </Text>
        ) : caps?.features.share_options === true ? (
          <View style={styles.section}>
            <Text variant="secondary" weight="600" tone="soft">
              {t('share.theyCan')}
            </Text>
            <ChipRow label={t('share.theyCan')}>
              {(['download', 'view'] as const).map((p) => (
                <Chip
                  key={p}
                  label={t(`share.permission_${p}`)}
                  selected={v.permission === p}
                  onPress={() => set({ permission: p })}
                  testID={`change-link-permission-${p}`}
                />
              ))}
            </ChipRow>
          </View>
        ) : null}

        <Field
          label={t('share.opens')}
          value={v.opens}
          onChangeText={(opens) => set({ opens })}
          keyboardType="number-pad"
          placeholder={t('share.opensNone')}
          error={read.opensProblem ? t('share.opensProblem') : null}
          testID="change-link-opens"
        />

        <View style={styles.section} testID="change-link-protect">
          <Text variant="secondary" weight="600" tone="soft">
            {t('changeLink.protect')}
          </Text>
          {read.maker ? (
            <>
              <ChipRow label={t('changeLink.protect')}>
                {secretChoices.map(([key, label]) => (
                  <Chip
                    key={key}
                    label={label}
                    selected={v.secret === key}
                    onPress={() => set({ secret: key })}
                    testID={`change-link-secret-${key}`}
                  />
                ))}
              </ChipRow>
              {v.secret === 'password' ? (
                <>
                  <ChipRow label={t('changeLink.passwordHow')}>
                    {(['made', 'typed'] as const).map((m) => (
                      <Chip
                        key={m}
                        label={t(`changeLink.password_${m}`)}
                        selected={v.passwordMode === m}
                        onPress={() => set({ passwordMode: m })}
                        testID={`change-link-password-${m}`}
                      />
                    ))}
                  </ChipRow>
                  {v.passwordMode === 'typed' ? (
                    <Field
                      label={t('changeLink.typedPassword')}
                      value={v.password}
                      onChangeText={(password) => set({ password })}
                      autoCapitalize="none"
                      autoComplete="off"
                      maxLength={64}
                      error={v.password && read.passwordProblem ? t('changeLink.passwordShort') : null}
                      testID="change-link-password"
                    />
                  ) : null}
                  <Text variant="small" tone="soft">
                    {v.passwordMode === 'typed' ? t('changeLink.typedNote') : t('changeLink.madeNote')}
                  </Text>
                </>
              ) : null}
              {v.secret !== 'keep' && read.has !== null ? (
                <Text variant="small" tone="soft" testID="change-link-old-stops">
                  {t(`changeLink.oldStops_${read.has}`)}
                </Text>
              ) : null}
            </>
          ) : (
            <Text variant="small" tone="soft" testID="change-link-not-maker">
              {t(read.has ? `changeLink.notMaker_${read.has}` : 'changeLink.notMakerNone')}
            </Text>
          )}
          {fixed.map((words) => (
            <Text key={words} variant="small" tone="soft">
              {words}
            </Text>
          ))}
        </View>

        {protects && !read.emergency ? (
          <View style={styles.switchRow}>
            <Text style={styles.flex}>{SHOW_TITLE_LABEL}</Text>
            <Switch
              testID="change-link-show-title"
              accessibilityLabel={SHOW_TITLE_LABEL}
              value={v.showTitle}
              onValueChange={(showTitle) => set({ showTitle })}
              trackColor={{ true: colours.accent, false: colours.border }}
            />
          </View>
        ) : null}

        {problem ? (
          <Notice tone="warn" testID="change-link-problem">
            {problem}
          </Notice>
        ) : null}
        {read.nothing ? (
          <Text variant="small" tone="soft" testID="change-link-nothing">
            {t('changeLink.nothing')}
          </Text>
        ) : (
          <Text variant="small" tone="soft">
            {t('changeLink.asksMore')}
          </Text>
        )}
        <Button
          label={t('changeLink.save')}
          busy={busy}
          disabled={read.nothing || read.problem !== null}
          onPress={() => void save()}
          testID="change-link-save"
        />
        <Button kind="quiet" label={t('common.cancel')} disabled={busy} onPress={props.onClose} testID="change-link-cancel" />
      </ScrollView>
    </Sheet>
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    scroll: { flexGrow: 0, flexShrink: 1 },
    body: { gap: sp(12) },
    section: { gap: sp(8) },
    row: { flexDirection: 'row', gap: sp(8) },
    flex: { flex: 1 },
    time: { width: 104 },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: sp(12), minHeight: 48 },
    secretBox: {
      padding: sp(12),
      borderRadius: radii.m,
      borderWidth: 1,
      borderColor: colours.border,
      backgroundColor: colours.surface,
    },
  });
