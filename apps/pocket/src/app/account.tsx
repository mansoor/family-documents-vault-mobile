import { ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AccessCard } from '../access/access';
import { SignedInDevices } from '../settings/devices';
import { MobileNumber } from '../settings/mobile-number';
import { ChangePassword } from '../settings/password';
import { TextCodes } from '../settings/text-codes';
import { TwoStep } from '../settings/two-step';
import { VaultCard } from '../settings/vault-card';
import { sp } from '../ui/space';

/**
 * Account (P6, under More): which vault this phone uses and who is signed
 * in to it, with Use another vault; what a guest may see, and until when;
 * their password and two-step sign-in, changed here (the owner's ask of 12
 * Nov 2026); and every device signed in as this person, any of them signed
 * out from here. Their mobile number and codes by text (SMS4), where the
 * vault has texts. Settings holds only settings.
 */
export default function AccountScreen() {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView testID="account" contentContainerStyle={[styles.page, { paddingBottom: sp(20) + insets.bottom }]}>
      <VaultCard />
      <AccessCard />
      <ChangePassword />
      <TwoStep />
      <MobileNumber />
      <TextCodes />
      <SignedInDevices />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: sp(20), gap: sp(16) },
});
