import { useLocalSearchParams } from 'expo-router';
import { AskForDocuments } from '../../sharing/ask';

/** Ask for documents (app 0.18.0): from Sharing; with `person`, whose they probably are, for whoever reviews. */
export default function AskRoute() {
  const { person } = useLocalSearchParams<{ person?: string }>();
  return <AskForDocuments {...(person ? { person } : {})} />;
}
