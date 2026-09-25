import { useLocalSearchParams } from 'expo-router';
import { EssentialPages } from '../../essentials/pages';

/** A kept Essential, opened from On this phone (4.10). */
export default function EssentialViewer() {
  const { id, mode, online } = useLocalSearchParams<{ id: string; mode?: string; online?: string }>();
  return <EssentialPages id={id} {...(mode ? { mode } : {})} online={online === '1'} />;
}
