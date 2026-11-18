import { useLocalSearchParams } from 'expo-router';
import { ActivityScreen } from '../activity/screen';

/** Activity (app 0.17.0): the household's, from More; one document's, from its page. */
export default function ActivityRoute() {
  const { document } = useLocalSearchParams<{ document?: string }>();
  return <ActivityScreen key={document ?? ''} {...(document ? { document } : {})} />;
}
