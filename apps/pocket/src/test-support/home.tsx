import Home from '../app/(tabs)/index';
import { ScanButton } from '../capture/scan-button';

/** Home as the phone lays it out (4.12): with the tab bar's camera below it. */
export default function HomeWithCamera() {
  return (
    <>
      <Home />
      <ScanButton />
    </>
  );
}
