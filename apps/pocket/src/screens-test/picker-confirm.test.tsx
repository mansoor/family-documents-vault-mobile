import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useState } from 'react';
import { Text } from 'react-native';
import Settings from '../app/settings';
import { DocumentDetail } from '../documents/detail';
import { audit } from '../test-support/a11y';
import { libraryDoc, unlocked } from '../test-support/lookup';
import { installed, renderApp, signedIn } from '../test-support/render';
import { resetRoutes } from '../test-support/router';
import { testVault } from '../test-support/vault';
import { ChipLine, PickerSheet, type PickOption } from '../ui/picker';

jest.mock(
  'expo-router',
  () => jest.requireActual<typeof import('../test-support/router')>('../test-support/router').routerMock,
);

const ORIGIN = 'https://vault.test';

beforeEach(() => {
  installed();
  resetRoutes();
});

const KINDS: PickOption[] = [
  { value: 'passport', label: 'Passport', group: 'Identity' },
  { value: 'licence', label: 'Driving licence', group: 'Identity' },
  { value: 'birth', label: 'Birth certificate', group: 'Identity' },
  { value: 'bank', label: 'Bank statement', group: 'Money' },
  { value: 'card', label: 'Credit card statement', group: 'Money' },
  { value: 'bill', label: 'Utility / bill', short: 'Bill', group: 'Home' },
];

/** A line and its picker, as a screen holds them. */
function Kinds(props: { multi?: boolean; start?: string[] }) {
  const [chosen, setChosen] = useState<string[]>(props.start ?? []);
  const [open, setOpen] = useState(false);
  return (
    <>
      <ChipLine
        label="Kind"
        options={KINDS}
        chosen={chosen}
        onToggle={(v) => setChosen((c) => (c.includes(v) ? c.filter((x) => x !== v) : props.multi ? [...c, v] : [v]))}
        onMore={() => setOpen(true)}
        moreID="kinds-more"
        expanded={open}
        chipID="kind"
      />
      <PickerSheet
        visible={open}
        title="Kind"
        options={KINDS}
        chosen={chosen}
        multi={props.multi === true}
        onDone={(v) => {
          setChosen(v);
          setOpen(false);
        }}
        onClose={() => setOpen(false)}
        testID="kinds"
        findID="kinds-find"
        optionID="pick"
      />
      <Text testID="chosen">{chosen.join(',')}</Text>
    </>
  );
}

describe('a long list on one line, the rest in a picker (R2)', () => {
  it('three on the line, then ⋯ with how many more; what is chosen comes first', async () => {
    await renderApp(<Kinds start={['bill']} />);
    expect(screen.getByTestId('kind-bill')).toHaveTextContent('Bill');
    expect(screen.getByTestId('kind-passport')).toBeTruthy();
    expect(screen.getByTestId('kind-licence')).toBeTruthy();
    expect(screen.queryByTestId('kind-birth')).toBeNull();
    expect(screen.getByTestId('kinds-more')).toHaveTextContent('+3');
    expect(screen.getByTestId('kinds-more').props.accessibilityLabel).toBe('More choices for Kind: 3 more');
    expect(audit()).toEqual([]);
  });

  it('one choice: found by words under its group, a tap chooses it and closes the picker', async () => {
    await renderApp(<Kinds />);
    await fireEvent.press(screen.getByTestId('kinds-more'));
    expect(screen.getByTestId('kinds-more').props.accessibilityState).toEqual({ expanded: true, disabled: false });
    expect(screen.getByText('MONEY')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('kinds-find'), 'card');
    expect(screen.queryByTestId('pick-bank')).toBeNull();
    expect(screen.queryByText('IDENTITY')).toBeNull();
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByTestId('pick-card'));
    expect(screen.getByTestId('chosen')).toHaveTextContent('card');
    // Chosen, it comes onto the line, first.
    await waitFor(() => expect(screen.getByTestId('kind-card').props.accessibilityState.selected).toBe(true));
  });

  it('nothing found, said so', async () => {
    await renderApp(<Kinds />);
    await fireEvent.press(screen.getByTestId('kinds-more'));
    await fireEvent.changeText(screen.getByTestId('kinds-find'), 'boat');
    expect(screen.getByTestId('kinds-none')).toHaveTextContent('Nothing matches those words.');
  });

  it('several: ticked, counted, cleared, and kept only with Done', async () => {
    await renderApp(<Kinds multi />);
    await fireEvent.press(screen.getByTestId('kinds-more'));
    await fireEvent.press(screen.getByTestId('pick-bank'));
    await fireEvent.press(screen.getByTestId('pick-bill'));
    expect(screen.getByText('2 chosen')).toBeTruthy();
    expect(screen.getByTestId('pick-bank').props.accessibilityState).toEqual(expect.objectContaining({ checked: true }));
    expect(screen.getByTestId('chosen')).toHaveTextContent('');
    await fireEvent.press(screen.getByTestId('kinds-clear'));
    await fireEvent.press(screen.getByTestId('pick-passport'));
    await fireEvent.press(screen.getByTestId('kinds-done'));
    expect(screen.getByTestId('chosen')).toHaveTextContent('passport');
  });
});

describe('asked first, before anything is lost (R2)', () => {
  it("Essential off on a document's page: asked, and Cancel keeps it an Essential", async () => {
    const t = testVault([ORIGIN]);
    libraryDoc(t, { id: 'passport', title: 'Passport', is_essential: true });
    await unlocked(t, <DocumentDetail id="passport" />);
    await fireEvent(await screen.findByTestId('document-essential'), 'valueChange', false);
    expect(await screen.findByText('Stop keeping it as an Essential?')).toBeTruthy();
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByTestId('essential-off-cancel'));
    expect(screen.getByTestId('document-essential').props.value).toBe(true);
    expect(t.library.documents.get('passport')?.is_essential).toBe(true);
  });

  it('signing out with nothing waiting: asked, and Cancel stays signed in', async () => {
    const t = testVault([ORIGIN]);
    await signedIn(t);
    await renderApp(<Settings />, { fetch: t.fetch });
    await fireEvent.press(await screen.findByTestId('settings-sign-out'));
    expect(await screen.findByText('Sign out of this vault?')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('sign-out-no'));
    expect(t.calls).not.toContain(`POST ${ORIGIN}/api/v1/auth/logout`);
    expect(screen.getByTestId('settings-sign-out')).toBeTruthy();
  });
});
