import { EMERGENCY_FIELD_LABELS, EMERGENCY_NOT_ADVICE, emergencyFieldsFor, radii, WALLET_CARD_DEFAULT, type EmergencyFieldKey, type EmergencyView } from '@fdv/shared';
import { Check } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { saveCopy } from '../documents/save-copy';
import { log } from '../log';
import { useLock } from '../state/lock';
import { Button, Notice, Text } from '../ui';
import { feel } from '../ui/feel';
import { Sheet } from '../ui/sheet';
import { sp } from '../ui/space';
import { useColours, useStyles, type Palette } from '../ui/theme';
import { sections, shareable, tick, type Section } from './rules';
import { buildWalletCard, lettersNotOnTheCard } from './wallet-pdf';

/** What the card shows: the parts ticked, in the page's order, as the page shows them. */
export function cardSections(view: Pick<EmergencyView, 'fields' | 'date_of_birth'>, ticked: readonly EmergencyFieldKey[], t: Parameters<typeof sections>[1]): Section[] {
  return sections(
    {
      fields: emergencyFieldsFor(view.fields, ticked),
      date_of_birth: ticked.includes('date_of_birth') ? view.date_of_birth : null,
    },
    t,
  );
}

/**
 * The wallet card (app 0.19.0; the vault's H4), as the web's "Print a
 * wallet card": tick what goes on it — what a stranger needs first, ticked
 * to begin with — see it, and Share or print: a PDF made here, the size of
 * a bank card on an A4 page, handed to the phone's own share sheet (a
 * printer, Files, another app) and then gone from the phone. It needs
 * nothing but the paper: no link, and no code to scan. Nothing is asked of
 * the vault, so it is made with no connection too.
 *
 * The choice is made each time, not kept (as on the web).
 */
export function WalletSheet(props: { view: EmergencyView; name: string; onClose: () => void }) {
  const styles = useStyles(makeStyles);
  const colours = useColours();
  const { t } = useTranslation();
  const lock = useLock();
  const filled = shareable(props.view);
  const [ticked, setTicked] = useState<EmergencyFieldKey[]>(() => filled.filter((k) => WALLET_CARD_DEFAULT.includes(k)));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const rows = useMemo(() => cardSections(props.view, ticked, t), [props.view, ticked, t]);

  // Letters the printed card can't draw are said before it is made (they print as "?").
  useEffect(() => {
    let live = true;
    void lettersNotOnTheCard([props.name, ...rows.flatMap((r) => [r.label, ...r.lines])]).then(
      (m) => {
        if (live) setMissing(m);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [props.name, rows]);

  const make = async () => {
    if (busy || rows.length === 0) return;
    setBusy(true);
    setProblem(null);
    try {
      const bytes = await buildWalletCard({
        heading: t('emergency.title'),
        name: props.name,
        continued: t('walletCard.continued'),
        rows: rows.map((r) => ({ label: r.label, lines: r.lines })),
        foot: EMERGENCY_NOT_ADVICE,
      });
      await saveCopy(bytes, t('walletCard.fileName'), 'application/pdf', { away: lock.away });
      feel('done');
    } catch (err) {
      log.error('wallet_card.failed', { kind: err instanceof Error ? err.name : typeof err });
      setProblem(t('walletCard.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible onClose={() => (busy ? undefined : props.onClose())} testID="wallet-sheet" tall>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
        <Text variant="screen">{t('walletCard.title')}</Text>
        <Text variant="secondary" tone="soft">
          {t('walletCard.words')}
        </Text>

        <View style={styles.section} testID="wallet-parts">
          <Text variant="secondary" weight="600" tone="soft">
            {t('walletCard.onTheCard')}
          </Text>
          {filled.map((k) => {
            const on = ticked.includes(k);
            return (
              <Pressable
                key={k}
                testID={`wallet-part-${k}`}
                accessibilityRole="checkbox"
                accessibilityLabel={EMERGENCY_FIELD_LABELS[k]}
                accessibilityState={{ checked: on }}
                onPress={() => setTicked((now) => tick(now, k, !on))}
                style={({ pressed }) => [styles.item, pressed ? styles.pressed : null]}
              >
                <View style={[styles.box, on ? styles.boxOn : null]}>
                  {on ? <Check color={colours.accent} size={16} accessibilityElementsHidden importantForAccessibility="no" /> : null}
                </View>
                <Text style={styles.flex}>{EMERGENCY_FIELD_LABELS[k]}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* The card as it will print: dark on light whatever the app's theme, as on paper. */}
        <View
          style={styles.card}
          testID="wallet-preview"
          accessible
          accessibilityLabel={t('walletCard.previewLabel', { name: props.name })}
        >
          <Text variant="small" style={styles.paperInk}>
            <Text variant="small" weight="700" style={styles.paperInk}>
              {t('emergency.title')}
            </Text>
            {` — ${props.name}`}
          </Text>
          {rows.length === 0 ? (
            <Text variant="small" style={styles.paperMuted} testID="wallet-preview-empty">
              {t('walletCard.nothingTicked')}
            </Text>
          ) : (
            rows.map((r) => (
              <View key={r.key} style={styles.row} testID={`wallet-preview-${r.key}`}>
                <Text variant="small" weight="700" style={[styles.label, styles.paperInk]}>
                  {r.label}
                </Text>
                <View style={styles.flex}>
                  {r.lines.map((line, i) => (
                    <Text key={i} variant="small" style={styles.paperInk}>
                      {line}
                    </Text>
                  ))}
                </View>
              </View>
            ))
          )}
          <Text variant="small" style={styles.paperMuted}>
            {EMERGENCY_NOT_ADVICE}
          </Text>
        </View>

        {missing.length > 0 ? (
          <Notice tone="warn" testID="wallet-letters">
            {t('walletCard.letters', { letters: missing.join(' ') })}
          </Notice>
        ) : null}
        <Text variant="small" tone="soft">
          {t('walletCard.leaves')}
        </Text>
        {problem ? (
          <Notice tone="warn" testID="wallet-problem">
            {problem}
          </Notice>
        ) : null}
        <Button
          label={t('walletCard.share')}
          busy={busy}
          disabled={rows.length === 0}
          onPress={() => void make()}
          testID="wallet-share"
        />
        <Button kind="quiet" label={t('walletCard.close')} disabled={busy} onPress={props.onClose} testID="wallet-close" />
      </ScrollView>
    </Sheet>
  );
}

/** Paper's own colours, the same in the dark theme: the card is printed. */
const PAPER = { bg: '#ffffff', ink: '#1a1a1f', muted: '#5f5f6b', edge: '#8c8c99' };

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    scroll: { flexGrow: 0, flexShrink: 1 },
    body: { gap: sp(12) },
    section: { gap: sp(6) },
    flex: { flex: 1 },
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
    card: {
      alignSelf: 'center',
      width: '100%',
      maxWidth: 360,
      minHeight: 200,
      padding: sp(12),
      gap: sp(4),
      borderRadius: radii.m,
      borderWidth: 1,
      borderColor: PAPER.edge,
      backgroundColor: PAPER.bg,
    },
    row: { flexDirection: 'row', gap: sp(8) },
    label: { width: 92 },
    paperInk: { color: PAPER.ink },
    paperMuted: { color: PAPER.muted, marginTop: sp(4) },
  });
