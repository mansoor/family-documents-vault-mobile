import { radii, shareEndWords, type RevealedUploadRequest, type UploadRequestView } from '@fdv/shared';
import type { TFunction } from 'i18next';
import { Inbox } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Share as SystemShare, StyleSheet, View } from 'react-native';
import { copyForAMinute, nativeClipboard } from '../identity/clipboard';
import { Button, Text } from '../ui';
import { Sheet } from '../ui/sheet';
import { SheetScroll } from '../ui/keyboard';
import { sp } from '../ui/space';
import { useColours, useStyles, type Palette } from '../ui/theme';
import { emit } from '../state/events';
import { EmailTheLink } from './email-link';

/**
 * Requests to send documents (5.22; as a list of their own since the
 * vault's 0.9.0-dev.53, RQ), in Sharing, as the web's Sharing lists them on
 * a phone: what was asked for, whom it is for, who asked when it is somebody
 * else's, what came in, and where it stands — in words, never colour alone.
 * Working now, then No longer working.
 */

/**
 * What Sharing says when it is in front again, after a request is changed on
 * its own screen (0.18.0): handed over with the event, and kept until
 * Sharing takes it — so it is said whether Sharing stayed open underneath
 * or is drawn afresh.
 */
let toSay: string | null = null;
export function sayInSharing(words: string): void {
  toSay = words;
  emit('requestsChanged', words);
}
export const waitingSaid = (): string | null => toSay;
export function takeSaid(): string | null {
  const words = toSay;
  toSay = null;
  return words;
}

/** A request that can still be used, or is only paused: ending it still means something. */
export const requestWorking = (r: UploadRequestView) =>
  r.state === 'active' || r.state === 'paused' || r.state === 'used_up';

/** "No files yet · 1 of 3 visits used": what a request has had. */
export function requestTally(r: UploadRequestView, t: TFunction): string {
  const files = r.files_received === 0 ? t('requests.noFiles') : t('requests.files', { count: r.files_received });
  const visits =
    r.max_visits != null
      ? t('requests.visitsOf', { used: r.visits_used, count: r.max_visits })
      : r.visits_used === 0
        ? t('requests.notOpened')
        : t('requests.opened', { count: r.visits_used });
  return `${files} · ${visits}`;
}

/**
 * Where a request stands, as the web says it. A paused one says who can turn
 * it back on: an owner, or — for an adult's own request only they look at,
 * which no owner can see — nobody, so it is ended and asked again.
 */
export function requestState(
  r: UploadRequestView,
  owner: boolean,
  zone: string,
  t: TFunction,
): { words: string; tone: 'ok' | 'warn' | 'danger' | null } {
  const at = shareEndWords(new Date(r.expires_at), zone);
  const who = r.requested_by_name ?? t('requests.whoeverAsked');
  switch (r.state) {
    case 'active':
      return { words: t('requests.working', { at }), tone: 'ok' };
    case 'paused':
      if (r.paused_reason === 'locked') return { words: t('requests.pausedLocked', { who }), tone: 'warn' };
      if (r.paused_reason === 'sign_in_paused') return { words: t('requests.pausedSignIn', { who }), tone: 'warn' };
      if (r.paused_reason !== 'restored') return { words: t('requests.paused'), tone: 'warn' };
      return {
        words: owner
          ? t('requests.pausedRestore')
          : r.mine && r.review_by === 'me'
            ? t('requests.pausedRestoreOnlyYou')
            : t('requests.pausedRestoreOwner'),
        tone: 'warn',
      };
    case 'used_up':
      return { words: t('requests.usedUp'), tone: 'warn' };
    case 'expired':
      return { words: t('requests.expired', { at }), tone: null };
    case 'revoked':
      return { words: t('requests.revoked'), tone: null };
    case 'locked':
      return { words: t('requests.locked'), tone: 'danger' };
    case 'closed':
      return {
        words:
          r.closed_reason === 'submitted'
            ? t('requests.closedSent')
            : r.closed_reason === 'requester_lost_right'
              ? t('requests.closedLostRight')
              : t('requests.closed'),
        tone: null,
      };
    default:
      return { words: String(r.state), tone: null };
  }
}

/** Whom a request is for, who asked, and who looks: what the row says under its title. */
export function requestWho(r: UploadRequestView, t: TFunction): string[] {
  return [
    r.recipient_label ? t('sharing.for', { who: r.recipient_label }) : null,
    !r.mine && r.requested_by_name ? t('requests.askedBy', { who: r.requested_by_name }) : null,
    r.review_by === 'adults' ? t('requests.anyAdult') : null,
  ].filter((w): w is string => w !== null);
}

/** Only a restore's own pause is an owner's to end here. */
export const requestResumable = (r: UploadRequestView, owner: boolean) =>
  owner && r.state === 'paused' && r.paused_reason === 'restored';

/** One request: its words, then what may be done with it while it works. */
export function RequestRow(props: {
  request: UploadRequestView;
  owner: boolean;
  zone: string;
  /** Present while it works: each shown where the request allows it. */
  actions?: {
    disabled: boolean;
    showing: boolean;
    resuming: boolean;
    onShow?: () => void;
    onChange?: () => void;
    onResume?: () => void;
    onEnd: () => void;
  };
}) {
  const styles = useStyles(makeStyles);
  const colours = useColours();
  const { t } = useTranslation();
  const r = props.request;
  const state = requestState(r, props.owner, props.zone, t);
  const a = props.actions;
  const lines = [...requestWho(r, t), requestTally(r, t)];
  const target = t('requests.target', { title: r.title });
  return (
    <View style={styles.row} testID={`request-${r.id}`}>
      <View style={styles.head}>
        <View style={styles.icon}>
          <Inbox color={colours.accent} size={18} accessibilityElementsHidden importantForAccessibility="no" />
        </View>
        <View style={styles.words}>
          <Text weight="600">{`“${r.title}”`}</Text>
          {lines.map((l) => (
            <Text key={l} variant="small" tone="soft">
              {l}
            </Text>
          ))}
          <Text
            variant="small"
            {...(state.tone ? { weight: '600' as const } : {})}
            tone={state.tone === 'danger' ? 'danger' : state.tone === 'warn' ? 'warn' : 'soft'}
            testID={`request-state-${r.id}`}
          >
            {state.words}
          </Text>
          {r.emailed_to ? (
            <Text variant="small" tone="soft">
              {r.emailed_by_name && r.mine !== true
                ? t('requests.emailedBy', { to: r.emailed_to, who: r.emailed_by_name })
                : t('requests.emailed', { to: r.emailed_to })}
            </Text>
          ) : null}
        </View>
      </View>
      {a ? (
        <View style={styles.actions}>
          {a.onResume ? (
            <Button
              size="small"
              kind="quiet"
              label={t('sharing.resume')}
              accessibilityLabel={t('requests.resumeFor', { what: target })}
              busy={a.resuming}
              disabled={a.disabled}
              onPress={a.onResume}
              testID={`request-resume-${r.id}`}
            />
          ) : null}
          {a.onShow ? (
            <Button
              size="small"
              kind="quiet"
              label={t('sharing.show')}
              accessibilityLabel={t('requests.showFor', { what: target })}
              busy={a.showing}
              disabled={a.disabled}
              onPress={a.onShow}
              testID={`request-show-${r.id}`}
            />
          ) : null}
          {a.onChange ? (
            <Button
              size="small"
              kind="quiet"
              label={t('requests.change')}
              accessibilityLabel={t('requests.changeFor', { what: target })}
              disabled={a.disabled}
              onPress={a.onChange}
              testID={`request-change-${r.id}`}
            />
          ) : null}
          <Button
            size="small"
            kind="quiet"
            label={t('requests.end')}
            accessibilityLabel={t('requests.endFor', { what: target })}
            disabled={a.disabled}
            onPress={a.onEnd}
            testID={`request-end-${r.id}`}
          />
        </View>
      ) : null}
    </View>
  );
}

/** A request's link shown again to whoever asked, and the password the vault made up: Send, Copy, Email; gone when closed. */
export function ShownRequest(props: {
  request: UploadRequestView;
  revealed: RevealedUploadRequest;
  origin: string;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const { t } = useTranslation();
  const [copied, setCopied] = useState<'link' | 'secret' | null>(null);
  const { revealed } = props;
  const link = revealed.link_url ?? `${props.origin}/drop#${revealed.link_token}`;
  const clipboard = nativeClipboard();
  const copy = (what: 'link' | 'secret', text: string) => {
    if (clipboard && copyForAMinute(clipboard, text)) setCopied(what);
  };
  return (
    <Sheet visible onClose={props.onClose} testID="request-shown" tall>
      <SheetScroll contentContainerStyle={styles.shown}>
        <Text variant="screen">{t('requests.shownTitle', { title: props.request.title })}</Text>
        {props.request.recipient_label ? (
          <Text variant="secondary" tone="soft">
            {t('sharing.for', { who: props.request.recipient_label })}
          </Text>
        ) : null}
        <View style={styles.linkBox}>
          <Text testID="request-shown-link">
            {link}
          </Text>
        </View>
        {revealed.password ? (
          <View style={styles.secret}>
            <Text variant="secondary" weight="600" tone="soft">
              {t('share.password')}
            </Text>
            <Text variant="title" testID="request-shown-password">
              {revealed.password}
            </Text>
            <Text variant="small" tone="soft">
              {t('requests.passwordApart')}
            </Text>
          </View>
        ) : null}
        <Button label={t('share.send')} onPress={() => void SystemShare.share({ message: link })} testID="request-shown-send" />
        {clipboard ? (
          <Button
            kind="quiet"
            label={copied === 'link' ? t('share.copied') : t('share.copyLink')}
            onPress={() => copy('link', link)}
            testID="request-shown-copy-link"
          />
        ) : null}
        {clipboard && revealed.password ? (
          <Button
            kind="quiet"
            label={copied === 'secret' ? t('share.copied') : t('share.copyPassword')}
            onPress={() => copy('secret', revealed.password as string)}
            testID="request-shown-copy-password"
          />
        ) : null}
        <EmailTheLink request={props.request} testID="request-shown-email" />
        <Text variant="small" tone="soft">
          {t('requests.onlyYou')}
        </Text>
        <Button kind="quiet" label={t('share.done')} onPress={props.onClose} testID="request-shown-done" />
      </SheetScroll>
    </Sheet>
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    row: {
      gap: sp(8),
      padding: sp(12),
      borderRadius: radii.m,
      borderWidth: 1,
      borderColor: colours.border,
      backgroundColor: colours.surface,
    },
    head: { flexDirection: 'row', gap: sp(10), alignItems: 'flex-start' },
    icon: {
      width: 32,
      height: 32,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colours.accentSoft,
    },
    words: { flex: 1, gap: 2 },
    actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: sp(8) },
    shown: { gap: sp(12) },
    linkBox: {
      padding: sp(12),
      borderRadius: radii.m,
      borderWidth: 1,
      borderColor: colours.border,
      backgroundColor: colours.surface,
    },
    secret: { gap: 2 },
  });
