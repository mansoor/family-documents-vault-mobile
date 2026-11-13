import { useLocalSearchParams } from 'expo-router';
import { ChecklistScreen } from '../../collections/checklist-screen';

/** Fill from a checklist (app 0.8.0): a collection's checklist, by the collection's id. */
export default function ChecklistRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ChecklistScreen id={id} />;
}
