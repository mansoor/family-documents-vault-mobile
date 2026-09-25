import { colours, radii, statusTone, type Status } from '@fdv/shared';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text as RNText } from 'react-native';
import { StatusLine, Text } from '../ui';
import { snippetParts } from './snippet';

/**
 * One document in a list (4.12): its name and status, and — from a
 * search — where it matched, in bold. It opens the document.
 */
export function DocumentRow(props: { id: string; title: string | null; status: Status; snippet?: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const title = props.title ?? t('document.untitled');
  // Read out as it is shown: its name, its status, and where it matched.
  const said = [
    title,
    statusTone(props.status)?.words,
    props.snippet ? snippetParts(props.snippet).map((p) => p.text).join('') : null,
  ]
    .filter(Boolean)
    .join('. ');
  return (
    <Pressable
      testID={`doc-row-${props.id}`}
      accessibilityRole="button"
      accessibilityLabel={said}
      onPress={() => router.push({ pathname: '/document/[id]', params: { id: props.id } })}
      style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
    >
      <Text weight="600">{title}</Text>
      <StatusLine status={props.status} />
      {props.snippet ? (
        <Text variant="secondary" tone="soft" testID={`snippet-${props.id}`}>
          {snippetParts(props.snippet).map((part, i) =>
            part.bold ? (
              <RNText key={i} style={styles.bold}>
                {part.text}
              </RNText>
            ) : (
              part.text
            ),
          )}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: 4,
    backgroundColor: colours.surface,
    borderRadius: radii.l,
    borderWidth: 1,
    borderColor: colours.border,
    padding: 12,
    minHeight: 56,
  },
  pressed: { opacity: 0.8 },
  bold: { fontWeight: '700', color: colours.ink },
});
