import { ApiRequestError } from '@fdv/client';
import {
  colours,
  formatDate,
  issuedByLabel,
  radii,
  RENEWAL_UNDO_MINUTES,
  renewalOffers,
  type DateValue,
  type DetailProposal,
  type DocumentTypeView,
  type DocumentView,
  type RenewalField,
  type RenewalInput,
  type RenewalOffer,
} from '@fdv/shared';
import { Check } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { wordsFor } from '../errors/words';
import { readPrefs, writePrefs } from '../platform/prefs';
import { useVault } from '../state/vault';
import { Button, Card, Notice, Text } from '../ui';
import { sp } from '../ui/space';

/**
 * What a document's newest version's pages say (P2; the owner's decision of
 * 7 Nov 2026: the vault reads a scan, never the phone, and each version
 * keeps its own details). A new version starts with the details of the one
 * before, unconfirmed; the vault reads its pages, and this card shows what
 * they say otherwise ("Expires 1 Mar 2033, was 1 Mar 2025") for the person
 * to tick and use, as the web's card does (apps/web/src/renewal.tsx).
 * Nothing changes until they do. Undo takes it back for RENEWAL_UNDO_MINUTES.
 *
 * Only from a vault that keeps each version's details (`version_details`),
 * only to somebody who may change the document, and only while its newest
 * version's details are unconfirmed. Not now puts it away for this person
 * and this version.
 */

/** While the vault is still reading the new version: asked again this often, this many times. */
const PENDING_EVERY_MS = 5_000;
const PENDING_TRIES = 12;

/** Where Not now is kept: by vault, person and version, the last few only. */
const NOT_NOW = 'new-version-not-now';
const NOT_NOW_KEPT = 50;

function saidNotNow(key: string | null): boolean {
  return key !== null && readPrefs<string[]>(NOT_NOW, []).includes(key);
}

function putAway(key: string): void {
  try {
    const list = readPrefs<string[]>(NOT_NOW, []).filter((k) => k !== key);
    writePrefs(NOT_NOW, [...list, key].slice(-NOT_NOW_KEPT));
  } catch {
    // Kept for this visit only, then.
  }
}

interface Read {
  versionId: string;
  renewal: DetailProposal | undefined;
}

export function NewVersionSays(props: {
  doc: DocumentView;
  type: DocumentTypeView | undefined;
  mayChange: boolean;
  /** The document as the vault has it now: after Use these, or Undo. */
  onSaved: (doc: DocumentView) => void;
  /** Changed somewhere else: the page loads it again. */
  onStale: () => Promise<void>;
}) {
  const { doc, type } = props;
  const { t } = useTranslation();
  const { withToken, caps, offline, who } = useVault();
  const versionId = doc.latest_version_id;
  const key = who && versionId ? `${who.origin}|${who.member_id}|${versionId}` : null;
  const [away, setAway] = useState<string | null>(null);
  const asks =
    caps?.features.version_details === true &&
    props.mayChange &&
    doc.details_unconfirmed === true &&
    !!versionId &&
    away !== key &&
    !saidNotNow(key);
  const [read, setRead] = useState<Read | null>(null);
  const [reading, setReading] = useState(false);
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ text: string; undo: string | null; busy: boolean } | null>(null);

  useEffect(() => {
    if (!asks || offline) return;
    let stopped = false;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = async () => {
      try {
        const r = await withToken((a, token) => a.detailSuggestions(token, doc.id));
        if (stopped) return;
        if (r.state === 'ready' && r.version_id) {
          setReading(false);
          setRead({ versionId: r.version_id, renewal: r.renewal });
          return;
        }
        if (r.state === 'pending' && tries < PENDING_TRIES) {
          tries += 1;
          setReading(true);
          timer = setTimeout(() => void ask(), PENDING_EVERY_MS);
          return;
        }
        setReading(false);
      } catch {
        // An offer, not a need: the page works without it.
        if (!stopped) setReading(false);
      }
    };
    void ask();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [asks, offline, withToken, doc.id, doc.etag, versionId]);

  const label = (field: RenewalField): string => {
    if (field === 'issued_by') return type?.issued_by_label?.trim() ? issuedByLabel(type) : t('document.issuedBy');
    const own = type?.core?.[field]?.label?.trim();
    return own || t(`renewal.${field}`);
  };
  const words = (field: RenewalField, value: DateValue | string) =>
    field === 'issued' || field === 'expires' ? formatDate(value as DateValue) : (value as string);

  // Only the newest version's pages, only while its details are the version before's.
  const offers: RenewalOffer[] =
    asks && read && read.versionId === versionId ? renewalOffers(doc, read.renewal) : [];
  const tickKey = (o: RenewalOffer) => `${read?.versionId}:${o.field}`;
  const ticked = (o: RenewalOffer) => ticks[tickKey(o)] ?? !o.weak;
  const chosen = offers.filter(ticked);

  const use = async () => {
    if (!read || chosen.length === 0 || busy) return;
    const body: RenewalInput = { version_id: read.versionId };
    for (const o of chosen) Object.assign(body, { [o.field]: o.value });
    setBusy(true);
    setError(null);
    try {
      const result = await withToken((a, token) => a.applyRenewal(token, doc.id, body, doc.etag));
      setDone({
        text: t('renewal.saved', { count: RENEWAL_UNDO_MINUTES }),
        undo: result.undo_until ? read.versionId : null,
        busy: false,
      });
      props.onSaved(result.document);
    } catch (err) {
      if (err instanceof ApiRequestError && (err.code === 'conflict' || err.code === 'version_changed')) {
        setError(t('renewal.changed'));
        await props.onStale();
      } else {
        setError(wordsFor(err, t));
      }
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    if (!done?.undo || done.busy) return;
    const undoing = done.undo;
    setDone({ ...done, busy: true });
    try {
      const back = await withToken((a, token) => a.undoRenewal(token, doc.id, undoing));
      setDone({ text: t('renewal.undone'), undo: null, busy: false });
      props.onSaved(back);
    } catch (err) {
      const kept =
        err instanceof ApiRequestError && (err.code === 'renewal_kept' || err.code === 'renewal_not_undoable');
      setDone({ text: wordsFor(err, t), undo: kept ? null : undoing, busy: false });
      if (kept) await props.onStale();
    }
  };

  return (
    <>
      {done ? (
        <Notice tone="ok" testID="renewal-done" announce={done.text}>
          <Text>{done.text}</Text>
          {done.undo ? (
            <Button
              testID="renewal-undo"
              kind="quiet"
              label={t('renewal.undo')}
              busy={done.busy}
              onPress={() => void undo()}
            />
          ) : null}
        </Notice>
      ) : null}
      {error && offers.length === 0 ? (
        <Notice tone="warn" testID="renewal-error">
          {error}
        </Notice>
      ) : null}
      {asks && reading && offers.length === 0 ? (
        <Text tone="soft" variant="secondary" testID="renewal-reading">
          {t('renewal.reading')}
        </Text>
      ) : null}
      {offers.length > 0 ? (
        <Card style={styles.card}>
          <View testID="renewal-card" style={styles.inside}>
            <Text variant="screen">{t('renewal.says')}</Text>
            <Text tone="soft">{t('renewal.lead')}</Text>
            {offers.map((o) => (
              <Tick
                key={o.field}
                testID={`renewal-${o.field}`}
                checked={ticked(o)}
                disabled={busy}
                onPress={() => setTicks((all) => ({ ...all, [tickKey(o)]: !ticked(o) }))}
                label={label(o.field)}
                value={words(o.field, o.value)}
                was={t('renewal.was', { was: words(o.field, o.was) })}
                weak={o.weak ? t('renewal.checkThis') : null}
              />
            ))}
            {error ? (
              <Notice tone="warn" testID="renewal-error">
                {error}
              </Notice>
            ) : null}
            <Button
              testID="renewal-use"
              label={t('renewal.use')}
              busy={busy}
              disabled={chosen.length === 0}
              onPress={() => void use()}
            />
            <Button
              testID="renewal-not-now"
              kind="quiet"
              label={t('renewal.notNow')}
              disabled={busy}
              onPress={() => {
                if (key) {
                  setAway(key);
                  putAway(key);
                }
              }}
            />
          </View>
        </Card>
      ) : null}
    </>
  );
}

/** One field the new version says otherwise: ticked to be used. Read out as a checkbox. */
function Tick(props: {
  testID: string;
  checked: boolean;
  disabled: boolean;
  onPress: () => void;
  label: string;
  value: string;
  was: string;
  weak: string | null;
}) {
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: props.checked, disabled: props.disabled }}
      accessibilityLabel={[`${props.label} ${props.value}`, props.was, props.weak].filter(Boolean).join(', ')}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [styles.tick, pressed ? styles.pressed : null]}
    >
      <View style={[styles.box, props.checked ? styles.boxOn : null]}>
        {props.checked ? (
          <Check color={colours.onAccent} size={18} accessibilityElementsHidden importantForAccessibility="no" />
        ) : null}
      </View>
      <View style={styles.words}>
        <Text>
          <Text weight="600">{props.label}</Text> {props.value}
        </Text>
        <Text tone="soft" variant="secondary">
          {props.was}
        </Text>
        {props.weak ? (
          <View style={styles.weak}>
            <Text variant="small" weight="700" tone="warn">
              {props.weak}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderColor: colours.accent },
  inside: { gap: sp(12) },
  tick: { flexDirection: 'row', alignItems: 'flex-start', gap: sp(12), minHeight: 44, paddingVertical: sp(4) },
  pressed: { opacity: 0.8 },
  box: {
    width: 26,
    height: 26,
    marginTop: 1,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colours.borderInput,
    backgroundColor: colours.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { backgroundColor: colours.accent, borderColor: colours.accent },
  words: { flex: 1, gap: sp(4) },
  weak: {
    alignSelf: 'flex-start',
    backgroundColor: colours.warnSoft,
    borderRadius: radii.pill,
    paddingHorizontal: sp(8),
    paddingVertical: 1,
  },
});
