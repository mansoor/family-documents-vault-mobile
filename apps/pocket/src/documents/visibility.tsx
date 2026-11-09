import { ApiRequestError } from '@fdv/client';
import { radii, visibilityChoices, type DocumentView, type Visibility } from '@fdv/shared';
import { Check } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { wordsFor } from '../errors/words';
import { useStepUp } from '../state/step-up';
import { useVault } from '../state/vault';
import { Button, Notice, Text } from '../ui';
import { Sheet } from '../ui/sheet';
import { sp } from '../ui/space';
import { useColours, useStyles, type Palette } from '../ui/theme';

/**
 * Who can see it (P8): the document's chip, and — for whoever may change it
 * — a sheet of the choices @fdv/shared's visibilityChoices allows, as the
 * web offers them (an owner or an adult; Only me only for its own person;
 * a teen, Everyone or Only me on what they filed). Into Only me, with share
 * links of the person's own still open, the vault asks what becomes of
 * them (409 links_choice_needed): ended, or kept while the household lets
 * them out. What the vault says back about it is said under the chip.
 */
export function VisibilityControl(props: { doc: DocumentView; onChanged: () => Promise<void> | void }) {
  const styles = useStyles(makeStyles);
  const colours = useColours();
  const { t } = useTranslation();
  const { who } = useVault();
  const { guarded } = useStepUp();
  const { doc } = props;
  const choices = who
    ? visibilityChoices(
        { role: who.role, mine: doc.owner_member_id === who.member_id, filedByMe: doc.filed_by_me === true },
        doc.visibility,
      )
    : [];
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Visibility | null>(null);
  const [links, setLinks] = useState<LinksAsked | null>(null);
  const [said, setSaid] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);

  const change = async (to: Visibility, ownLinks?: 'end' | 'keep') => {
    if (busy) return;
    setBusy(to);
    setSaid(null);
    try {
      const done = await guarded((a, tk) => a.setVisibility(tk, doc.id, to, ownLinks));
      if (done === null) return;
      setOpen(false);
      setLinks(null);
      setSaid({ tone: 'ok', text: done.notice?.body ?? t('visibility.changed', { to: t(`document.visibility_${to}`) }) });
      await props.onChanged();
    } catch (err) {
      const asked = linksAsked(err, to);
      if (asked) {
        setLinks(asked);
      } else {
        setSaid({ tone: 'warn', text: wordsFor(err, t) });
      }
    } finally {
      setBusy(null);
    }
  };

  const chip = (
    <View style={styles.chip}>
      <Text variant="secondary" weight="600">
        {t(`document.visibility_${doc.visibility}`)}
      </Text>
    </View>
  );

  return (
    <View style={styles.wrap}>
      {choices.length > 0 ? (
        <Pressable
          testID="document-visibility"
          accessibilityRole="button"
          accessibilityLabel={t('visibility.button', { now: t(`document.visibility_${doc.visibility}`) })}
          onPress={() => setOpen(true)}
          style={({ pressed }) => [styles.pressable, pressed ? styles.pressed : null]}
        >
          {chip}
          <Text variant="secondary" tone="accent" weight="600">
            {t('visibility.change')}
          </Text>
        </Pressable>
      ) : (
        <View testID="document-visibility">{chip}</View>
      )}
      {said ? (
        <Notice tone={said.tone} testID="visibility-said">
          {said.text}
        </Notice>
      ) : null}
      <Sheet
        visible={open}
        onClose={() => {
          setOpen(false);
          setLinks(null);
        }}
        testID="visibility-sheet"
        outside="visibility-sheet-outside"
      >
        <Text variant="screen">{t('visibility.title')}</Text>
        {links ? (
          <>
            <Text testID="visibility-links">{t('visibility.links', { count: links.count })}</Text>
            {links.keep ? null : (
              <Text tone="soft" variant="secondary">
                {t('visibility.linksNoKeep')}
              </Text>
            )}
            <Button
              testID="visibility-links-end"
              label={t('visibility.linksEnd')}
              busy={busy !== null}
              onPress={() => void change(links.to, 'end')}
            />
            {links.keep ? (
              <Button
                testID="visibility-links-keep"
                kind="quiet"
                label={t('visibility.linksKeep')}
                disabled={busy !== null}
                onPress={() => void change(links.to, 'keep')}
              />
            ) : null}
          </>
        ) : (
          <View accessibilityRole="radiogroup" accessibilityLabel={t('visibility.title')} style={styles.choices}>
            {choices.map((v) => {
              const now = v === doc.visibility;
              return (
                <Pressable
                  key={v}
                  testID={`visibility-${v}`}
                  accessibilityRole="radio"
                  accessibilityLabel={t(`document.visibility_${v}`)}
                  accessibilityState={{ checked: now, disabled: busy !== null }}
                  accessibilityHint={t(`visibility.hint_${v}`)}
                  disabled={busy !== null || now}
                  onPress={() => void change(v)}
                  style={({ pressed }) => [styles.choice, now ? styles.chosen : null, pressed ? styles.pressed : null]}
                >
                  <View style={styles.flex}>
                    <Text weight="600">{t(`document.visibility_${v}`)}</Text>
                    <Text variant="secondary" tone="soft">
                      {t(`visibility.hint_${v}`)}
                    </Text>
                  </View>
                  {now ? (
                    <Check color={colours.accent} size={22} accessibilityElementsHidden importantForAccessibility="no" />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        )}
        <Button
          kind="quiet"
          label={t('common.cancel')}
          onPress={() => {
            setOpen(false);
            setLinks(null);
          }}
          testID="visibility-cancel"
        />
      </Sheet>
    </View>
  );
}

/** The vault's question, read: how many of the person's own links, and whether keeping them is offered. */
interface LinksAsked {
  to: Visibility;
  count: number;
  keep: boolean;
}

export function linksAsked(err: unknown, to: Visibility): LinksAsked | null {
  if (!(err instanceof ApiRequestError) || err.code !== 'links_choice_needed') return null;
  try {
    const parsed = JSON.parse(err.detail ?? '') as { links?: unknown; keep_allowed?: unknown };
    const count = Array.isArray(parsed.links) ? parsed.links.length : 0;
    return { to, count: Math.max(count, 1), keep: parsed.keep_allowed === true };
  } catch {
    // Asked, but not said how: ending them is always allowed.
    return { to, count: 1, keep: false };
  }
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    wrap: { gap: sp(8) },
    pressable: { flexDirection: 'row', alignItems: 'center', gap: sp(12), minHeight: 44, alignSelf: 'flex-start' },
    pressed: { opacity: 0.8 },
    chip: {
      alignSelf: 'flex-start',
      paddingHorizontal: sp(12),
      paddingVertical: sp(6),
      borderRadius: radii.pill,
      backgroundColor: colours.accentSoft,
    },
    choices: { gap: sp(8) },
    choice: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: sp(12),
      padding: sp(12),
      minHeight: 56,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colours.border,
      backgroundColor: colours.surface,
    },
    chosen: { borderColor: colours.accent },
    flex: { flex: 1, gap: sp(4) },
  });
