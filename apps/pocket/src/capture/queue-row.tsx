import { colours, type CaptureMetadata, type Member } from '@fdv/shared';
import type { TFunction } from 'i18next';
import { BUSY_CODES, wordsForCode } from '../errors/words';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { filedWithout, type FiledWithout, type QueueItem } from '../queue/item';
import { andList } from './draft';
import { Button, Card, Text } from '../ui';
import { Chip, ChipRow, sizeWords } from './ui';

/** Codes that mean the vault is there but not taking it just now. */

/**
 * Whether a refusal is about the person it was for: someone who has left
 * the family since the scan was made.
 */
export function ownerGone(item: QueueItem, members: readonly Pick<Member, 'id'>[] | null): boolean {
  const owner = item.metadata?.owner_member_id;
  return (
    item.state === 'needs_you' &&
    item.problem?.status === 422 &&
    typeof owner === 'string' &&
    members !== null &&
    !members.some((m) => m.id === owner)
  );
}

/**
 * The people a refused scan can be given to instead. It never becomes
 * less private than it was: an Only me scan can only stay yours.
 */
export function reassignChoices(
  item: QueueItem,
  members: readonly Pick<Member, 'id' | 'display_name'>[],
  me: string,
): { id: string | null; name: string | null }[] {
  if (item.metadata?.visibility === 'private') {
    const mine = members.find((m) => m.id === me);
    return mine ? [{ id: mine.id, name: mine.display_name }] : [];
  }
  return [...members.map((m) => ({ id: m.id, name: m.display_name })), { id: null, name: null }];
}

/**
 * A scan filed, or going, without details its kind no longer takes, in
 * words: by the names the card gave them, never their keys.
 */
export function withoutWords(f: FiledWithout, t: TFunction, filed: boolean): string {
  const names = f.names ? andList(f.names) : t('queue.someDetails');
  const count = f.names?.length ?? 2;
  return filed
    ? t('queue.filedWithout', { title: f.title ?? t('queue.untitled'), names, count })
    : t('queue.goesWithout', { names, count });
}

/** A capture on its way: what it is, where it stands, and what can be done — never "upload failed". */
export function QueueRow(props: {
  item: QueueItem;
  offline: boolean;
  limit: number | null;
  members: Member[] | null;
  me: string | null;
  onRemove: () => void;
  onRetry: (metadata: CaptureMetadata) => void;
}) {
  const { t } = useTranslation();
  const { item } = props;
  const p = item.problem;
  const gone = ownerGone(item, props.members);
  const state =
    item.state === 'needs_you'
      ? t('queue.needsYou')
      : item.state === 'sending'
        ? t('queue.sendingShort')
        : t('queue.waiting');
  const detail =
    item.state === 'needs_you'
      ? p?.status === 413
        ? t('queue.tooBigForVault', { limit: sizeWords(props.limit) })
        : p?.status === 415
          ? t('queue.wrongKind')
          : p?.status === 403
            ? item.kind === 'version'
              ? t('queue.versionRefused')
              : t('queue.noLongerAdd')
            : gone
              ? t('queue.ownerGone')
              : t('queue.refused', { reason: p?.message || wordsForCode(p?.code, t) })
      : item.state === 'sending'
        ? null
        : props.offline || item.lastCode === 'offline'
          ? t('queue.notYet')
          : item.lastCode === 'storage_unreachable'
            ? t('queue.storage')
            : item.lastCode && BUSY_CODES.has(item.lastCode)
              ? t('queue.busy')
              : null;
  const title = item.kind === 'version' ? t('queue.newVersion') : (item.metadata?.title ?? t('queue.untitled'));
  const choices = gone && props.members && props.me ? reassignChoices(item, props.members, props.me) : [];
  const without = item.state === 'needs_you' ? null : filedWithout(item);
  return (
    <Card style={item.state === 'needs_you' ? styles.needsYou : styles.row}>
      <Text weight="600">{title}</Text>
      <Text variant="secondary" weight="600" tone={item.state === 'needs_you' ? 'danger' : 'soft'} testID="queue-state">
        {state}
      </Text>
      {detail ? (
        <Text variant="secondary" tone="soft" testID="queue-detail">
          {detail}
        </Text>
      ) : null}
      {without ? (
        <Text variant="secondary" tone="soft" testID="queue-without">
          {withoutWords(without, t, false)}
        </Text>
      ) : null}
      {choices.length > 0 ? (
        <View style={styles.choices}>
          <ChipRow label={t('queue.chooseSomeone')} role="none">
            {choices.map((c) => (
              <Chip
                key={c.id ?? 'nobody'}
                label={c.id === null ? t('queue.withoutPerson') : t('queue.forPerson', { name: c.name })}
                onPress={() => props.onRetry({ ...(item.metadata ?? {}), owner_member_id: c.id })}
              />
            ))}
          </ChipRow>
        </View>
      ) : null}
      {item.state === 'needs_you' ? <Button label={t('queue.remove')} kind="quiet" onPress={props.onRemove} /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { gap: 4 },
  needsYou: { gap: 6, borderColor: colours.danger },
  choices: { gap: 6 },
});
