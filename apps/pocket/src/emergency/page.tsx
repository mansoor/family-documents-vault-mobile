import { ApiRequestError } from '@fdv/client';
import {
  EMERGENCY_DOCUMENT_KINDS,
  EMERGENCY_DOCUMENT_LABELS,
  EMERGENCY_NOT_ADVICE,
  radii,
  type EmergencyLink,
  type EmergencyView,
} from '@fdv/shared';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { HeartPulse, Link2Off } from 'lucide-react-native';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { wordsFor } from '../errors/words';
import { endWords, exactWords, useFamilyZone } from '../state/family-time';
import { useScreenGuard } from '../state/lock';
import { useVault } from '../state/vault';
import { Button, Notice, Text } from '../ui';
import { ConfirmSheet } from '../ui/confirm';
import { feel } from '../ui/feel';
import { sp } from '../ui/space';
import { LoadFailed, loadFailure, Placeholder } from '../ui/states';
import { useColours, useStyles, type Palette } from '../ui/theme';
import { ClinicianSheet } from './clinician';
import { audienceWords, browserWords, sections, shareable, showsWords } from './rules';

type State =
  | { kind: 'loading' }
  | { kind: 'none' }
  | { kind: 'offline' }
  | { kind: 'failed'; words: string }
  /** `linksFailed`: the clinician's links could not be read (said in their place, with Try again). */
  | { kind: 'ready'; view: EmergencyView; links: EmergencyLink[]; linksFailed: string | null };

/**
 * One person's emergency information (app 0.15.0; the vault's 0.9.0-dev.47,
 * H4): what was typed — date of birth, blood type, allergies, medications,
 * conditions, insurance, doctors, who to call and anything else — then their
 * advance directive, healthcare proxy and insurance card as documents that
 * open, who can see it, and that it is not medical advice.
 *
 * Read only on the phone: Change it on the web opens the person's page in
 * the browser. Whoever chooses who sees it (the person, or an owner for a
 * child) can Share with a clinician: a link to look at the parts ticked,
 * for hours. The person and the owners see each link, when it was opened
 * and from what browser, and Take back each, asked first.
 *
 * Never kept on the phone: the page lives in this screen's memory while it
 * is shown, and screenshots are refused (as identity details). With no
 * connection there is nothing to show. Somebody the vault does not show it
 * to (404) is told there is none for them: never whether one exists.
 */
export function EmergencyPage(props: { id: string; name?: string }) {
  useScreenGuard('emergency');
  const styles = useStyles(makeStyles);
  const colours = useColours();
  const { t } = useTranslation();
  const router = useRouter();
  const zone = useFamilyZone();
  const { withToken, offline, who, vault } = useVault();
  const { id } = props;
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [name, setName] = useState(props.name ?? '');
  const [refreshing, setRefreshing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [ending, setEnding] = useState<EmergencyLink | null>(null);
  const [endBusy, setEndBusy] = useState(false);
  const [endProblem, setEndProblem] = useState<string | null>(null);
  const mine = who?.member_id === id;

  const load = useCallback(async () => {
    try {
      const view = await withToken((a, tk) => a.emergencyOf(tk, id));
      // The links that fail are said where they would be, never taken for none (the review of 0.15.0).
      let links: EmergencyLink[] = [];
      let linksFailed: string | null = null;
      if (view.can_see_links) {
        try {
          links = (await withToken((a, tk) => a.emergencyLinks(tk, id))).items;
        } catch (err) {
          linksFailed = loadFailure('emergency-links', err, t) ?? t('emergency.needsConnection');
        }
      }
      if (!props.name) {
        await withToken((a, tk) => a.members(tk)).then(
          (r) => setName(r.items.find((m) => m.id === id)?.display_name ?? ''),
          () => undefined,
        );
      }
      setState({ kind: 'ready', view, links, linksFailed });
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 404) {
        setState({ kind: 'none' });
        return;
      }
      // Too slow, or anything else, said with Try again; no connection (or the session over), said as such.
      const words = loadFailure('emergency', err, t);
      setState(words ? { kind: 'failed', words } : { kind: 'offline' });
    }
  }, [withToken, id, props.name, t]);

  useEffect(() => {
    // Asked on arrival and when the connection returns; set once the vault answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, offline]);

  const takeBack = async () => {
    const l = ending;
    if (!l || endBusy) return;
    setEndBusy(true);
    setEndProblem(null);
    try {
      await withToken((a, tk) => a.revokeEmergencyLink(tk, id, l.id));
      setEnding(null);
      feel('done');
      setSaid(t('emergency.takenBack'));
      await load();
    } catch (err) {
      setEndProblem(wordsFor(err, t));
    } finally {
      setEndBusy(false);
    }
  };

  const view = state.kind === 'ready' ? state.view : null;
  const parts = view ? sections(view, t) : [];
  const typed = parts.filter((p) => p.key !== 'date_of_birth');
  const papers = view
    ? EMERGENCY_DOCUMENT_KINDS.flatMap((k) => view.documents[k].map((d) => ({ kind: k, ...d })))
    : [];
  const who1 = mine ? t('emergency.you') : name;

  return (
    <ScrollView
      testID="emergency"
      contentContainerStyle={styles.page}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load().finally(() => setRefreshing(false));
          }}
        />
      }
    >
      <View style={styles.head}>
        <HeartPulse color={colours.accent} size={22} accessibilityElementsHidden importantForAccessibility="no" />
        <View style={styles.flex}>
          <Text variant="hero" role="header">
            {name || t('emergency.title')}
          </Text>
          {name ? (
            <Text variant="secondary" tone="soft">
              {t('emergency.title')}
            </Text>
          ) : null}
        </View>
      </View>

      {state.kind === 'loading' ? <Placeholder rows={3} /> : null}
      {state.kind === 'offline' ? (
        <Notice tone="warn" testID="emergency-offline">
          {t('emergency.needsConnection')}
        </Notice>
      ) : null}
      {state.kind === 'none' ? (
        <Text tone="soft" testID="emergency-none">
          {mine ? t('emergency.noneMine') : t('emergency.none', { name: name || t('emergency.thisPerson') })}
        </Text>
      ) : null}
      {state.kind === 'failed' ? <LoadFailed words={state.words} onRetry={() => void load()} /> : null}

      {view ? (
        <>
          {view.caregiver ? (
            <Text variant="secondary" tone="soft" testID="emergency-caregiver">
              {t('emergency.asCaregiver', { name })}
            </Text>
          ) : null}
          {said ? (
            <Notice tone="ok" testID="emergency-said">
              {said}
            </Notice>
          ) : null}
          {typed.length === 0 ? (
            <Text tone="soft" testID="emergency-empty">
              {view.can_edit
                ? mine
                  ? t('emergency.emptyMine')
                  : t('emergency.emptyTheirs', { name })
                : t('emergency.empty')}
            </Text>
          ) : null}
          {parts.length > 0 ? (
            <View style={styles.card} testID="emergency-parts">
              {parts.map((p, i) => (
                <Fragment key={p.key}>
                  {i > 0 ? <View style={styles.sep} /> : null}
                  <View style={styles.part} testID={`emergency-${p.key}`}>
                    <Text variant="small" tone="soft" weight="600">
                      {p.label}
                    </Text>
                    {/* Not selectable: a copy would sit on the clipboard with nobody to clear it. */}
                    {p.lines.map((line, n) => (
                      <Text key={n}>{line}</Text>
                    ))}
                  </View>
                </Fragment>
              ))}
            </View>
          ) : null}

          {papers.length > 0 ? (
            <View style={styles.card} testID="emergency-papers">
              {papers.map((d, i) => (
                <Fragment key={d.id}>
                  {i > 0 ? <View style={styles.sep} /> : null}
                  <Pressable
                    testID={`emergency-paper-${d.id}`}
                    accessibilityRole="link"
                    accessibilityLabel={`${EMERGENCY_DOCUMENT_LABELS[d.kind]}. ${d.title}`}
                    onPress={() => router.push({ pathname: '/document/[id]', params: { id: d.id } })}
                    style={({ pressed }) => [styles.line, pressed ? styles.pressed : null]}
                  >
                    <Text variant="secondary" tone="soft">
                      {EMERGENCY_DOCUMENT_LABELS[d.kind]}
                    </Text>
                    <Text weight="600" tone="accent" style={styles.flex}>
                      {`${d.title} ›`}
                    </Text>
                  </Pressable>
                </Fragment>
              ))}
            </View>
          ) : null}

          <Text variant="secondary" tone="soft" testID="emergency-who">
            {t('emergency.whoCanSee', { who: audienceWords(view, mine, name, t) })}
          </Text>
          <Text variant="small" tone="soft" testID="emergency-not-advice">
            {EMERGENCY_NOT_ADVICE}
          </Text>

          <View style={styles.actions}>
            {view.can_choose && typed.length > 0 && shareable(view).length > 0 ? (
              <Button
                label={t('emergency.share')}
                disabled={offline}
                onPress={() => {
                  setSaid(null);
                  setSharing(true);
                }}
                testID="emergency-share"
              />
            ) : null}
            {(view.can_edit || view.can_choose) && vault ? (
              <Button
                kind="quiet"
                label={t('emergency.onTheWeb')}
                hint={t('emergency.onTheWebHint')}
                onPress={() => void Linking.openURL(`${vault.origin}/people/${encodeURIComponent(id)}`)}
                testID="emergency-web"
              />
            ) : null}
          </View>

          {view.can_see_links && state.kind === 'ready' && state.linksFailed ? (
            <View style={styles.section} testID="emergency-links">
              <Text variant="screen" role="header">
                {t('emergency.links')}
              </Text>
              <LoadFailed words={state.linksFailed} onRetry={() => void load()} testID="emergency-links-failed" />
            </View>
          ) : null}
          {view.can_see_links && state.kind === 'ready' && !state.linksFailed && state.links.length > 0 ? (
            <View style={styles.section} testID="emergency-links">
              <Text variant="screen" role="header">
                {t('emergency.links')}
              </Text>
              {state.links.map((l) => {
                const label = l.recipient_label ?? t('emergency.aLink');
                const status =
                  l.state === 'active'
                    ? t('emergency.worksUntil', { end: endWords(new Date(l.expires_at), zone) })
                    : l.state === 'revoked'
                      ? t('emergency.linkTakenBack')
                      : l.state === 'locked'
                        ? t('emergency.linkLocked')
                        : l.state === 'paused'
                          ? t('emergency.linkPaused')
                          : l.state === 'used_up'
                            ? t('emergency.linkUsedUp')
                            : t('emergency.linkEnded');
                // Taken back unless it is already, or its end has passed: the vault takes back any link not taken back.
                const takable = l.state !== 'revoked' && l.state !== 'expired';
                return (
                  <View key={l.id} style={[styles.card, styles.link]} testID={`emergency-link-${l.id}`}>
                    <Text weight="600">{label}</Text>
                    <Text variant="secondary" tone="soft">
                      {`${status} · ${t('emergency.shows', { parts: showsWords(l) })}`}
                    </Text>
                    {l.openings.length === 0 ? (
                      <Text variant="small" tone="soft" testID={`emergency-link-${l.id}-unopened`}>
                        {t('emergency.notOpened')}
                      </Text>
                    ) : (
                      l.openings.map((o, i) => (
                        <Text key={`${o.at}-${i}`} variant="small" tone="soft" testID={`emergency-link-${l.id}-opened-${i}`}>
                          {o.network
                            ? t('emergency.openedOn', {
                                when: exactWords(o.at, zone),
                                browser: browserWords(o.user_agent, t),
                                network: o.network,
                              })
                            : t('emergency.opened', { when: exactWords(o.at, zone), browser: browserWords(o.user_agent, t) })}
                        </Text>
                      ))
                    )}
                    {takable ? (
                      <View style={styles.linkActions}>
                        <Button
                          size="small"
                          kind="quiet"
                          label={t('emergency.takeBack')}
                          accessibilityLabel={
                            l.recipient_label ? t('emergency.takeBackFor', { who: l.recipient_label }) : t('emergency.takeBack')
                          }
                          disabled={offline}
                          onPress={() => {
                            setEndProblem(null);
                            setEnding(l);
                          }}
                          testID={`emergency-take-back-${l.id}`}
                        />
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          ) : null}

          {sharing ? (
            <ClinicianSheet
              view={view}
              name={name}
              mine={mine}
              onClose={() => setSharing(false)}
              onMade={() => {
                setSaid(t('emergency.made'));
                void load();
              }}
            />
          ) : null}
          <ConfirmSheet
            visible={ending !== null}
            testID="emergency-take-back-question"
            icon={Link2Off}
            title={t('emergency.takeBackTitle')}
            words={t('emergency.takeBackWords', { who: who1 })}
            confirmLabel={t('emergency.takeBack')}
            busy={endBusy}
            problem={endProblem}
            onConfirm={() => void takeBack()}
            onCancel={() => setEnding(null)}
            confirmID="emergency-take-back-yes"
            cancelID="emergency-take-back-cancel"
            problemID="emergency-take-back-problem"
          />
        </>
      ) : null}
    </ScrollView>
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    page: { padding: sp(20), gap: sp(12) },
    head: { flexDirection: 'row', alignItems: 'center', gap: sp(12) },
    flex: { flex: 1 },
    card: {
      backgroundColor: colours.surface,
      borderRadius: radii.m,
      borderWidth: 1,
      borderColor: colours.border,
      overflow: 'hidden',
    },
    sep: { height: StyleSheet.hairlineWidth, backgroundColor: colours.border },
    part: { paddingHorizontal: sp(12), paddingVertical: sp(8), gap: 2 },
    line: { flexDirection: 'row', alignItems: 'center', gap: sp(8), minHeight: 44, paddingHorizontal: sp(12), paddingVertical: sp(6) },
    actions: { gap: sp(8) },
    section: { gap: sp(8) },
    link: { padding: sp(12), gap: 2 },
    linkActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: sp(4) },
    pressed: { opacity: 0.8 },
  });
