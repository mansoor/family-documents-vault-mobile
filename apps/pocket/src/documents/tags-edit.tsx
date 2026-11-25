import {
  normaliseTags,
  radii,
  RECENT_TAGS_OFFERED,
  recentTagOffers,
  TAG_MAX,
  tagsProblem,
  tagSuggestions,
  TAGS_MAX,
  type TagView,
} from '@fdv/shared';
import { Plus, X } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, Pressable, StyleSheet, View } from 'react-native';
import { useVault } from '../state/vault';
import { Button, Field, Text } from '../ui';
import { useKeepInView } from '../ui/keyboard';
import { sp } from '../ui/space';
import { useColours, useStyles, type Palette } from '../ui/theme';

/**
 * A document's tags, changed in Edit details (the owner's gaps review, 11
 * Nov 2026): each with its ✕, and a field to add one, as the vault keeps
 * them (`normaliseTags`): trimmed, each once whatever its case, at most
 * TAG_MAX characters and TAGS_MAX of them. What is wrong is said under the
 * field, in the vault's own words, and nothing is added.
 *
 * Tags as other apps offer them (0.26.0): with the field given the focus
 * and nothing typed, the tags used most recently, five at most, as pills
 * above it under "Recently used" (where the vault can say,
 * features.recent_tags); as somebody types, the tags already used that fit
 * (`tagSuggestions`), the vault asked once the typing settles. Never one
 * the document has. Above, not below: below the field they fell under the
 * keyboard and Save. Their appearing is said to a screen reader, once.
 * A tap on a pill adds it; a new word is still added with Add or Done.
 * Without a connection there are no pills, and adding works as before.
 */
export function TagsEditor(props: { tags: string[]; onChange: (tags: string[]) => void }) {
  const styles = useStyles(makeStyles);
  const colours = useColours();
  const { t } = useTranslation();
  const [typed, setTyped] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const blurring = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (blurring.current) clearTimeout(blurring.current);
    },
    [],
  );
  const offers = useTagOffers(typed, focused, props.tags);
  const keeper = useKeepInView();
  // Said once as they appear (or change from recently used to those that fit), never at each letter typed.
  const offered = props.tags.length < TAGS_MAX && offers.tags.length > 0 ? (offers.recent ? 'recent' : 'used') : null;
  useEffect(() => {
    if (offered) AccessibilityInfo.announceForAccessibility(t(offered === 'recent' ? 'tags.offeredRecent' : 'tags.offeredUsed'));
  }, [offered, t]);

  const add = (picked?: string) => {
    const tag = (picked ?? typed).trim();
    if (!tag) return;
    const next = normaliseTags([...props.tags, tag]);
    const wrong = tagsProblem(next);
    if (wrong) {
      setProblem(wrong);
      return;
    }
    setProblem(null);
    setTyped('');
    props.onChange(next);
  };

  return (
    <View style={styles.wrap} testID="edit-tags">
      <Text variant="secondary" weight="600" tone="soft">
        {t('document.tags')}
      </Text>
      {props.tags.length > 0 ? (
        <View style={styles.tags}>
          {props.tags.map((tag) => (
            <Pressable
              key={tag}
              testID={`edit-tag-${tag}`}
              accessibilityRole="button"
              accessibilityLabel={t('tags.remove', { tag })}
              hitSlop={6}
              onPress={() => props.onChange(props.tags.filter((x) => x !== tag))}
              style={({ pressed }) => [styles.tag, pressed ? styles.pressed : null]}
            >
              <Text variant="secondary" weight="600" role="text">
                {tag}
              </Text>
              <X color={colours.inkSoft} size={14} accessibilityElementsHidden importantForAccessibility="no" />
            </Pressable>
          ))}
        </View>
      ) : (
        <Text variant="secondary" tone="muted" testID="edit-tags-none">
          {t('tags.none')}
        </Text>
      )}
      {/* Above the field, so they show whenever it does (the keyboard and Save cover what is below it). */}
      {props.tags.length < TAGS_MAX && offers.tags.length > 0 ? (
        <View
          style={styles.offers}
          testID="edit-tag-offers"
          // The field below moved down as they came: it is kept in view.
          onLayout={() => keeper?.again()}
        >
          <Text
            variant="small"
            weight="600"
            tone="soft"
            role="header"
            testID={offers.recent ? 'edit-tags-recent' : 'edit-tags-used'}
          >
            {offers.recent ? t('tags.recentlyUsed') : t('tags.alreadyUsed')}
          </Text>
          <View style={styles.tags}>
            {offers.tags.map((tag) => (
              <Pressable
                key={tag}
                testID={`edit-tag-offer-${tag}`}
                accessibilityRole="button"
                accessibilityLabel={t('tags.addThis', { tag })}
                hitSlop={6}
                onPress={() => add(tag)}
                style={({ pressed }) => [styles.tag, styles.offer, pressed ? styles.pressed : null]}
              >
                <Plus color={colours.inkSoft} size={14} accessibilityElementsHidden importantForAccessibility="no" />
                <Text variant="secondary" role="text">
                  {tag}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
      {props.tags.length < TAGS_MAX ? (
        <View style={styles.addRow}>
          <View style={styles.flex}>
            <Field
              label={t('tags.add')}
              value={typed}
              onChangeText={(v) => {
                setTyped(v);
                setProblem(null);
              }}
              onSubmitEditing={() => add()}
              onFocus={() => {
                if (blurring.current) clearTimeout(blurring.current);
                setFocused(true);
              }}
              onBlur={() => {
                // A moment later: a pill pressed as the field lets go of the focus is still pressed.
                blurring.current = setTimeout(() => setFocused(false), BLUR_SETTLES_MS);
              }}
              returnKeyType="done"
              maxLength={TAG_MAX + 10}
              error={problem}
              testID="edit-tag-new"
            />
          </View>
          <View style={styles.addButton}>
            <Button
              size="small"
              kind="quiet"
              label={t('tags.addButton')}
              disabled={!typed.trim()}
              onPress={() => add()}
              testID="edit-tag-add"
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** How long typing has to stop before the vault is asked what fits, as on the web. */
export const TYPED_SETTLES_MS = 150;
/** How long the pills stay once the field lets go of the focus: a pill's own press. */
const BLUR_SETTLES_MS = 200;

/** What the vault answered, and to what: `q` as typed, and whether it was "Recently used". */
interface Found {
  q: string;
  items: TagView[];
  recent: boolean;
}

/**
 * The tags offered under the field (0.26.0). Nothing is asked until the
 * field has the focus. Nothing typed: the tags used most recently, asked
 * again each time it is given the focus (and as the document's tags
 * change) — as many more than five as the document has already, so that
 * five are left to offer — where the vault can say (features.recent_tags);
 * an older vault offers none until something is typed. Typing: those that
 * start with it, asked once the typing stops. Offline, or a vault that
 * cannot answer: none.
 */
function useTagOffers(typed: string, focused: boolean, have: string[]): { tags: string[]; recent: boolean } {
  const { caps, offline, withToken } = useVault();
  const [found, setFound] = useState<Found | null>(null);
  const q = typed.replace(/^\s+/, '');
  const recent = q === '' && caps?.features.recent_tags === true;
  const want = RECENT_TAGS_OFFERED + have.length;
  const asking = focused && !offline && (q !== '' || recent);
  useEffect(() => {
    if (!asking) return;
    let stopped = false;
    const timer = setTimeout(() => {
      withToken((a, tk) => a.tags(tk, q || undefined, recent ? { sort: 'recent', limit: want } : { limit: 50 }))
        .then((r) => {
          if (!stopped) setFound({ q, items: r.items, recent });
        })
        .catch(() => undefined);
    }, TYPED_SETTLES_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [asking, q, recent, want, withToken]);
  if (!focused || offline || !found) return { tags: [], recent: false };
  if (q === '') {
    return found.recent && found.q === '' ? { tags: recentTagOffers(found.items, have), recent: true } : { tags: [], recent: false };
  }
  return { tags: tagSuggestions(typed, found.items, have), recent: false };
}

const makeStyles = (colours: Palette) =>
  StyleSheet.create({
    wrap: { gap: sp(8) },
    tags: { flexDirection: 'row', flexWrap: 'wrap', gap: sp(8) },
    tag: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: sp(6),
      minHeight: 32,
      paddingHorizontal: sp(10),
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: colours.borderInput,
      backgroundColor: colours.surface,
    },
    pressed: { opacity: 0.8 },
    addRow: { flexDirection: 'row', alignItems: 'flex-end', gap: sp(8) },
    offers: { gap: sp(6) },
    offer: { borderStyle: 'dashed', backgroundColor: colours.bg },
    flex: { flex: 1 },
    addButton: { paddingBottom: 6 },
  });
