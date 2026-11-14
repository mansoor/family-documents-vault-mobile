import { ApiRequestError } from '@fdv/client';
import {
  COLLECTION_AUDIENCES,
  COLLECTION_DESCRIPTION_MAX,
  COLLECTION_NAME_MAX,
  inCollectionAudience,
  type CollectionAudience,
  type CollectionDetail,
  type CollectionView,
} from '@fdv/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { wordsFor } from '../errors/words';
import { useVault } from '../state/vault';
import { Button, Field, Notice, Text } from '../ui';
import { Chip, ChipRow } from '../ui/chip';
import { feel } from '../ui/feel';
import { Sheet } from '../ui/sheet';
import { sp } from '../ui/space';
import { useStyles } from '../ui/theme';
import { audienceKey } from './rules';

/**
 * A collection made, or its name, words and audience changed, from the
 * phone (the owner's gaps review, 11 Nov 2026: the phone could put
 * documents in a collection but not make one). As the web asks: a name,
 * what it is for if the person says, and who it is for — only the
 * audiences the person is in (A17), as the vault allows no other. Changed
 * somewhere else since it was opened: nothing is saved, and it says so.
 *
 * Changed by a manager (app 0.10.0): who it is for is plain words, never
 * sent, unless they may change it; and never Only me, which is its maker's
 * alone. The vault's words say why when it refuses.
 */
export function CollectionForm(props: {
  /** The collection being changed; none for a new one. */
  editing?: CollectionView | null;
  /** Who it is for is not the person's to change: said, not offered. */
  audienceFixed?: boolean;
  /** Only its maker makes it Only me. */
  noOnlyMe?: boolean;
  onSaved: (saved: CollectionDetail) => void;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const { t } = useTranslation();
  const { withToken, who } = useVault();
  const e = props.editing ?? null;
  const [name, setName] = useState(e?.name ?? '');
  const [words, setWords] = useState(e?.description ?? '');
  const [audience, setAudience] = useState<CollectionAudience>(e?.audience ?? 'everyone');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const audiences = who
    ? COLLECTION_AUDIENCES.filter((a) => inCollectionAudience(who.role, a) && !(props.noOnlyMe && a === 'only_me'))
    : [];
  const fixed = !!e && props.audienceFixed === true;
  const nameMissing = name.trim() === '';

  const save = async () => {
    if (busy || nameMissing) return;
    setBusy(true);
    setProblem(null);
    const body = { name: name.trim(), description: words.trim() || null, audience };
    // Who it is for, not the person's to change: not sent.
    const { audience: _same, ...unchanged } = body;
    try {
      const saved = await withToken((a, tk) =>
        e ? a.updateCollection(tk, e.id, fixed ? unchanged : body, e.etag) : a.createCollection(tk, body),
      );
      feel('done');
      props.onSaved(saved);
    } catch (err) {
      setProblem(
        err instanceof ApiRequestError && err.status === 409 ? t('collectionForm.changed') : wordsFor(err, t),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible onClose={props.onClose} testID="collection-form" keyboard tall>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text variant="screen">{e ? t('collectionForm.editTitle') : t('collectionForm.newTitle')}</Text>
        <Field
          label={t('collectionForm.name')}
          value={name}
          onChangeText={setName}
          maxLength={COLLECTION_NAME_MAX}
          autoCapitalize="sentences"
          testID="collection-form-name"
        />
        <Field
          label={t('collectionForm.description')}
          value={words}
          onChangeText={setWords}
          maxLength={COLLECTION_DESCRIPTION_MAX}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
          autoCapitalize="sentences"
          testID="collection-form-description"
        />
        <View style={styles.section}>
          <Text variant="secondary" weight="600" tone="soft">
            {t('collectionForm.forWhom')}
          </Text>
          {fixed ? (
            <Text testID="collection-form-audience-fixed">{t(audienceKey(audience))}</Text>
          ) : (
            <ChipRow label={t('collectionForm.forWhom')}>
              {audiences.map((a) => (
                <Chip
                  key={a}
                  label={t(audienceKey(a))}
                  selected={audience === a}
                  onPress={() => setAudience(a)}
                  testID={`collection-form-${a}`}
                />
              ))}
            </ChipRow>
          )}
        </View>
        {problem ? (
          <Notice tone="warn" testID="collection-form-problem">
            {problem}
          </Notice>
        ) : null}
        <Button
          label={e ? t('edit.save') : t('collectionForm.make')}
          busy={busy}
          disabled={nameMissing}
          onPress={() => void save()}
          testID="collection-form-save"
        />
        <Button kind="quiet" label={t('common.cancel')} disabled={busy} onPress={props.onClose} testID="collection-form-cancel" />
      </ScrollView>
    </Sheet>
  );
}

const makeStyles = () =>
  StyleSheet.create({
    scroll: { flexGrow: 0, flexShrink: 1 },
    body: { gap: sp(12) },
    section: { gap: sp(8) },
  });
