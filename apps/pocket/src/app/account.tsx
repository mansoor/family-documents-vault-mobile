import type { RecoveryCodesMade } from '@fdv/shared';
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AccessCard } from '../access/access';
import { SignedInDevices } from '../settings/devices';
import { MobileNumber } from '../settings/mobile-number';
import { ChangePassword } from '../settings/password';
import { makeCodesIfNone, RecoveryCodesCard, RecoveryCodesSheet, SecurityQuestionsCard } from '../settings/recovery';
import { TextCodes } from '../settings/text-codes';
import { TwoStep } from '../settings/two-step';
import { VaultCard } from '../settings/vault-card';
import { useStepUp } from '../state/step-up';
import { useVault } from '../state/vault';
import { FormScroll } from '../ui/keyboard';
import { sp } from '../ui/space';

/**
 * Account (P6, under More): which vault this phone uses and who is signed
 * in to it, with Use another vault; what a guest may see, and until when;
 * their password and two-step sign-in, changed here (the owner's ask of 12
 * Nov 2026); and every device signed in as this person, any of them signed
 * out from here. Their mobile number and codes by text (SMS4), where the
 * vault has texts. Settings holds only settings. Recovery codes and
 * security questions (0.9.0-dev.104), where the vault has them: a second
 * step set up here with no recovery codes yet has ten made beside it,
 * shown once.
 */
export default function AccountScreen() {
  const insets = useSafeAreaInsets();
  const { caps, withToken } = useVault();
  const { guarded } = useStepUp();
  const [justMade, setJustMade] = useState<RecoveryCodesMade | null>(null);
  const secondStepSetUp = () => {
    if (caps?.features.recovery_codes !== true) return;
    void makeCodesIfNone(withToken, guarded).then(
      (made) => {
        if (made) setJustMade(made);
      },
      () => undefined,
    );
  };
  return (
    <FormScroll testID="account" contentContainerStyle={[styles.page, { paddingBottom: sp(20) + insets.bottom }]}>
      <VaultCard />
      <AccessCard />
      <ChangePassword />
      <TwoStep onTurnedOn={secondStepSetUp} />
      <MobileNumber />
      <TextCodes onTurnedOn={secondStepSetUp} />
      <RecoveryCodesCard refresh={justMade} />
      <SecurityQuestionsCard />
      <SignedInDevices />
      <RecoveryCodesSheet made={justMade} onKept={() => setJustMade(null)} />
    </FormScroll>
  );
}

const styles = StyleSheet.create({
  page: { padding: sp(20), gap: sp(16) },
});
