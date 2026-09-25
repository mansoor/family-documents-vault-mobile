import { useLocalSearchParams } from 'expo-router';
import { DocumentDetail } from '../../documents/detail';

/** A document (4.12): from any list — Home, Search, Needs attention, a person's. */
export default function DocumentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <DocumentDetail id={id} />;
}
