import {
  documentName,
  formatDate,
  issuedByLabel,
  LEVEL_WORDS,
  READ_FAILURE_WORDS,
  untouchedAccept,
  type BatchDetail,
  type BatchItemView,
  type DocumentTypeView,
  type Member,
} from '@fdv/shared';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { wordsFor } from '../errors/words';
import { useCapture } from '../state/capture';
import { useVault } from '../state/vault';
import { Button, Card, Notice, Text } from '../ui';
import { sp } from '../ui/space';

/**
 * What the vault read of a scan sent to the Inbox (P3; the owner's decision
 * of 7 Nov 2026: the vault reads a scan, never the phone). Under Home's
 * Saved line, once the scan is in: "Reading…" while the vault reads it,
 * then what it read: the kind, whose it is, the issuer, the dates, the
 * number, and anything the vault is unsure of, in the vault's own words.
 *
 * Confirm files it as the web would file it untouched (@fdv/shared's
 * untouchedAccept, as Accept all Ready does), and only while the vault
 * calls it Ready. Anything the vault is unsure of, a file the vault already
 * has, a probable new version of a document, or pages it couldn't read:
 * finished in the browser, where the card can be changed. Never filed
 * unasked.
 */

/** While the vault reads it: asked again this often, for this long (3 minutes). */
const READING_EVERY_MS = 5_000;
const READING_TRIES = 36;

type Seen =
  | { kind: 'reading' }
  | { kind: 'slow' }
  | { kind: 'read'; batch: BatchDetail; item: BatchItemView }
  | { kind: 'gone' };

export function VaultRead(props: { batch: string; item: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { withToken, vault, who } = useVault();
  const capture = useCapture();
  const [seen, setSeen] = useState<Seen>({ kind: 'reading' });
  const [card, setCard] = useState<{ types: DocumentTypeView[]; members: Member[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filed, setFiled] = useState<{ id: string; title: string } | null>(null);

  useEffect(() => {
    let stopped = false;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const look = async () => {
      try {
        const batch = await withToken((a, token) => a.batch(token, props.batch));
        if (stopped) return;
        const item = batch.items.find((i) => i.id === props.item);
        if (!item || item.document_id) {
          // Removed, or filed already (on the web): nothing more to say here.
          setSeen({ kind: 'gone' });
          return;
        }
        if (item.reading === 'read' || item.reading === 'failed') {
          setSeen({ kind: 'read', batch, item });
          return;
        }
        if (tries >= READING_TRIES) {
          setSeen({ kind: 'slow' });
          return;
        }
        tries += 1;
        timer = setTimeout(() => void look(), READING_EVERY_MS);
      } catch {
        // No answer now: the scan is safe in the Inbox, and the browser has it.
        if (!stopped) setSeen({ kind: 'slow' });
      }
    };
    void look();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [withToken, props.batch, props.item]);

  // The family's kinds and people, as the capture card last kept them: for names, and for Confirm.
  useEffect(() => {
    let stopped = false;
    void capture.cardData().then((d) => {
      if (!stopped && d) setCard({ types: d.types, members: d.members });
    });
    return () => {
      stopped = true;
    };
  }, [capture]);

  const inBrowser = () =>
    vault
      ? void Linking.openURL(`${vault.origin}/inbox/batches/${props.batch}/items/${props.item}`)
      : undefined;
  const browserButton = (
    <Button testID="vault-read-browser" kind="quiet" label={t('vaultRead.inBrowser')} onPress={inBrowser} />
  );

  if (seen.kind === 'gone') return null;
  if (filed) {
    return (
      <Notice tone="ok" testID="vault-read-filed" announce={t('vaultRead.filed', { title: filed.title })}>
        <Text>{t('vaultRead.filed', { title: filed.title })}</Text>
        <Button
          testID="vault-read-open"
          kind="quiet"
          label={t('vaultRead.open')}
          onPress={() => router.push({ pathname: '/document/[id]', params: { id: filed.id } })}
        />
      </Notice>
    );
  }
  if (seen.kind === 'reading') {
    return (
      <Text tone="soft" variant="secondary" testID="vault-read-reading">
        {t('vaultRead.reading')}
      </Text>
    );
  }
  if (seen.kind === 'slow') {
    return (
      <Card>
        <View testID="vault-read-slow" style={styles.inside}>
          <Text tone="soft">{t('vaultRead.slow')}</Text>
          {browserButton}
        </View>
      </Card>
    );
  }

  const { batch, item } = seen;
  const p = item.proposals ?? null;
  const type = card?.types.find((x) => x.key === p?.type_key?.value);
  const person = card?.members.find((m) => m.id === p?.owner_member_id?.value);
  const facts: [string, string | null | undefined][] = p
    ? [
        [t('vaultRead.kind'), type?.label ?? null],
        [t('vaultRead.whose'), person?.display_name ?? null],
        [issuedByLabel(type), p.issued_by?.value],
        [t('document.issued'), p.issued ? formatDate(p.issued.value) : null],
        [t('document.expires'), p.expires ? formatDate(p.expires.value) : null],
        [t('vaultRead.number'), p.identifier?.value],
      ]
    : [];
  const unsure = (item.tags ?? []).filter((tag) => tag.kind !== 'info');
  const renewal = (item.renewals ?? [])[0];
  // Filed from here only as the vault would file it untouched, and only while it calls it Ready.
  const mayConfirm =
    item.reading === 'read' &&
    item.level === 'ready' &&
    !!p &&
    !item.duplicate &&
    !renewal &&
    !!card &&
    !!who &&
    unsure.length === 0;

  const confirm = async () => {
    if (!p || !card || !who || busy) return;
    setBusy(true);
    setError(null);
    try {
      const body = untouchedAccept({
        proposals: p,
        defaults: batch.defaults,
        types: card.types,
        people: card.members,
        role: who.role,
        me: who.member_id,
      });
      const done = await withToken((a, token) => a.acceptBatchItem(token, batch.id, item.id, body));
      const title = documentName({ title: body.title ?? null, type_key: body.type_key ?? null }, t('home.needsAName'));
      setFiled({ id: done.document_id, title });
    } catch (err) {
      setError(wordsFor(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <View testID="vault-read" style={styles.inside}>
        <Text variant="screen">{t('vaultRead.title')}</Text>
        {item.reading === 'failed' ? (
          <Text testID="vault-read-failed">
            {item.read_failure ? READ_FAILURE_WORDS[item.read_failure] : t('vaultRead.couldNotRead')}
          </Text>
        ) : (
          <>
            {item.level ? (
              <Text weight="600" tone={item.level === 'ready' ? 'accent' : 'warn'} testID="vault-read-level">
                {LEVEL_WORDS[item.level]}
              </Text>
            ) : null}
            {facts
              .filter(([, value]) => value)
              .map(([label, value]) => (
                <View key={label} style={styles.fact}>
                  <Text tone="soft" variant="secondary">
                    {label}
                  </Text>
                  <Text>{value}</Text>
                </View>
              ))}
            {unsure.map((tag) => (
              <Text key={`${tag.code}:${tag.words}`} tone="warn" variant="secondary">
                {tag.words}
              </Text>
            ))}
            {item.duplicate ? <Text tone="soft">{t('vaultRead.duplicate')}</Text> : null}
            {renewal ? <Text tone="soft">{t('vaultRead.newVersionOf', { title: renewal.title })}</Text> : null}
          </>
        )}
        {error ? (
          <Notice tone="warn" testID="vault-read-error">
            {error}
          </Notice>
        ) : null}
        {mayConfirm ? (
          <Button testID="vault-read-confirm" label={t('vaultRead.confirm')} busy={busy} onPress={() => void confirm()} />
        ) : (
          <Text tone="soft" variant="secondary">
            {t('vaultRead.finishThere')}
          </Text>
        )}
        {browserButton}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  inside: { gap: sp(10) },
  fact: { gap: sp(4) },
});
