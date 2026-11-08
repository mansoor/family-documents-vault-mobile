import { useLocalSearchParams } from 'expo-router';
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
  return (
    <EssentialPages
      id={id}
      {...(mode ? { mode } : {})}
      online={online === '1'}
      {...(online === '1' && version ? { version } : {})}
    />
  );
}
