import { ApiRequestError, NetworkError } from '@fdv/client';
import { colours, radii, type IdentityPart, type IdentityView } from '@fdv/shared';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { wordsFor } from '../errors/words';
import { useLock, useScreenGuard } from '../state/lock';
import { useStepUp } from '../state/step-up';
import { useVault } from '../state/vault';
import { Button, Card, Notice, Text } from '../ui';
import { copyForAMinute, nativeClipboard, type ClipboardPort } from './clipboard';
import { identitySections, seenByWords, type IdentityRow } from './rows';

/** Somebody with neither two-step sign-in nor a passkey, asking for another person's numbers (5.26). */
const TWO_STEP: ReadonlySet<string> = new Set(['two_step_required', 'totp_required_for_owner']);

/**
 * The Identity card on a person's screen (5.31), when the vault keeps
 * identity details (`features.member_identity`): their details in
 * sections, every number masked until Show, which asks who is holding the
 * phone — another person's numbers with a code from an authenticator app,
 * never the password (the step-up sheet says so). Copy asks the same, and
 * the copy is marked sensitive and cleared after a minute.
 *
 * Nothing of it is kept: the record and what was shown live in this
 * card's memory while it is on the screen, never in a store, a cache or
 * the log, so with no connection there is no card (A36). Screenshots are
 * refused while it shows. Read only: the details are changed on the web.
 * Somebody not given the record (404) sees no card, as there is none.
 */
export function IdentityCard(props: { memberId: string; name: string; clipboard?: ClipboardPort | null }) {
  const { t } = useTranslation();
  const { caps, withToken, offline, who } = useVault();
  const offered = caps?.features.member_identity === true;
  const [view, setView] = useState<IdentityView | null>(null);
  const [state, setState] = useState<'loading' | 'none' | 'offline' | 'failed' | 'ready'>('loading');
  const [failure, setFailure] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!offered) return;
    try {
      const v = await withToken((a, token) => a.identity(token, props.memberId));
      setView(v);
      setState('ready');
    } catch (err) {
      // Not given it: no card, as there is no record for them.
      if (err instanceof ApiRequestError && err.status === 404) {
        setView(null);
        setState('none');
      } else if (err instanceof NetworkError) {
        // Never kept on the phone: with no connection there is nothing to show.
        setView(null);
        setState('offline');
      } else {
        setView(null);
        setFailure(wordsFor(err, t));
        setState('failed');
      }
    }
  }, [offered, withToken, props.memberId, t]);

  useEffect(() => {
    // Asked on arrival, and again when the connection returns; set once it answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, offline]);

  if (!offered || state === 'none' || state === 'loading') return null;
  if (state === 'ready' && view) {
    return (
      <Shown
        view={view}
        memberId={props.memberId}
        name={props.name}
        self={who?.member_id === props.memberId}
        clipboard={props.clipboard === undefined ? nativeClipboard() : props.clipboard}
        reload={load}
      />
    );
  }
  return (
    <Card style={styles.card}>
      <Text variant="screen">{t('identity.title')}</Text>
      <Notice tone="warn" testID="identity-unavailable">
        {state === 'offline' ? t('identity.needsConnection') : (failure ?? t('identity.failed'))}
      </Notice>
    </Card>
  );
}

/** The card with the record in it: never captured while it is on the screen. */
function Shown(props: {
  view: IdentityView;
  memberId: string;
  name: string;
  self: boolean;
  clipboard: ClipboardPort | null;
  reload: () => Promise<void>;
}) {
  useScreenGuard('identity');
  const { t } = useTranslation();
  const { guarded } = useStepUp();
  const { status } = useLock();
  const { view, self, clipboard } = props;
  // What a reveal showed, by part and key: in this card's memory, and only while it is shown.
  const [shown, setShown] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [twoStep, setTwoStep] = useState<string | null>(null);

  // Locked (away too long, or handed over after Show mode): every number is hidden again.
  const locked = status === 'locked';
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (locked) setShown({});
  }, [locked]);

  /** The masked values asked for, once whoever holds the phone has said who they are; null if not. */
  const reveal = async (part: IdentityPart, keys: string[]): Promise<Record<string, string> | null> => {
    setProblem(null);
    setTwoStep(null);
    setSaid(null);
    try {
      const got = await guarded((a, token) =>
        a.revealIdentity(token, props.memberId, part === 'only_me' ? { part, keys } : { keys }),
      );
      return got?.values ?? null;
    } catch (err) {
      if (err instanceof ApiRequestError && TWO_STEP.has(err.code)) setTwoStep(wordsFor(err, t));
      else setProblem(wordsFor(err, t, 'identity.failed'));
      return null;
    }
  };

  /** A value cleared elsewhere since the card was read: said, and the card read again. */
  const gone = async (label: string) => {
    setProblem(t('identity.gone', { label }));
    await props.reload();
  };

  const show = async (r: IdentityRow) => {
    if (busy) return;
    setBusy(`${r.part}:${r.key}`);
    try {
      const got = await reveal(r.part, [r.key]);
      if (!got) return;
      const value = got[r.key];
      if (value === undefined) await gone(r.secretLabel ?? '');
      else setShown((s) => ({ ...s, [`${r.part}:${r.key}`]: value }));
    } finally {
      setBusy(null);
    }
  };

  const hide = (r: IdentityRow) =>
    setShown((s) => {
      const next = { ...s };
      delete next[`${r.part}:${r.key}`];
      return next;
    });

  const copy = async (r: IdentityRow) => {
    if (busy || !clipboard) return;
    setBusy(`${r.part}:${r.key}`);
    try {
      // Copying shows it as surely as Show does: asked, and logged by the vault, the same.
      const got = await reveal(r.part, [r.key]);
      if (!got) return;
      const value = got[r.key];
      if (value === undefined) await gone(r.secretLabel ?? '');
      else if (copyForAMinute(clipboard, value)) setSaid(t('identity.copied', { label: capitalised(r.secretLabel ?? '') }));
      else setProblem(t('identity.copyFailed'));
    } finally {
      setBusy(null);
    }
  };

  const sections = identitySections(view, self, t);
  const empty = sections.length === 0;

  const secret = (r: IdentityRow) => {
    const at = `${r.part}:${r.key}`;
    const value = shown[at];
    const label = r.secretLabel ?? '';
    return (
      <View style={styles.secret}>
        {value !== undefined ? (
          <Text weight="600" testID={`identity-value-${r.key}`}>
            {value}
          </Text>
        ) : (
          <View accessible accessibilityLabel={t('identity.hiddenLabel', { label })} testID={`identity-masked-${r.key}`}>
            <Text>••••••••</Text>
          </View>
        )}
        <View style={styles.actions}>
          <Button
            kind="quiet"
            label={value !== undefined ? t('identity.hide') : t('identity.show')}
            accessibilityLabel={t(value !== undefined ? 'identity.hideLabel' : 'identity.showLabel', { label })}
            disabled={value === undefined && busy !== null}
            onPress={() => (value !== undefined ? hide(r) : void show(r))}
            testID={`identity-show-${r.key}`}
          />
          {clipboard ? (
            <Button
              kind="quiet"
              label={t('identity.copy')}
              accessibilityLabel={t('identity.copyLabel', { label })}
              disabled={busy !== null}
              onPress={() => void copy(r)}
              testID={`identity-copy-${r.key}`}
            />
          ) : null}
        </View>
      </View>
    );
  };

  return (
    <Card style={styles.card}>
      <View testID="identity-card" style={styles.stack}>
        <Text variant="screen">{t('identity.title')}</Text>
        <Text tone="soft" variant="secondary">
          {seenByWords(view.audience, self, t)}
          {self && view.only_me ? ` ${t('identity.onlyMeYours')}` : ''}
        </Text>
        {empty ? (
          <Text tone="soft">{self ? t('identity.empty') : t('identity.emptyOther', { name: props.name })}</Text>
        ) : (
          sections.map((s) => (
            <View key={s.key} style={styles.stack}>
              <Text weight="700" role="header">
                {s.title}
              </Text>
              {s.rows.map((r) => (
                <View key={`${r.part}:${r.key}`} style={styles.row} testID={`identity-row-${r.part}-${r.key}`}>
                  <View style={styles.labelRow}>
                    <Text variant="secondary" tone="soft" weight="600">
                      {r.label}
                    </Text>
                    {r.part === 'only_me' ? (
                      <Text variant="small" weight="700" style={styles.badge} testID={`identity-only-me-${r.key}`}>
                        {t('identity.onlyMe')}
                      </Text>
                    ) : null}
                  </View>
                  {r.value === null ? secret(r) : <Text>{r.value}</Text>}
                  {r.more.map((m) => (
                    <Text key={m} variant="secondary" tone="muted">
                      {m}
                    </Text>
                  ))}
                </View>
              ))}
            </View>
          ))
        )}
        {twoStep ? (
          <Notice tone="warn" testID="identity-two-step">
            <Text>{twoStep}</Text>
            <Text tone="soft" variant="secondary">
              {t('identity.twoStepHint')}
            </Text>
          </Notice>
        ) : null}
        {problem ? (
          <Notice tone="danger" testID="identity-problem">
            {problem}
          </Notice>
        ) : null}
        {said ? (
          <Notice tone="ok" testID="identity-said">
            {said}
          </Notice>
        ) : null}
        <Text variant="secondary" tone="muted">
          {t('identity.readOnly')}
        </Text>
      </View>
    </Card>
  );
}

const capitalised = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const styles = StyleSheet.create({
  card: { marginTop: 4 },
  stack: { gap: 8 },
  row: { gap: 2 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  badge: {
    color: colours.accent,
    backgroundColor: colours.accentSoft,
    borderRadius: radii.s,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  secret: { gap: 2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
});
