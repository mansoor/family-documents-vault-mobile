import { radii, shareEndWords, shareUses, type Share } from '@fdv/shared';
import { Link2Off } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { wordsFor } from '../errors/words';
import { emit, on } from '../state/events';
import { useFamilyZone } from '../state/family-time';
import { useStepUp } from '../state/step-up';
import { useVault } from '../state/vault';
import { Button, Notice, Text } from '../ui';
import { ConfirmSheet } from '../ui/confirm';
import { feel } from '../ui/feel';
import { sp } from '../ui/space';
import { useStyles, type Palette } from '../ui/theme';
import { ChangeLinkSheet } from './change-link';
import { WhoOpened } from './opens';

/** A link that still works, or could again: what the document's page lists. */
const WORKING: readonly Share['state'][] = ['active', 'used_up', 'paused'];

/**
 * A document's own links (app 0.18.0), on its page, as the web's Share a
 * link lists them above its form: each link to it that still works, newest
 * first — whom it is for, when it stops, how often it has been opened, and
 * who opened it — with Change where the vault lets the person change it
 * (0.9.0-dev.49, LK; change-link.tsx) and End this link, asked first.
 * Every link is in More → Sharing too. Shown on a vault that changes links,
 * to whoever may share it, and only when it has a link that works.
 *
 * `othersApart`: the page lists links somebody else made apart, with who
 * opened each (one's own sensitive paper, H5's "Shared outside the family"),
 * so only one's own are listed here, never the same link twice.
 */
export function DocumentLinks(props: {
  documentId: string;
  what: string;
  othersApart?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles(makeStyles);
  const { t } = useTranslation();
  const zone = useFamilyZone();
  const { withToken, offline, caps } = useVault();
  const { guarded } = useStepUp();
  const on_ = caps?.features.link_changes === true;
  const [links, setLinks] = useState<Share[]>([]);
  const [changing, setChanging] = useState<Share | null>(null);
  const [ending, setEnding] = useState<Share | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  // Which reading is current: a slower earlier answer never shows a link ended since.
  const asking = useRef(0);
  const othersApart = props.othersApart === true;

  const load = useCallback(async () => {
    if (!on_) return;
    const n = ++asking.current;
    try {
      const r = await withToken((a, tk) => a.shares(tk));
      if (n !== asking.current) return;
      setLinks(
        r.items
          .filter((s) => s.document_id === props.documentId && WORKING.includes(s.state))
          .filter((s) => !othersApart || s.mine !== false)
          .sort((x, y) => y.created_at.localeCompare(x.created_at)),
      );
    } catch {
      // Said nowhere, as the page's other extras: More → Sharing has them all.
    }
  }, [on_, withToken, props.documentId, othersApart]);
  useEffect(() => {
    // Asked on arrival and when the connection returns; set once the vault answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, offline]);
  // A link made from the ⋯'s Share, or changed or ended in Sharing.
  useEffect(() => on('sharesChanged', () => void load()), [load]);

  const end = async () => {
    const s = ending;
    if (!s || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const done = await guarded(async (a, tk) => {
        await a.revokeShare(tk, s.id);
        return true;
      });
      if (!done) return;
      feel('done');
      setEnding(null);
      setSaid(t('sharing.ended', { what: props.what }));
      // Any reading still on its way is from before: it is let go.
      asking.current += 1;
      setLinks((xs) => xs.filter((x) => x.id !== s.id));
      emit('sharesChanged');
    } catch (err) {
      setProblem(wordsFor(err, t));
    } finally {
      setBusy(false);
    }
  };

  if (!on_ || (links.length === 0 && !said)) return null;
  return (
    <View style={[styles.box, props.style]} testID="document-links">
      <Text variant="secondary" weight="700" role="header">
        {t('docLinks.title')}
      </Text>
      <Text variant="small" tone="soft">
        {t('docLinks.words')}
      </Text>
      {said ? (
        <Notice tone="ok" testID="document-links-said">
          {said}
        </Notice>
      ) : null}
      {links.map((s) => {
        const lines = [
          t(s.state === 'paused' ? 'sharing.paused' : 'sharing.ends', { end: shareEndWords(new Date(s.expires_at), zone) }),
          shareUses(s),
          s.created_by_name ? t('sharing.by', { who: s.created_by_name }) : null,
        ].filter((x): x is string => !!x);
        const whom = s.recipient_label ? t('sharing.for', { who: s.recipient_label }) : t('docLinks.aLink');
        return (
          <View key={s.id} style={styles.link} testID={`document-link-${s.id}`}>
            <Text weight="600">{whom}</Text>
            {lines.map((l) => (
              <Text key={l} variant="small" tone="soft">
                {l}
              </Text>
            ))}
            <WhoOpened link={s} testID={`document-link-opens-${s.id}`} />
            <View style={styles.actions}>
              {s.changeable === true ? (
                <Button
                  size="small"
                  kind="quiet"
                  label={t('changeLink.button')}
                  accessibilityLabel={t('docLinks.changeFor', { whom })}
                  disabled={offline}
                  onPress={() => {
                    setSaid(null);
                    setChanging(s);
                  }}
                  testID={`document-link-change-${s.id}`}
                />
              ) : null}
              <Button
                size="small"
                kind="quiet"
                label={t('sharing.end')}
                accessibilityLabel={t('docLinks.endFor', { whom })}
                disabled={offline}
                onPress={() => {
                  setProblem(null);
                  setSaid(null);
                  setEnding(s);
                }}
                testID={`document-link-end-${s.id}`}
              />
            </View>
          </View>
        );
      })}
      {changing ? (
        <ChangeLinkSheet
          link={changing}
          what={props.what}
          onClose={() => {
            setChanging(null);
            // Read again, so Change opened again starts from the link as the vault has it now.
            void load();
          }}
          onDone={(words) => {
            setChanging(null);
            setSaid(words);
            void load();
          }}
        />
      ) : null}
      <ConfirmSheet
        visible={ending !== null}
        testID="document-link-end-question"
        icon={Link2Off}
        title={t('sharing.endTitle')}
        words={t('sharing.endWords', { what: props.what })}
        confirmLabel={t('sharing.endYes')}
        busy={busy}
        problem={problem}
        onConfirm={() => void end()}
        onCancel={() => setEnding(null)}
        confirmID="document-link-end-yes"
        cancelID="document-link-end-cancel"
        problemID="document-link-end-problem"
      />
    </View>
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    box: { gap: sp(8), padding: sp(12), borderRadius: radii.m },
    link: {
      gap: 2,
      paddingTop: sp(8),
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colours.border,
    },
    actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: sp(8), marginTop: sp(4) },
  });
