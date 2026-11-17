import { useLocalSearchParams } from 'expo-router';
import { EmergencyPage } from '../../emergency/page';

/** One person's emergency information (app 0.15.0, H4): from More, or their page. */
export default function EmergencyRoute() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  return <EmergencyPage key={id} id={id ?? ''} {...(name ? { name } : {})} />;
}
