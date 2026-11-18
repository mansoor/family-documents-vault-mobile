import { useLocalSearchParams } from 'expo-router';
import { ChangeRequest } from '../../sharing/ask';

/** A request changed (app 0.18.0): the form it was made with, filled in, from its row in Sharing. */
export default function ChangeRequestRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ChangeRequest key={id} id={id} />;
}
