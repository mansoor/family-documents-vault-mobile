import { ApiRequestError } from '@fdv/client';
import {
  canShareToView,
  DOWNLOAD_KEEPS_DETAILS,
  FOLLOW_MAX_DAYS,
  radii,
  SENSITIVE_LABEL,
  SENSITIVE_SHARE_CONFIRM,
  sensitiveCollectionShareConfirm,
  SHARE_MAX_DAYS,
  shareEndWords,
  SHOW_TITLE_COLLECTION_HINT,
  SHOW_TITLE_LABEL,
  SHOW_TITLE_SENSITIVE_HINT,
  type CollectionShareItem,
  type CreatedShare,
  type ShareInput,
} from '@fdv/shared';
import { Check, Eye, EyeOff } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Share as SystemShare, StyleSheet, Switch, View } from 'react-native';
import { wordsFor } from '../errors/words';
import { copyForAMinute, nativeClipboard } from '../identity/clipboard';
import { emit } from '../state/events';
import { useFamilyZone } from '../state/family-time';
import { useStepUp } from '../state/step-up';
import { useVault } from '../state/vault';
import { Button, Field, Notice, Text } from '../ui';
import { Chip, ChipRow } from '../ui/chip';
import { IconButton } from '../ui/icon-button';
import { feel } from '../ui/feel';
import { Sheet } from '../ui/sheet';
import { sp } from '../ui/space';
import { LoadFailed, loadFailure, Placeholder } from '../ui/states';
import { useColours, useStyles, type Palette } from '../ui/theme';
import { EmailTheLink } from './email-link';
import { useSensitiveConfirm } from './sensitive-confirm';
import { NO_SHARE_OPTIONS, readShareOptions, type EndChoice, type Protection, type ShareOptions } from './share-model';

/**
 * What is being shared: a document (or a note kept on its own), or a
 * collection. `sensitive`: the document is sensitive, all said
 * (`sensitive_effective`), so the sheet asks before its link is made.
 */
export type ShareTarget =
  | { kind: 'document'; id: string; title: string; note: boolean; onlyMe: boolean; sensitive?: boolean }
  | { kind: 'collection'; id: string; name: string };

/**
 * Share (the owner's ask of 11 Nov 2026): one sheet for a document, a note
 * or a collection, as the web shares them. Whom the link is for, when it
 * stops, whether they may download or only view, how often it opens, and a
 * PIN or a password the vault makes up; for a collection, which of its
 * documents go (ticked as the web ticks them) and whether the link keeps
 * up with it. Made, the link — and its PIN or password — is shown here once
 * and nowhere else: Send gives the phone's own share menu, Copy puts it on
 * the clipboard for a minute, and Email the link (0.9.0) has the vault
 * email it, where it can. An Only me document goes only where the
 * household lets them; a collection always asks to confirm it is you.
 *
 * What Sensitive protects (a vault with `sensitive_protects`, 0.9.0-dev.41,
 * H1a), as the web's share sheets do it: a sensitive document asks before
 * its link is made — a collection's, with one ticked, says how many — and
 * "Show its title on the link page" is off for it, so the page the
 * recipient opens says "A document". A `409 sensitive_confirm` the phone
 * did not see coming asks the vault's own question, and the link is made
 * once it is answered.
 */
export function ShareSheet(props: { target: ShareTarget; onClose: () => void }) {
  const styles = useStyles(makeStyles);
  const colours = useColours();
  const { t } = useTranslation();
  const zone = useFamilyZone();
  const { withToken, caps, vault } = useVault();
  const { guarded } = useStepUp();
  const { target } = props;
  const [opts, setOpts] = useState<ShareOptions>(NO_SHARE_OPTIONS);
  const [viewable, setViewable] = useState(true);
  const [refused, setRefused] = useState<string | null>(null);
  const [items, setItems] = useState<CollectionShareItem[] | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [follow, setFollow] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // The link and its PIN or password, shown when asked for (the owner's ask of 11 Nov 2026): Send and Copy need neither.
  const [shown, setShown] = useState(false);
  const [made, setMade] = useState<CreatedShare | null>(null);
  const [copied, setCopied] = useState<'link' | 'secret' | null>(null);
  // A code by text can be offered (SMS4): the vault texts links' codes and its texts are set up.
  const [texts, setTexts] = useState(false);
  const set = (change: Partial<ShareOptions>) => setOpts((o) => ({ ...o, ...change }));
  // What Sensitive protects (H1a), where the vault has it.
  const protects = caps?.features.sensitive_protects === true;
  const sensitive = target.kind === 'document' && target.sensitive === true;
  // Its title on the link's page: off for a sensitive document; for a collection's sensitive ones, off until chosen.
  const [showTitle, setShowTitle] = useState(target.kind === 'document' && !sensitive);
  const confirm = useSensitiveConfirm(
    target.kind === 'document'
      ? { title: t('sensitive.shareTitle'), confirmLabel: t('sensitive.shareYes'), id: 'share-sensitive' }
      : { title: t('sensitive.shareManyTitle'), confirmLabel: t('sensitive.shareManyYes'), id: 'share-sensitive' },
  );

  const load = useCallback(async () => {
    if (caps?.features.sms_codes === true) {
      withToken((a, tk) => a.smsStatus(tk)).then(
        (st) => setTexts(st.ready),
        () => setTexts(false),
      );
    }
    try {
      if (target.kind === 'document') {
        const [versions, rule] = await withToken((a, tk) =>
          Promise.all([
            a.versions(tk, target.id).catch(() => ({ items: [] })),
            target.onlyMe ? a.onlyMeSharing(tk).catch(() => null) : Promise.resolve(null),
          ]),
        );
        const newest = [...versions.items].sort((x, y) => y.version_no - x.version_no)[0] ?? null;
        setViewable(!newest || canShareToView(newest.mime));
        // An older vault says nothing: as before, it may go.
        setRefused(rule && !rule.only_me_shareable ? t('share.onlyMeRefused') : null);
      } else {
        const preview = await withToken((a, tk) => a.collectionSharePreview(tk, target.id));
        setItems(preview.items);
        setTicked(new Set(preview.items.filter((i) => i.ticked).map((i) => i.document_id)));
        setViewable(preview.items.some((i) => i.viewable));
      }
      setFailed(null);
      setReady(true);
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'collection_only_me') setRefused(err.message);
      else setFailed(loadFailure('share', err, t) ?? wordsFor(err, t));
      setReady(true);
    }
  }, [withToken, target, t, caps]);

  useEffect(() => {
    // Asked once, as the sheet opens; set once the vault answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const maxDays = Math.min(caps?.limits?.share_max_days ?? SHARE_MAX_DAYS, follow ? FOLLOW_MAX_DAYS : Infinity);
  const read = readShareOptions(opts, {
    timezone: zone,
    maxDays,
    viewable,
    note: target.kind === 'document' && target.note,
    options: caps?.features.share_options === true,
    passwords: caps?.features.share_second_factor === true,
    texts,
  });
  const nothingTicked = target.kind === 'collection' && ticked.size === 0 && !follow;
  const sensitiveTicked = (items ?? []).filter((i) => i.sensitive === true && ticked.has(i.document_id)).length;
  // A collection's choice is offered with a sensitive one ticked, or a link that keeps up with it, as the web's.
  const titleChoice = protects && (target.kind === 'document' || sensitiveTicked > 0 || follow);

  const share = async () => {
    if (!read.body || busy || nothingTicked) return;
    setBusy(true);
    setProblem(null);
    try {
      // Its title on the link's page (H1a): a document's said only when it is
      // not what the vault would do anyway, so one made sensitive later is
      // covered too; a collection's only when chosen.
      const titled: Pick<ShareInput, 'show_title'> =
        protects && target.kind === 'document' && showTitle !== !sensitive
          ? { show_title: showTitle }
          : protects && target.kind === 'collection' && titleChoice && showTitle
            ? { show_title: true }
            : {};
      const body = { ...read.body, ...titled };
      const asked = (confirmed: boolean) => (confirmed ? { confirm_sensitive: true } : {});
      // Known to be sensitive: asked first, in the web's words; else only if the vault asks.
      const first = !protects
        ? null
        : target.kind === 'document'
          ? sensitive
            ? SENSITIVE_SHARE_CONFIRM
            : null
          : sensitiveTicked > 0
            ? sensitiveCollectionShareConfirm(sensitiveTicked)
            : null;
      const created = await confirm.ask(
        (confirmed) =>
          guarded((a, tk) =>
            target.kind === 'document'
              ? a.share(tk, target.id, { ...body, ...asked(confirmed) })
              : a.shareCollection(tk, target.id, {
                  ...body,
                  document_ids: [...ticked],
                  ...(follow ? { follow_collection: true } : {}),
                  left_out_ids: (items ?? []).filter((i) => !ticked.has(i.document_id)).map((i) => i.document_id),
                  ...asked(confirmed),
                }),
          ),
        first,
      );
      if (created === null) return;
      feel('done');
      setMade(created);
      emit('sharesChanged');
    } catch (err) {
      setProblem(wordsFor(err, t));
    } finally {
      setBusy(false);
    }
  };

  const name = target.kind === 'document' ? target.title : target.name;
  const endWords = (problem: string | null) =>
    problem === 'day' ? t('share.badDay') : problem === 'time' ? t('share.badTime') : problem;

  if (made) {
    const link = made.link_url ?? `${vault?.origin ?? ''}/s#${made.link_token}`;
    const secret = made.pin ?? made.password ?? null;
    const clipboard = nativeClipboard();
    const copy = (what: 'link' | 'secret', text: string) => {
      if (clipboard && copyForAMinute(clipboard, text)) setCopied(what);
    };
    return (
      <Sheet visible onClose={props.onClose} testID="share-sheet" keyboard tall>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text variant="screen">{t('share.madeTitle')}</Text>
          <Text variant="secondary" tone="soft">
            {t('share.madeWords', { name, end: shareEndWords(new Date(made.share.expires_at), zone) })}
          </Text>
          <Button
            label={t('share.send')}
            onPress={() => void SystemShare.share({ message: link })}
            testID="share-send"
          />
          {clipboard ? (
            <Button
              kind="quiet"
              label={copied === 'link' ? t('share.copied') : t('share.copyLink')}
              onPress={() => copy('link', link)}
              testID="share-copy-link"
            />
          ) : null}
          {clipboard && secret ? (
            <Button
              kind="quiet"
              label={copied === 'secret' ? t('share.copied') : made.pin ? t('share.copyPin') : t('share.copyPassword')}
              onPress={() => copy('secret', secret)}
              testID="share-copy-secret"
            />
          ) : null}
          {secret ? (
            <Text variant="small" tone="soft">
              {t('share.secretApart')}
            </Text>
          ) : null}
          <EmailTheLink share={made.share} testID="share-email" />
          {made.share.second_factor === 'sms' && made.share.code_to ? (
            <Notice tone="info" testID="share-code-by-text">
              {t('share.codeByText', { to: made.share.code_to })}
            </Notice>
          ) : null}
          {/* What was made, behind the eye: Send and Copy above need none of it. */}
          <View style={styles.revealRow}>
            <Text variant="secondary" weight="600" style={styles.flex}>
              {secret ? (made.pin ? t('share.linkAndPin') : t('share.linkAndPassword')) : t('share.theLink')}
            </Text>
            <IconButton
              testID="share-reveal"
              label={shown ? t('share.hide') : t('share.reveal')}
              icon={shown ? EyeOff : Eye}
              onPress={() => setShown((s) => !s)}
            />
          </View>
          {shown ? (
            <>
              <View style={styles.linkBox}>
                <Text selectable testID="share-link">
                  {link}
                </Text>
              </View>
              {secret ? (
                <View style={styles.secret}>
                  <Text variant="secondary" weight="600" tone="soft">
                    {made.pin ? t('share.pin') : t('share.password')}
                  </Text>
                  <Text variant="title" selectable testID="share-secret">
                    {secret}
                  </Text>
                </View>
              ) : null}
            </>
          ) : null}
          {/* A vault of 0.9.0-dev.30 keeps it, to show its maker again from Sharing. */}
          {made.share.revealable ? (
            <Notice tone="info" testID="share-again-later">
              {t('share.againLater')}
            </Notice>
          ) : (
            <Notice tone="warn">{t('share.onlyNow')}</Notice>
          )}
          <Button kind="quiet" label={t('share.done')} onPress={props.onClose} testID="share-done" />
        </ScrollView>
      </Sheet>
    );
  }

  return (
    <Sheet visible onClose={confirm.asking ? confirm.cancel : props.onClose} testID="share-sheet" keyboard tall>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text variant="screen">{t('share.title')}</Text>
        <Text variant="secondary" tone="soft" testID="share-what">
          {name}
        </Text>
        {/* Asked before a sensitive document goes (H1a): in the form's place, until answered. */}
        {confirm.body}
        {!confirm.asking ? (
          <>
            {!ready ? <Placeholder rows={2} /> : null}
            {failed ? <LoadFailed words={failed} onRetry={() => void load()} /> : null}
            {refused ? (
              <Notice tone="warn" testID="share-refused">
                {refused}
              </Notice>
            ) : null}
            {ready && !failed && !refused ? (
              <>
                {target.kind === 'document' && target.onlyMe ? (
                  <Notice tone="warn" testID="share-only-me">
                    {t('share.onlyMeWarning')}
                  </Notice>
                ) : null}
                <Field
                  label={t('share.forWhom')}
                  value={opts.label}
                  onChangeText={(v) => set({ label: v })}
                  maxLength={100}
                  autoCapitalize="words"
                  placeholder={t('share.forWhomExample')}
                  testID="share-label"
                />

                <View style={styles.section}>
                  <Text variant="secondary" weight="600" tone="soft">
                    {t('share.ends')}
                  </Text>
                  <ChipRow label={t('share.ends')}>
                    {[...read.picks.map((p) => p.key), 'other' as const].map((key: EndChoice) => (
                      <Chip
                        key={key}
                        label={t(`share.end_${key}`)}
                        selected={read.end === key}
                        onPress={() => set({ end: key })}
                        testID={`share-end-${key}`}
                      />
                    ))}
                  </ChipRow>
                  {read.end === 'other' ? (
                    <View style={styles.row}>
                      <View style={styles.flex}>
                        <Field
                          label={t('share.day')}
                          value={opts.day}
                          onChangeText={(v) => set({ day: v })}
                          placeholder={read.fallback.date}
                          testID="share-day"
                        />
                      </View>
                      <View style={styles.time}>
                        <Field
                          label={t('share.time')}
                          value={opts.time}
                          onChangeText={(v) => set({ time: v })}
                          placeholder="17:00"
                          testID="share-time"
                        />
                      </View>
                    </View>
                  ) : null}
                  {read.endAt && !read.endProblem ? (
                    <Text variant="small" tone="soft" testID="share-end-words">
                      {t('share.endsAt', { end: shareEndWords(read.endAt, zone) })}
                    </Text>
                  ) : null}
                  {read.endProblem ? (
                    <Text variant="secondary" tone="danger" role="alert" testID="share-end-problem">
                      {endWords(read.endProblem)}
                    </Text>
                  ) : null}
                </View>

                {caps?.features.share_options === true && !(target.kind === 'document' && target.note) && viewable ? (
                  <View style={styles.section}>
                    <Text variant="secondary" weight="600" tone="soft">
                      {t('share.theyCan')}
                    </Text>
                    <ChipRow label={t('share.theyCan')}>
                      {(['download', 'view'] as const).map((p) => (
                        <Chip
                          key={p}
                          label={t(`share.permission_${p}`)}
                          selected={opts.permission === p}
                          onPress={() => set({ permission: p })}
                          testID={`share-permission-${p}`}
                        />
                      ))}
                    </ChipRow>
                  </View>
                ) : null}

                {caps?.features.share_options === true ? (
                  <Field
                    label={t('share.opens')}
                    value={opts.opens}
                    onChangeText={(v) => set({ opens: v })}
                    keyboardType="number-pad"
                    placeholder={t('share.opensNone')}
                    error={read.opensProblem ? t('share.opensProblem') : null}
                    testID="share-opens"
                  />
                ) : null}

                <View style={styles.section}>
                  <Text variant="secondary" weight="600" tone="soft">
                    {t('share.protect')}
                  </Text>
                  <ChipRow label={t('share.protect')}>
                    {(
                      [
                        'none',
                        'pin',
                        ...(caps?.features.share_second_factor === true ? (['password'] as const) : []),
                        ...(texts ? (['text'] as const) : []),
                      ] as Protection[]
                    ).map(
                      (p) => (
                        <Chip
                          key={p}
                          label={t(`share.protect_${p}`)}
                          selected={opts.protection === p}
                          onPress={() => set({ protection: p })}
                          testID={`share-protect-${p}`}
                        />
                      ),
                    )}
                  </ChipRow>
                  {texts && opts.protection === 'text' ? (
                    <>
                      <Field
                        label={t('share.phone')}
                        value={opts.phone}
                        onChangeText={(phone) => set({ phone })}
                        keyboardType="phone-pad"
                        textContentType="telephoneNumber"
                        autoComplete="tel"
                        error={opts.phone.trim() && read.phoneProblem ? t('share.phoneProblem') : null}
                        testID="share-phone"
                      />
                      <Text variant="small" tone="soft">
                        {t('share.phoneHint')}
                      </Text>
                    </>
                  ) : null}
                </View>

                {target.kind === 'collection' && items ? (
                  <View style={styles.section} testID="share-items">
                    <Text variant="secondary" weight="600" tone="soft">
                      {t('share.whichGo')}
                    </Text>
                    {items.length === 0 ? (
                      <Text tone="soft">{t('share.noneInIt')}</Text>
                    ) : (
                      items.map((i) => {
                        const on = ticked.has(i.document_id);
                        const locked = i.lock === 'no_file';
                        return (
                          <Pressable
                            key={i.document_id}
                            testID={`share-item-${i.document_id}`}
                            accessibilityRole="checkbox"
                            accessibilityLabel={i.title ?? t('document.untitled')}
                            accessibilityState={{ checked: on, disabled: locked }}
                            disabled={locked}
                            onPress={() =>
                              setTicked((had) => {
                                const next = new Set(had);
                                if (next.has(i.document_id)) next.delete(i.document_id);
                                else next.add(i.document_id);
                                return next;
                              })
                            }
                            style={({ pressed }) => [styles.item, pressed ? styles.pressed : null]}
                          >
                            <View style={[styles.box, on ? styles.boxOn : null]}>
                              {on ? (
                                <Check color={colours.accent} size={16} accessibilityElementsHidden importantForAccessibility="no" />
                              ) : null}
                            </View>
                            <View style={styles.flex}>
                              <Text>{i.title ?? t('document.untitled')}</Text>
                              {protects && i.sensitive === true ? (
                                <Text variant="small" tone="soft" testID={`share-item-sensitive-${i.document_id}`}>
                                  {SENSITIVE_LABEL}
                                </Text>
                              ) : null}
                              {i.reason ? (
                                <Text variant="small" tone="soft">
                                  {i.reason}
                                </Text>
                              ) : null}
                            </View>
                          </Pressable>
                        );
                      })
                    )}
                    <View style={styles.switchRow}>
                      <View style={styles.flex}>
                        <Text>{t('share.follow')}</Text>
                        <Text variant="small" tone="soft">
                          {t('share.followWords', { days: FOLLOW_MAX_DAYS })}
                        </Text>
                      </View>
                      <Switch
                        testID="share-follow"
                        accessibilityLabel={t('share.follow')}
                        value={follow}
                        onValueChange={setFollow}
                        trackColor={{ true: colours.accent, false: colours.border }}
                      />
                    </View>
                  </View>
                ) : null}

                {titleChoice ? (
                  <View style={styles.section}>
                    <View style={styles.switchRow}>
                      <Text style={styles.flex}>{SHOW_TITLE_LABEL}</Text>
                      <Switch
                        testID="share-show-title"
                        accessibilityLabel={SHOW_TITLE_LABEL}
                        value={showTitle}
                        onValueChange={setShowTitle}
                        trackColor={{ true: colours.accent, false: colours.border }}
                      />
                    </View>
                    {target.kind === 'collection' || sensitive ? (
                      <Text variant="small" tone="soft" testID="share-show-title-hint">
                        {target.kind === 'collection' ? SHOW_TITLE_COLLECTION_HINT : SHOW_TITLE_SENSITIVE_HINT}
                      </Text>
                    ) : null}
                    {/* The page, not the file (the vault's H1a review, M5). */}
                    <Text variant="small" tone="soft" testID="share-download-keeps">
                      {DOWNLOAD_KEEPS_DETAILS}
                    </Text>
                  </View>
                ) : null}

                {problem ? (
                  <Notice tone="warn" testID="share-problem">
                    {problem}
                  </Notice>
                ) : null}
                <Button
                  label={t('share.make')}
                  busy={busy}
                  disabled={!read.body || nothingTicked}
                  onPress={() => void share()}
                  testID="share-make"
                />
              </>
            ) : null}
            <Button kind="quiet" label={t('common.cancel')} disabled={busy} onPress={props.onClose} testID="share-cancel" />
          </>
        ) : null}
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
    revealRow: { flexDirection: 'row', alignItems: 'center', gap: sp(8) },
    linkBox: {
      padding: sp(12),
      borderRadius: radii.m,
      borderWidth: 1,
      borderColor: colours.border,
      backgroundColor: colours.surface,
    },
    secret: { gap: sp(4) },
    item: { flexDirection: 'row', alignItems: 'center', gap: sp(10), minHeight: 44 },
    pressed: { opacity: 0.8 },
    box: {
      width: 22,
      height: 22,
      borderRadius: 6,
      borderWidth: 2,
      borderColor: colours.borderInput,
      alignItems: 'center',
      justifyContent: 'center',
    },
    boxOn: { borderColor: colours.accent },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: sp(12), minHeight: 48 },
  });
