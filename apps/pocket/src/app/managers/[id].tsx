import { useLocalSearchParams } from 'expo-router';
import { ManagersScreen } from '../../collections/managers';

/** A collection's managers (app 0.10.0), by the collection's id, its name as its page had it. */
export default function ManagersRoute() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  return <ManagersScreen id={id} name={name ?? ''} />;
}
