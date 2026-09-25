import { useLocalSearchParams } from 'expo-router';
import { EssentialPages } from '../../essentials/pages';

/** A kept Essential, opened from On this phone (4.10). */
export default function EssentialViewer() {
  const { id, mode } = useLocalSearchParams<{ id: string; mode?: string }>();
  return <EssentialPages id={id} {...(mode ? { mode } : {})} />;
}
