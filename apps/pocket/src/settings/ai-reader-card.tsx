import {
  AI_READER_KIND_NAMES,
  ANTHROPIC_BASE_URL,
  aiReaderMonthWords,
  type AiReaderKind,
  type AiReaderRunsAt,
  type AiReaderView,
} from '@fdv/shared';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useVault } from '../state/vault';
import { Card, Text } from '../ui';
import { sp } from '../ui/space';

/** The address as its host alone ("192.168.1.30:11434", "api.anthropic.com"): never a path. */
export const hostOf = (url: string | null | undefined): string | null => /^https?:\/\/([^/?#]+)/i.exec(url ?? '')?.[1] ?? null;

/** The reader that reads the household's papers now: .env's while it wins, else the one saved in Settings. */
interface Shown {
  kind: AiReaderKind;
  model: string;
  host: string | null;
  runsAt: AiReaderRunsAt | null;
  /** Saved in Settings: whether its Test passed. Null for .env's, which has none here. */
  status: 'untested' | 'ok' | 'failed' | null;
  env: boolean;
}

function shownOf(v: AiReaderView): Shown | null {
  if (v.source === 'env' && v.env) {
    return { kind: v.env.kind, model: v.env.model, host: v.env.host, runsAt: v.env.runs_at, status: null, env: true };
  }
  if (v.source !== 'settings' || !v.reader) return null;
  const r = v.reader;
  return {
    kind: r.kind,
    model: r.model,
    // Anthropic's address is fixed, and not kept (AIR3).
    host: hostOf(r.kind === 'anthropic' ? ANTHROPIC_BASE_URL : r.base_url),
    runsAt: r.runs_at,
    status: r.status,
    env: false,
  };
}

/**
 * More → Settings → Reading (AIR4): the household's AI reader, read only —
 * which reader (its kind and model, never its key; its address only as a
 * host), where it runs, whether papers marked Sensitive are sent to it, and
 * for a cloud reader this month's count. It is changed on the web, which
 * asks to confirm it's you and warns before sensitive papers go.
 *
 * Shown where the vault sets the reader in Settings
 * (`features.ai_reader_settings`, 0.9.0-dev.36), to owners, whose it is:
 * anybody else is refused (403), and the card is not shown.
 */
export function AiReaderCard() {
  const { t } = useTranslation();
  const { caps, who, withToken } = useVault();
  const [view, setView] = useState<AiReaderView | null>(null);
  const offered = caps?.features.ai_reader_settings === true && who?.role === 'owner';

  const load = useCallback(async () => {
    if (!offered) return;
    try {
      setView(await withToken((a, tk) => a.aiReader(tk)));
    } catch {
      // Not an owner's after all (403), or no answer: nothing is shown, and nothing is said.
      setView(null);
    }
  }, [offered, withToken]);
  useEffect(() => {
    // Asked on arrival; the state is set after the vault answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (!offered || !view) return null;
  const shown = shownOf(view);
  const cloud = shown?.runsAt === 'cloud';
  // "Also send sensitive papers" and the month's count (0.9.0-dev.37, AIR3): absent from older vaults.
  const sendingSaid = caps?.features.ai_reader_send_sensitive === true && view.send_sensitive !== undefined;

  const rows: { key: string; label: string; value: string }[] = shown
    ? [
        {
          key: 'reader',
          label: t('aiReader.reader'),
          value: t('aiReader.kindModel', { kind: AI_READER_KIND_NAMES[shown.kind], model: shown.model }),
        },
        ...(shown.host ? [{ key: 'address', label: t('aiReader.address'), value: shown.host }] : []),
        {
          key: 'where',
          label: t('aiReader.where'),
          value: t(shown.runsAt === 'own_network' ? 'aiReader.ownNetwork' : cloud ? 'aiReader.cloud' : 'aiReader.whereUnknown'),
        },
        ...(shown.status
          ? [{ key: 'status', label: t('aiReader.status'), value: t(`aiReader.status_${shown.status}`) }]
          : []),
        ...(sendingSaid
          ? [
              {
                key: 'sensitive',
                label: t('aiReader.sensitive'),
                // Only a cloud reader is ever kept from them: one on your own network reads them as the rest.
                value: t(!cloud ? 'aiReader.sensitiveHome' : view.send_sensitive ? 'aiReader.sensitiveSent' : 'aiReader.sensitiveNotSent'),
              },
            ]
          : []),
        ...(cloud && view.month ? [{ key: 'month', label: t('aiReader.month'), value: aiReaderMonthWords(view.month) }] : []),
      ]
    : [];

  return (
    <Card>
      <Text variant="title">{t('aiReader.title')}</Text>
      <Text weight="600">{t('aiReader.heading')}</Text>
      {view.source === 'off' ? (
        <Text variant="secondary" tone="soft" testID="ai-reader-off">
          {t('aiReader.off')}
        </Text>
      ) : !shown ? (
        <Text variant="secondary" tone="soft" testID="ai-reader-none">
          {t('aiReader.none')}
        </Text>
      ) : (
        <View testID="ai-reader">
          {rows.map((r) => (
            <View key={r.key} style={styles.line} testID={`ai-reader-${r.key}`} accessible accessibilityLabel={`${r.label}: ${r.value}`}>
              <Text style={styles.label}>{r.label}</Text>
              <Text variant="secondary" tone="soft" style={styles.value}>
                {r.value}
              </Text>
            </View>
          ))}
          {shown.env ? (
            <Text variant="secondary" tone="soft" testID="ai-reader-env">
              {t('aiReader.env')}
            </Text>
          ) : null}
        </View>
      )}
      <Text variant="secondary" tone="muted" testID="ai-reader-on-web">
        {t('aiReader.onWeb')}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', gap: sp(8), minHeight: 44 },
  label: { flexShrink: 0 },
  value: { flex: 1, textAlign: 'right' },
});
