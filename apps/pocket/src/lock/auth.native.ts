import * as LocalAuthentication from 'expo-local-authentication';
import { extra } from '../config';
import { fakeAuth, type AuthOutcome, type AuthPort, type LockLevel } from './types';

const LEVELS: Record<LocalAuthentication.SecurityLevel, LockLevel> = {
  [LocalAuthentication.SecurityLevel.NONE]: 'none',
  [LocalAuthentication.SecurityLevel.SECRET]: 'secret',
  [LocalAuthentication.SecurityLevel.BIOMETRIC_WEAK]: 'weak',
  [LocalAuthentication.SecurityLevel.BIOMETRIC_STRONG]: 'strong',
};

function outcome(error: string): AuthOutcome {
  switch (error) {
    case 'lockout':
      return 'lockout';
    case 'user_cancel':
    case 'system_cancel':
    case 'app_cancel':
    case 'user_fallback':
      return 'cancelled';
    case 'not_enrolled':
    case 'not_available':
    case 'passcode_not_set':
      return 'unavailable';
    default:
      return 'failed';
  }
}

/** The phone's own lock (expo-local-authentication); the e2e build's fake one. */
export function defaultAuth(): AuthPort {
  if (extra.fakeAuth) return fakeAuth();
  return {
    async level() {
      return LEVELS[await LocalAuthentication.getEnrolledLevelAsync()] ?? 'none';
    },
    async authenticate(prompt) {
      const r = await LocalAuthentication.authenticateAsync({
        promptMessage: prompt,
        // The PIN or pattern is always a way in: a fingerprint that will not
        // read must never lock anybody out of their own documents.
        disableDeviceFallback: false,
      });
      return r.success ? 'ok' : outcome(r.error);
    },
    cancel: () => LocalAuthentication.cancelAuthenticate(),
  };
}
