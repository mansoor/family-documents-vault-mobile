import { fireEvent, screen } from '@testing-library/react-native';
import Home from '../app/(tabs)/index';
import { AddButton } from '../capture/add-button';

/** Home as the phone lays it out (4.12): with the tab bar's + below it. */
export default function HomeWithAdd() {
  return (
    <>
      <Home />
      <AddButton />
    </>
  );
}

/** The +, then one of its choices: Camera, Add a file or Add a picture. */
export async function add(choice: 'add-camera' | 'add-file' | 'add-picture' = 'add-camera') {
  await fireEvent.press(await screen.findByTestId('home-add'));
  await fireEvent.press(await screen.findByTestId(choice));
}
