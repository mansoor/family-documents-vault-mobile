import { ApiRequestError, type Api } from '@fdv/client';
import {
  COLLECTION_MANAGER_SWITCHES,
  radii,
  type CollectionManager,
  type CollectionManagers,
  type CollectionPowers,
} from '@fdv/shared';
import type { TFunction } from 'i18next';
import { ChevronRight, UserPlus, UsersRound } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { wordsFor } from '../errors/words';
import { emit } from '../state/events';
import { useVault } from '../state/vault';
import { Button, Notice, Text } from '../ui';
import { ConfirmSheet } from '../ui/confirm';
import { feel } from '../ui/feel';
import { PickerSheet } from '../ui/picker';
import { sp } from '../ui/space';
import { LoadFailed, loadFailure, Placeholder } from '../ui/states';
import { useColours, useStyles, type Palette } from '../ui/theme';

/**
 * A collection's managers on the phone (app 0.10.0; the vault's 0.9.0-dev.40,
 * the owner's decision of 13 Nov 2026), as the web's Managers section: who
 * besides its maker manages it, and what each may do besides what every
 * manager may — add and remove documents, fill and change its checklist,
 * rename it and change its words.
 *
 * Its maker, or a manager they let choose managers, makes somebody a manager
 * (one of the family the vault offers), turns each of the three switches on
 * or off, and takes a manager away, asked first. A switch the person may not
 * do themselves is never offered to give. An owner, while its maker may no
 * longer change it, may take managers away, and nothing more. Anybody else
 * of the family who sees it reads who manages it. The vault decides
 * regardless, and its own words say why when it refuses.
 */

export type SwitchKey = (typeof COLLECTION_MANAGER_SWITCHES)[number]['key'];
type Switches = Record<SwitchKey, boolean>;

const NONE: Switches = { may_change_audience: false, may_delete: false, may_choose_managers: false };

/** Which of the person's own powers each switch asks of them. */
const POWER_OF: Record<SwitchKey, keyof CollectionPowers> = {
  may_change_audience: 'change_audience',
  may_delete: 'delete',
  may_choose_managers: 'choose_managers',
};

/** A switch the person may turn on: one they may do themselves, or any, as its maker. */
export const mayGive = (powers: CollectionPowers, s: SwitchKey): boolean => powers.maker || powers[POWER_OF[s]];

/** "Can also delete it and choose managers", or "Can add and remove documents, and rename it". */
export function managerWords(m: Pick<CollectionManager, SwitchKey>, t: TFunction): string {
  const also = COLLECTION_MANAGER_SWITCHES.filter((s) => m[s.key]).map((s) => t(`managers.also_${s.key}`));
  if (also.length === 0) return t('managers.always');
  const what = also.length === 1 ? also[0] : `${also.slice(0, -1).join(', ')} ${t('managers.and')} ${also.at(-1)}`;
  return t('managers.canAlso', { what });
}

/** "Can also delete it" mid-sentence: "Sam: can also delete it." */
const lower = (words: string) => words.charAt(0).toLowerCase() + words.slice(1);

/**
 * The vault's own words for a refusal of managers — not allowed (403), already
 * a manager (409), somebody who can't be one, or a change that would leave its
 * maker outside it (422) — which it writes to be shown; the app's otherwise.
 */
export function managersRefusal(err: unknown, t: TFunction): string {
  if (err instanceof ApiRequestError && [403, 409, 422].includes(err.status) && err.message) return err.message;
  return wordsFor(err, t);
}

/** Managers, one line on a collection's page: who manages it, and the way to more. */
export function ManagersRow(props: { managers: readonly CollectionManager[]; onPress: () => void }) {
  const styles = useStyles(makeStyles);
  const colours = useColours();
  const { t } = useTranslation();
  const line =
    props.managers.length > 0 ? props.managers.map((m) => m.display_name).join(', ') : t('managers.nobody');
  return (
    <Pressable
      testID="collection-managers"
      accessibilityRole="button"
      accessibilityLabel={`${t('managers.title')}. ${line}`}
      accessibilityHint={t('managers.rowHint')}
      onPress={props.onPress}
      style={({ pressed }) => [styles.panel, pressed ? styles.pressed : null]}
    >
      <UsersRound color={colours.accent} size={20} accessibilityElementsHidden importantForAccessibility="no" />
      <View style={styles.flex}>
        <Text weight="600">{t('managers.title')}</Text>
        <Text variant="secondary" tone="soft" testID="collection-managers-line">
          {line}
        </Text>
      </View>
      <ChevronRight color={colours.inkSoft} size={20} accessibilityElementsHidden importantForAccessibility="no" />
    </Pressable>
  );
}

/** The Managers screen, for a collection by its id; its name, as its page had it, for the words. */
export function ManagersScreen(props: { id: string; name: string }) {
  const styles = useStyles(makeStyles);
  const colours = useColours();
  const { t } = useTranslation();
  const { withToken, offline } = useVault();
  const [data, setData] = useState<CollectionManagers | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [gone, setGone] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // Making somebody a manager: who, once chosen, and what more they may do.
  const [picking, setPicking] = useState(false);
  const [person, setPerson] = useState<string | null>(null);
  const [asked, setAsked] = useState<Switches>(NONE);
  // Taking one away, asked first.
  const [removing, setRemoving] = useState<CollectionManager | null>(null);
  const [removeProblem, setRemoveProblem] = useState<string | null>(null);
  const name = props.name;

  const load = useCallback(async () => {
    try {
      setData(await withToken((a, tk) => a.collectionManagers(tk, props.id)));
      setFailed(null);
      setGone(null);
    } catch (err) {
      if (err instanceof ApiRequestError && (err.status === 403 || err.status === 404)) {
        setGone(err.status === 403 && err.message ? err.message : t('collection.gone'));
      } else setFailed(loadFailure('managers', err, t));
    }
  }, [withToken, props.id, t]);
  useEffect(() => {
    // Asked on arrival and when the connection returns; set once the vault answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, offline]);

  /** One change sent: the vault's answer drawn, what was done said, and the collection's page told. */
  const run = async (what: (a: Api, tk: string) => Promise<CollectionManagers | void>, done: string): Promise<boolean> => {
    setBusy(true);
    setProblem(null);
    setSaid(null);
    try {
      const answer = await withToken(what);
      setData(answer ?? (await withToken((a, tk) => a.collectionManagers(tk, props.id))));
      setSaid(done);
      feel('done');
      emit('managersChanged', props.id);
      return true;
    } catch (err) {
      setProblem(managersRefusal(err, t));
      // Refused: who manages it, and what the person may do, as the vault has them now.
      if (err instanceof ApiRequestError && [403, 409, 422].includes(err.status)) void load();
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!data) {
    return (
      <View style={styles.page} testID="managers">
        {gone ? (
          <Notice tone="warn" testID="managers-gone">
            {gone}
          </Notice>
        ) : null}
        {failed ? <LoadFailed words={failed} onRetry={() => void load()} /> : null}
        {offline && !failed && !gone ? (
          <Notice tone="warn" testID="managers-offline">
            {t('collections.needsConnection')}
          </Notice>
        ) : null}
        {!failed && !gone && !offline ? <Placeholder rows={3} /> : null}
      </View>
    );
  }

  const powers = data.my_powers;
  const chooses = powers.choose_managers && !offline;
  const removes = powers.remove_managers && !offline;
  const chosen = person ? (data.eligible.find((e) => e.member_id === person) ?? null) : null;

  const add = async () => {
    if (!chosen) return;
    const ok = await run(
      (a, tk) => a.addCollectionManager(tk, props.id, { member_id: chosen.member_id, ...asked }),
      t('managers.added', { who: chosen.display_name, name }),
    );
    if (ok) {
      setPerson(null);
      setAsked(NONE);
    }
  };

  const toggle = (m: CollectionManager, s: SwitchKey, on: boolean) =>
    void run(
      (a, tk) => a.updateCollectionManager(tk, props.id, m.member_id, { [s]: on }),
      t('managers.changed', { who: m.display_name, words: lower(managerWords({ ...m, [s]: on }, t)) }),
    );

  const remove = async (m: CollectionManager) => {
    setBusy(true);
    setRemoveProblem(null);
    try {
      await withToken((a, tk) => a.removeCollectionManager(tk, props.id, m.member_id));
    } catch (err) {
      setRemoveProblem(managersRefusal(err, t));
      setBusy(false);
      return;
    }
    setRemoving(null);
    setBusy(false);
    await run(
      (a, tk) => a.collectionManagers(tk, props.id),
      t('managers.removed', { who: m.display_name, name }),
    );
  };

  return (
    <ScrollView
      testID="managers"
      style={styles.screen}
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
      <Text variant="hero">{t('managers.title')}</Text>
      <Text variant="secondary" tone="soft">
        {name ? t('managers.of', { name }) : ''}
      </Text>
      <Text testID="managers-always">{t('managers.alwaysAll')}</Text>
      {offline ? (
        <Notice tone="warn" testID="managers-offline">
          {t('collections.needsConnection')}
        </Notice>
      ) : null}
      {said ? (
        <Notice tone="ok" testID="managers-said">
          {said}
        </Notice>
      ) : null}
      {problem ? (
        <Notice tone="warn" testID="managers-problem">
          {problem}
        </Notice>
      ) : null}
      {data.items.length === 0 ? (
        <Text tone="soft" testID="managers-none">
          {t('managers.nobody')}
        </Text>
      ) : null}
      {data.items.map((m) => (
        <View key={m.member_id} style={styles.card} testID={`managers-${m.member_id}`}>
          <Text weight="600">{m.display_name}</Text>
          {chooses ? (
            COLLECTION_MANAGER_SWITCHES.map((s) => {
              // Turning on what the person may not do is never offered; turning it off is.
              const locked = busy || (!m[s.key] && !mayGive(powers, s.key));
              return (
                <View key={s.key} style={styles.switchRow}>
                  <Text style={styles.flex} tone={locked && !busy ? 'soft' : 'ink'}>
                    {t(`managers.${s.key}`)}
                  </Text>
                  <Switch
                    testID={`managers-${m.member_id}-${s.key}`}
                    accessibilityLabel={`${t(`managers.${s.key}`)} (${m.display_name})`}
                    value={m[s.key]}
                    disabled={locked}
                    onValueChange={(on) => toggle(m, s.key, on)}
                    trackColor={{ true: colours.accent, false: colours.borderInput }}
                  />
                </View>
              );
            })
          ) : (
            <Text variant="secondary" tone="soft" testID={`managers-${m.member_id}-words`}>
              {managerWords(m, t)}
            </Text>
          )}
          {removes ? (
            <Button
              testID={`managers-remove-${m.member_id}`}
              kind="quiet"
              label={t('managers.remove')}
              accessibilityLabel={t('managers.removeWho', { who: m.display_name })}
              disabled={busy}
              onPress={() => {
                setRemoveProblem(null);
                setRemoving(m);
              }}
            />
          ) : null}
        </View>
      ))}
      {chooses ? (
        data.eligible.length === 0 ? (
          <Text tone="soft" testID="managers-none-eligible">
            {t('managers.noneEligible')}
          </Text>
        ) : chosen ? (
          <View style={styles.card} testID="managers-new">
            <Text weight="600">{t('managers.willManage', { who: chosen.display_name })}</Text>
            {COLLECTION_MANAGER_SWITCHES.filter((s) => mayGive(powers, s.key)).map((s) => (
              <View key={s.key} style={styles.switchRow}>
                <Text style={styles.flex}>{t(`managers.${s.key}`)}</Text>
                <Switch
                  testID={`managers-new-${s.key}`}
                  accessibilityLabel={t(`managers.${s.key}`)}
                  value={asked[s.key]}
                  disabled={busy}
                  onValueChange={(on) => setAsked((had) => ({ ...had, [s.key]: on }))}
                  trackColor={{ true: colours.accent, false: colours.borderInput }}
                />
              </View>
            ))}
            <Button testID="managers-add" label={t('managers.make')} busy={busy} onPress={() => void add()} />
            <Button
              testID="managers-add-cancel"
              kind="quiet"
              label={t('common.cancel')}
              disabled={busy}
              onPress={() => {
                setPerson(null);
                setAsked(NONE);
              }}
            />
          </View>
        ) : (
          <Pressable
            testID="managers-choose"
            accessibilityRole="button"
            accessibilityLabel={t('managers.choose')}
            accessibilityHint={t('managers.chooseHint')}
            disabled={busy}
            onPress={() => {
              setSaid(null);
              setProblem(null);
              setPicking(true);
            }}
            style={({ pressed }) => [styles.panel, pressed ? styles.pressed : null]}
          >
            <UserPlus color={colours.accent} size={20} accessibilityElementsHidden importantForAccessibility="no" />
            <Text weight="600" style={styles.flex}>
              {t('managers.choose')}
            </Text>
          </Pressable>
        )
      ) : null}
      <PickerSheet
        visible={picking}
        title={t('managers.chooseTitle')}
        options={data.eligible.map((e) => ({ value: e.member_id, label: e.display_name }))}
        chosen={person ? [person] : []}
        onDone={([v]) => {
          setPicking(false);
          setPerson(v ?? null);
          setAsked(NONE);
        }}
        onClose={() => setPicking(false)}
        testID="managers-picker"
        optionID="managers-person"
      />
      <ConfirmSheet
        visible={removing !== null}
        testID="managers-remove-question"
        icon={UsersRound}
        title={t('managers.removeTitle', { who: removing?.display_name ?? '' })}
        words={t('managers.removeWords', { who: removing?.display_name ?? '', name })}
        confirmLabel={t('managers.remove')}
        busy={busy}
        problem={removeProblem}
        onConfirm={() => removing && void remove(removing)}
        onCancel={() => setRemoving(null)}
        confirmID="managers-remove-yes"
        cancelID="managers-remove-cancel"
        problemID="managers-remove-problem"
      />
    </ScrollView>
  );
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    screen: { backgroundColor: colours.bg },
    page: { padding: sp(20), gap: sp(12) },
    flex: { flex: 1 },
    card: {
      gap: sp(4),
      paddingHorizontal: sp(14),
      paddingVertical: sp(10),
      borderRadius: radii.l,
      borderWidth: 1,
      borderColor: colours.border,
      backgroundColor: colours.surface,
    },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: sp(12), minHeight: 48 },
    panel: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: sp(12),
      minHeight: 48,
      paddingHorizontal: sp(14),
      paddingVertical: sp(10),
      borderRadius: radii.l,
      borderWidth: 1,
      borderColor: colours.border,
      backgroundColor: colours.surface,
    },
    pressed: { opacity: 0.8 },
  });
