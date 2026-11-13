import { asItsKindSays, SENSITIVE_LABEL, SENSITIVE_MEANS, type DocumentTypeView } from '@fdv/shared';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Text } from '../ui';
import { Chip, ChipRow } from '../ui/chip';
import { sp } from '../ui/space';

/**
 * Sensitive (a vault with `sensitive_documents`, 0.9.0-dev.34, AIR2): As its
 * kind says — with what that is now, in the vault's own words
 * (`asItsKindSays`) — Yes or No, on the capture card and in Edit details,
 * as the web's add card asks it. What it means is said under it.
 *
 * A teen may make a paper sensitive, never not: No is offered to a teen only
 * when the document is so already (`was`), as on the web.
 */
export function SensitiveChooser(props: {
  kind: DocumentTypeView | undefined;
  /** The document's own choice: null as its kind says. */
  chosen: boolean | null;
  teen: boolean;
  /** The document's own choice as it was opened (Edit details); undefined for a new one. */
  was?: boolean | null;
  onChoose: (v: boolean | null) => void;
  /** testIDs: `${id}-kind`, `${id}-yes`, `${id}-no`. */
  id: string;
}) {
  const { t } = useTranslation();
  const choices: [boolean | null, string, string][] = [
    [null, asItsKindSays(props.kind), 'kind'],
    [true, t('document.yes'), 'yes'],
    ...(!props.teen || props.was === false ? [[false, t('document.no'), 'no'] as [boolean, string, string]] : []),
  ];
  return (
    <View style={styles.section} testID={props.id}>
      <Text variant="screen">{SENSITIVE_LABEL}</Text>
      <ChipRow label={SENSITIVE_LABEL}>
        {choices.map(([value, label, key]) => (
          <Chip
            key={key}
            label={label}
            selected={props.chosen === value}
            onPress={() => props.onChoose(value)}
            testID={`${props.id}-${key}`}
          />
        ))}
      </ChipRow>
      <Text variant="secondary" tone="muted">
        {SENSITIVE_MEANS}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({ section: { gap: sp(10) } });
