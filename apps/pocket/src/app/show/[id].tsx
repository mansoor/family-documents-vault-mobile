import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { ShowMode } from '../../show/show';

/** Show mode for a kept Essential (4.11), from its Show button on On this phone. */
export default function ShowScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const leave = useCallback(() => {
    if (router.canGoBack()) router.back();
  }, [router]);
  return <ShowMode id={id} onLeave={leave} />;
}
