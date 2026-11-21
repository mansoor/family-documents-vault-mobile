import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useLock } from '../state/lock';
import { useVault } from '../state/vault';
import { usePush } from './push';

/**
 * A tapped notification (4.14) opens where it said — Needs attention, or
 * Settings for a new device — only once the app is signed in and
 * unlocked. The tap carries one word and nothing else: no token, and no
 * action is taken for it.
 */
export function PushLinks() {
  const { phase, blocked, twoStep } = useVault();
  const { status } = useLock();
  const { opened, takeOpen } = usePush();
  const router = useRouter();
  useEffect(() => {
    if (phase !== 'ready' || (status !== 'unlocked' && status !== 'none')) return;
    // Held back (0.20.0: the app to update, two-step sign-in first): the tap waits, untaken, until not.
    if (blocked !== null || twoStep !== null) return;
    const word = takeOpen();
    if (word === 'needs-attention') router.push('/attention');
    else if (word === 'devices') router.push('/settings');
  }, [phase, status, opened, takeOpen, router, blocked, twoStep]);
  return null;
}
