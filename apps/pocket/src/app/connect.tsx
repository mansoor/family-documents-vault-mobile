import * as Linking from 'expo-linking';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { APP_VERSION, MIN_SERVER_VERSION } from '../config';
import { CertificateTroubleNotice } from '../connect/certificate-guide';
import { connect, type ConnectDeps, type ConnectOutcome } from '../net/connect';
import { readPasted, type Pasted } from '../net/links';
import { currentNetwork, internetReachable, whyFailed } from '../net/network';
import { readVaults } from '../state/vaults';
import { useVault } from '../state/vault';
import { Button, Card, Field, Notice, Text } from '../ui';

/**
 * Connect: the address of the family's vault. Everything that can go wrong
 * here has its own sentence, and none of them is "error".
 */
export default function Connect(props: { deps?: Partial<ConnectDeps> }) {
  const { t } = useTranslation();
  const { chooseVault } = useVault();
  const [address, setAddress] = useState(() => readVaults().known.at(-1)?.origin ?? '');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ConnectOutcome | null>(null);
  // A link from the vault's own pages: held here, for the browser only (4.15).
  const [link, setLink] = useState<Exclude<Pasted, { kind: 'address' }> | null>(null);

  const deps: ConnectDeps = {
    fetch: (url, init) => globalThis.fetch(url, init as RequestInit) as never,
    network: currentNetwork,
    known: (origin) => readVaults().known.find((k) => k.origin === origin),
    clientVersion: APP_VERSION,
    minServerVersion: MIN_SERVER_VERSION,
    whyFailed,
    validated: internetReachable,
    ...props.deps,
  };

  async function run(approveHttp = false) {
    setBusy(true);
    try {
      const out = await connect(address, deps, { approveHttp });
      if (out.kind === 'ok' || out.kind === 'reinstalled') {
        setOutcome(null);
        await chooseVault(out);
        return;
      }
      setOutcome(out);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.safe}>
        <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
          <Text variant="hero">{t('connect.title')}</Text>
          <Text tone="soft">{t('connect.lead')}</Text>
          <Card>
            <Field
              testID="connect-address"
              label={t('connect.address')}
              placeholder={t('connect.addressHint')}
              value={address}
              onChangeText={(v) => {
                setOutcome(null);
                // A pasted invitation, reset or share link: its secret never stays in the field.
                const pasted = readPasted(v);
                if (pasted.kind === 'address') {
                  setAddress(v);
                  setLink(null);
                  return;
                }
                setLink(pasted);
                setAddress(pasted.kind === 'shared' ? '' : pasted.origin);
              }}
              keyboardType="url"
              textContentType="URL"
              autoComplete="url"
              returnKeyType="go"
              onSubmitEditing={() => void run()}
            />
            <Button
              testID="connect-go"
              label={t('connect.connect')}
              onPress={() => void run()}
              busy={busy}
              disabled={!address.trim()}
            />
          </Card>
          {link ? <PastedLink link={link} /> : null}
          {outcome ? <Outcome outcome={outcome} busy={busy} onApproveHttp={() => void run(true)} /> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** What a pasted link is for, and the browser to open it in. */
function PastedLink(props: { link: Exclude<Pasted, { kind: 'address' }> }) {
  const { t } = useTranslation();
  const l = props.link;
  const words =
    l.kind === 'join' ? t('connect.linkJoin') : l.kind === 'reset' ? t('connect.linkReset') : t('connect.linkShared');
  return (
    <Notice tone="info" testID={`connect-link-${l.kind}`}>
      <Text>{words}</Text>
      <Button
        testID="connect-link-open"
        kind="quiet"
        label={t('common.openInBrowser')}
        onPress={() => void Linking.openURL(l.link)}
      />
    </Notice>
  );
}

function Outcome(props: { outcome: ConnectOutcome; busy: boolean; onApproveHttp: () => void }) {
  const { t } = useTranslation();
  const o = props.outcome;
  switch (o.kind) {
    case 'invalid_address':
      return <Notice tone="danger">{t('connect.invalid')}</Notice>;
    case 'unreachable':
      return <Notice tone="danger">{t('connect.unreachable', { host: o.host })}</Notice>;
    case 'not_a_vault':
      return <Notice tone="danger">{t('connect.notAVault')}</Notice>;
    case 'api_version':
      return <Notice tone="danger">{t('connect.apiVersion', { server: o.server })}</Notice>;
    case 'server_too_old':
      return (
        <Notice tone="warn" testID="connect-server-too-old">
          <Text>{t('connect.serverTooOld', { server: o.server, needed: o.needed })}</Text>
          <Button
            kind="quiet"
            label={t('connect.showHow')}
            onPress={() => void Linking.openURL('https://github.com/mansoor/family-documents-vault#upgrading')}
          />
        </Notice>
      );
    case 'client_too_old':
      return <Notice tone="warn">{t('connect.clientTooOld', { client: o.client, needed: o.needed })}</Notice>;
    case 'setup_required':
      return (
        <Notice tone="info" testID="connect-setup-required">
          <Text>{t('connect.setupRequired')}</Text>
          <Button kind="quiet" label={t('common.openInBrowser')} onPress={() => void Linking.openURL(o.origin)} />
        </Notice>
      );
    case 'refuse_public_http':
      return <Notice tone="danger">{t('connect.refusePublicHttp')}</Notice>;
    case 'refuse_mobile_data':
      return <Notice tone="warn">{t('connect.refuseMobileData')}</Notice>;
    case 'stranger':
      return <Notice tone="danger">{t('connect.stranger', { host: o.host })}</Notice>;
    case 'certificate':
      return <CertificateTroubleNotice trouble={o.trouble} />;
    case 'captive_portal':
      return (
        <Notice tone="warn" testID="connect-captive">
          {t('connect.captivePortal')}
        </Notice>
      );
    case 'ask_http':
      return (
        <Card>
          <Text variant="title">{t('connect.askHttpTitle')}</Text>
          <Text>{t('connect.askHttp', { host: o.host })}</Text>
          <View style={styles.row}>
            <Button
              testID="connect-approve-http"
              label={t('connect.askHttpYes')}
              onPress={props.onApproveHttp}
              busy={props.busy}
            />
          </View>
        </Card>
      );
    case 'ok':
    case 'reinstalled':
      return null;
  }
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  page: { padding: 20, gap: 16 },
  row: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
});
