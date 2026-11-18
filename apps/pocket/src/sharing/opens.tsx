import {
  openingWords,
  radii,
  type Capabilities,
  type DocumentLinkOpening,
  type ShareOpening,
} from '@fdv/shared';
import { ChevronDown, ChevronRight } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { wordsFor } from '../errors/words';
import { endWords, exactWords, useFamilyZone } from '../state/family-time';
import { useVault } from '../state/vault';
import { Text } from '../ui';
import { sp } from '../ui/space';
import { useColours, useStyles, type Palette } from '../ui/theme';

/**
 * Who opened a link, when (the vault's 0.9.0-dev.51, H5; app 0.17.0): each
 * time it was opened and the browser it was opened in, as the vault says
 * it — never an address. Its maker sees it, and so do the owners; the
 * vault refuses anybody else, and then nothing is offered.
 */
export function opensOffered(
  caps: Capabilities | null | undefined,
  role: string | null | undefined,
  link: { open_count: number; mine?: boolean },
): boolean {
  if (caps?.features.share_opens !== true || link.open_count === 0) return false;
  return link.mine === true || role === 'owner';
}

/** The openings, newest first, in words; or that it hasn't been opened. */
export function OpeningsList(props: { opens: readonly ShareOpening[]; testID: string }) {
  const { t } = useTranslation();
  const zone = useFamilyZone();
  if (props.opens.length === 0) {
    return (
      <Text variant="small" tone="soft" testID={`${props.testID}-none`}>
        {t('opens.notYet')}
      </Text>
    );
  }
  return (
    <View testID={props.testID} accessibilityLabel={t('opens.listLabel')}>
      {props.opens.map((o, i) => (
        <Text key={`${o.at}-${i}`} variant="small" tone="soft" testID={`${props.testID}-${i}`}>
          {openingWords(o, exactWords(o.at, zone))}
        </Text>
      ))}
    </View>
  );
}

/**
 * "Who opened it (3)": a disclosure, closed at first, that opens and closes
 * what is under it. `who` is whom the link is for, for a screen reader.
 */
export function OpensToggle(props: {
  count: number;
  open: boolean;
  who: string | null;
  busy?: boolean;
  onToggle: () => void;
  testID: string;
}) {
  const styles = useStyles(makeStyles);
  const colours = useColours();
  const { t } = useTranslation();
  const label = props.open
    ? props.who
      ? t('opens.hideFor', { who: props.who })
      : t('opens.hideForIt')
    : props.who
      ? t('opens.showFor', { who: props.who, count: props.count })
      : t('opens.showForIt', { count: props.count });
  const Chevron = props.open ? ChevronDown : ChevronRight;
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ expanded: props.open, busy: props.busy === true, disabled: props.busy === true }}
      disabled={props.busy === true}
      hitSlop={6}
      onPress={props.onToggle}
      style={({ pressed }) => [styles.toggle, pressed ? styles.pressed : null]}
    >
      <Text variant="secondary" weight="700" tone="accent" role="text">
        {props.open ? t('opens.hide') : t('opens.show', { count: props.count })}
      </Text>
      <Chevron color={colours.accent} size={16} accessibilityElementsHidden importantForAccessibility="no" />
    </Pressable>
  );
}

/**
 * Under a link in Sharing: "Who opened it (N)" once it has been opened, its
 * openings asked for only when opened, and asked again each time.
 */
export function WhoOpened(props: {
  link: { id: string; open_count: number; recipient_label: string | null; mine?: boolean };
  testID: string;
}) {
  const { t } = useTranslation();
  const { withToken, caps, who, offline } = useVault();
  const [opens, setOpens] = useState<ShareOpening[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!opensOffered(caps, who?.role, props.link)) return null;

  const toggle = async () => {
    if (opens) {
      setOpens(null);
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const got = await withToken((a, tk) => a.shareOpens(tk, props.link.id));
      setOpens(got.items);
    } catch (err) {
      setProblem(wordsFor(err, t));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View>
      <OpensToggle
        count={props.link.open_count}
        open={opens !== null}
        who={props.link.recipient_label}
        busy={busy || (offline && opens === null)}
        onToggle={() => void toggle()}
        testID={props.testID}
      />
      {problem ? (
        <Text variant="small" tone="danger" role="alert" testID={`${props.testID}-problem`}>
          {problem}
        </Text>
      ) : null}
      {opens ? <OpeningsList opens={opens} testID={`${props.testID}-list`} /> : null}
    </View>
  );
}

/**
 * On a sensitive document's page, for the person it belongs to (H5): every
 * link to it that somebody else made, and who opened each, when. Their
 * health papers went outside the family; who opened them is theirs to
 * know. Their own links are in Sharing, and left out here.
 */
export function TheirLinksOpened(props: { documentId: string; style?: StyleProp<ViewStyle> }) {
  const styles = useStyles(makeStyles);
  const { t } = useTranslation();
  const zone = useFamilyZone();
  const { withToken, caps, offline } = useVault();
  const on = caps?.features.share_opens === true;
  const [links, setLinks] = useState<DocumentLinkOpening[]>([]);
  const load = useCallback(async () => {
    if (!on) return;
    try {
      const r = await withToken((a, tk) => a.documentLinkOpens(tk, props.documentId));
      setLinks(r.items.filter((l) => !l.mine));
    } catch {
      // Said nowhere, as on the web: the page stands without it.
      setLinks([]);
    }
  }, [on, withToken, props.documentId]);
  useEffect(() => {
    // Asked on arrival and when the connection returns; set once the vault answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, offline]);
  if (links.length === 0) return null;
  return (
    <View style={[styles.their, props.style]} testID="document-their-links">
      <Text variant="secondary" weight="700" role="header">
        {t('opens.theirTitle')}
      </Text>
      <Text variant="small" tone="soft">
        {t('opens.theirWords')}
      </Text>
      {links.map((l) => {
        const state =
          l.state === 'active'
            ? t('opens.worksUntil', { end: endWords(new Date(l.expires_at), zone) })
            : l.state === 'revoked'
              ? t('opens.takenBack')
              : t('opens.noLongerWorks');
        const by = l.created_by_name ?? t('opens.someoneWhoLeft');
        return (
          <View key={l.share_id} style={styles.theirLink} testID={`document-their-link-${l.share_id}`}>
            <Text weight="600">{l.recipient_label ?? t('opens.aLink')}</Text>
            <Text variant="small" tone="soft">
              {`${t('opens.madeBy', { who: by })} · ${state}`}
            </Text>
            <OpeningsList opens={l.opens} testID={`document-their-link-${l.share_id}-opens`} />
          </View>
        );
      })}
    </View>
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    toggle: { flexDirection: 'row', alignItems: 'center', gap: sp(4), minHeight: 32, alignSelf: 'flex-start' },
    pressed: { opacity: 0.8 },
    their: { gap: sp(8), padding: sp(12), borderRadius: radii.m },
    theirLink: {
      gap: 2,
      paddingTop: sp(8),
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colours.border,
    },
  });
