import { act, render, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, Text } from 'react-native';
import { useReduceMotion } from './feel';

/** What each drawing of it said, first to last. */
function Probe(props: { seen: boolean[] }) {
  const still = useReduceMotion();
  props.seen.push(still);
  return <Text>{still ? 'still' : 'moving'}</Text>;
}

describe('less movement, as the phone asks (P10)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('a part drawn later starts from what the phone last said, and asks again', async () => {
    // The phone asks for less movement: the first part learns it a moment after it is drawn.
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const first: boolean[] = [];
    await render(<Probe seen={first} />);
    await waitFor(() => expect(first.at(-1)).toBe(true));

    // The + drawn after sign-in knows at once, before its own question is answered:
    // a menu opened then never starts to move only to be stopped mid-way (14 Nov 2026).
    let answer: (on: boolean) => void = () => undefined;
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockImplementation(() => new Promise<boolean>((resolve) => (answer = resolve)));
    const later: boolean[] = [];
    await render(<Probe seen={later} />);
    expect(later).not.toContain(false);

    // And it still follows the phone when that changes.
    await act(async () => answer(false));
    await waitFor(() => expect(later.at(-1)).toBe(false));
  });
});
