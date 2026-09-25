import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { ShowMode } from '../../show/show';

/** Show mode for a kept Essential (4.11), from its Show button on On this phone. */
export default function ShowScreen() {
  const { id, online } = useLocalSearchParams<{ id: string; online?: string }>();
  const router = useRouter();
  // Back where it came from; opened on its own (a link), Home.
  const leave = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);
  return <ShowMode id={id} onLeave={leave} online={online === '1'} />;
}
