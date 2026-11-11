import { normaliseTags, radii, TAG_MAX, tagsProblem, TAGS_MAX } from '@fdv/shared';
import { X } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { Button, Field, Text } from '../ui';
import { sp } from '../ui/space';
import { useColours, useStyles, type Palette } from '../ui/theme';

/**
 * A document's tags, changed in Edit details (the owner's gaps review, 11
 * Nov 2026): each with its ✕, and a field to add one, as the vault keeps
 * them (`normaliseTags`): trimmed, each once whatever its case, at most
 * TAG_MAX characters and TAGS_MAX of them. What is wrong is said under the
 * field, in the vault's own words, and nothing is added.
 */
export function TagsEditor(props: { tags: string[]; onChange: (tags: string[]) => void }) {
  const styles = useStyles(makeStyles);
  const colours = useColours();
  const { t } = useTranslation();
  const [typed, setTyped] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const add = () => {
    const tag = typed.trim();
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
              onSubmitEditing={add}
              returnKeyType="done"
              maxLength={TAG_MAX + 10}
              error={problem}
              testID="edit-tag-new"
            />
          </View>
          <View style={styles.addButton}>
            <Button size="small" kind="quiet" label={t('tags.addButton')} disabled={!typed.trim()} onPress={add} testID="edit-tag-add" />
          </View>
        </View>
      ) : null}
    </View>
  );
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
    flex: { flex: 1 },
    addButton: { paddingBottom: 6 },
  });
