import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EssentialPages } from '../../essentials/pages';

/** A kept Essential, opened from On this phone (4.10). */
export default function EssentialViewer() {
  const { id, mode, online, version } = useLocalSearchParams<{
    id: string;
    mode?: string;
    online?: string;
    /** An older version, from a document's history (P2): online only. */
    version?: string;
  }>();
  // The pages have the whole screen, below the phone's own bar (the owner's ask of 11 Nov 2026).
  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top']}>
    <EssentialPages
      id={id}
      {...(mode ? { mode } : {})}
      online={online === '1'}
      {...(online === '1' && version ? { version } : {})}
    />
    </SafeAreaView>
  );
}
