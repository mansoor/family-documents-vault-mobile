import { colours, radii, statusTone, type DocumentView, type Status } from '@fdv/shared';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text as RNText, View } from 'react-native';
import { StatusLine, Text } from '../ui';
import { useDocumentMenu } from './menu';
import { snippetParts } from './snippet';

/**
 * One document in a list (4.12): its name and status, and — from a
 * search — where it matched, in bold. It opens the document; its ⋯, or a
 * long press, opens what may be done with it (5.36).
 */
export function DocumentRow(props: {
  id: string;
  title: string | null;
  status: Status;
  snippet?: string;
  /** What the list knows of it already: a search hit has none, and its ⋯ asks. */
  doc?: DocumentView;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const title = props.title ?? t('document.untitled');
  const menu = useDocumentMenu({ id: props.id, title, doc: props.doc ?? null });
  // Read out as it is shown: its name, its status, and where it matched.
  const said = [
    title,
    statusTone(props.status)?.words,
    props.snippet ? snippetParts(props.snippet).map((p) => p.text).join('') : null,
  ]
    .filter(Boolean)
    .join('. ');
  return (
    <View style={styles.row}>
      <Pressable
        testID={`doc-row-${props.id}`}
        accessibilityRole="button"
        accessibilityLabel={said}
        onPress={() => router.push({ pathname: '/document/[id]', params: { id: props.id } })}
        onLongPress={menu.open}
        style={({ pressed }) => [styles.main, pressed ? styles.pressed : null]}
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
      {menu.button}
      {menu.sheet}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colours.surface,
    borderRadius: radii.l,
    borderWidth: 1,
    borderColor: colours.border,
    paddingRight: 4,
  },
  main: { flex: 1, gap: 4, padding: 12, minHeight: 56 },
  pressed: { opacity: 0.8 },
  bold: { fontWeight: '700', color: colours.ink },
});
