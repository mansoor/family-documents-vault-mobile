import { useLocalSearchParams } from 'expo-router';
import { EmergencyEditor } from '../../../emergency/editor';

/** Editing a person's emergency information (app 0.19.0, H4): from their emergency page. */
export default function EmergencyEditRoute() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  return <EmergencyEditor key={id} id={id ?? ''} {...(name ? { name } : {})} />;
}
