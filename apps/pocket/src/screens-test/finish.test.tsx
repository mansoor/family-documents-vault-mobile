import type { ReminderView } from '@fdv/shared';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { AccessibilityInfo, StyleSheet, Text } from 'react-native';
import AttentionScreen from '../app/attention';
import DocumentsScreen from '../app/(tabs)/documents';
import PersonScreen from '../app/person/[id]';
import { DocumentDetail } from '../documents/detail';
import { audit } from '../test-support/a11y';
import { libraryDoc, unlocked } from '../test-support/lookup';
import { installed, renderApp } from '../test-support/render';
import { push, resetRoutes } from '../test-support/router';
import { caps0519, capabilities, testVault } from '../test-support/vault';
import { Chip } from '../ui/chip';

jest.mock(
  'expo-router',
  () => jest.requireActual<typeof import('../test-support/router')>('../test-support/router').routerMock,
);

const ORIGIN = 'https://vault.test';

beforeEach(() => {
  installed();
  resetRoutes();
  jest.mocked(Haptics.notificationAsync).mockClear();
  jest.mocked(Haptics.impactAsync).mockClear();
});
afterEach(() => jest.restoreAllMocks());

function reminder(id: string): ReminderView {
  return {
    id,
    document_id: 'passport',
    document_title: 'Passport',
    kind: 'derived',
    fire_at: '2026-09-20T00:00:00Z',
    lead_days: 90,
    note: null,
    recurrence: null,
    status: 'due',
    snoozed_until: null,
    label: 'Expires in 12 days',
  } as ReminderView;
}

describe('felt (P10)', () => {
  it('Done on a reminder is felt; putting it off is not', async () => {
    const t = testVault([ORIGIN]);
    t.reminders = [reminder('r1'), reminder('r2')];
    await unlocked(t, <AttentionScreen />);
    await fireEvent.press(await screen.findByTestId('snooze-week-r1'));
    await waitFor(() => expect(t.library.snoozed).toHaveLength(1));
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('done-r2'));
    await waitFor(() => expect(t.library.acknowledged).toEqual(['r2']));
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Success);
  });

  it('Save on New note is felt, once it is kept', async () => {
    const t = testVault([ORIGIN]);
    t.caps = capabilities({ features: { ...caps0519().features, notes: true } });
    push('/new-note');
    await unlocked(t, <Text>Notes</Text>);
    await fireEvent.changeText(await screen.findByTestId('new-note-words'), 'Bins on Tuesday');
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('new-note-save'));
    await waitFor(() => expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1));
  });

  it('a phone that cannot buzz goes on as if it had', async () => {
    jest.mocked(Haptics.notificationAsync).mockRejectedValueOnce(new Error('not on this phone'));
    const t = testVault([ORIGIN]);
    t.reminders = [reminder('r1')];
    await unlocked(t, <AttentionScreen />);
    await fireEvent.press(await screen.findByTestId('done-r1'));
    expect(await screen.findByTestId('attention-calm')).toBeTruthy();
  });
});

/** How the open sheet's window comes in. */
const sheetAnimation = () => screen.root?.queryAll((n) => n.props.animationType !== undefined)[0]?.props.animationType;

describe('Remove animations (P10)', () => {
  it('a sheet is there at once when the phone asks for less movement, and fades in when it does not', async () => {
    const t = testVault([ORIGIN]);
    libraryDoc(t, { id: 'passport', title: 'Passport' });
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    await unlocked(t, <DocumentDetail id="passport" />);
    await fireEvent.press(await screen.findByTestId('document-trash'));
    await waitFor(() => expect(sheetAnimation()).toBe('none'));
  });

  it('as the phone has it by default: faded in', async () => {
    const t = testVault([ORIGIN]);
    libraryDoc(t, { id: 'passport', title: 'Passport' });
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    await unlocked(t, <DocumentDetail id="passport" />);
    await fireEvent.press(await screen.findByTestId('document-trash'));
    await act(async () => undefined);
    expect(sheetAnimation()).toBe('fade');
  });
});

describe('every screen with a screen reader and a thumb (P10, the screens since P6)', () => {
  it('All documents', async () => {
    const t = testVault([ORIGIN]);
    t.caps = capabilities({ features: { ...capabilities().features, document_table: true } });
    t.vault.state.documents.push({ id: 'p1', title: 'Passport', type_key: 'passport', tags: [], extra: {} } as never);
    await unlocked(t, <DocumentsScreen />);
    await screen.findByTestId('doc-row-p1');
    expect(audit()).toEqual([]);
  });

  it("a person's page", async () => {
    const t = testVault([ORIGIN]);
    t.vault.state.documents.push({
      id: 'p1',
      title: 'Passport',
      type_key: 'passport',
      owner_member_id: 'fake-member',
      tags: [],
      extra: {},
    } as never);
    push({ pathname: '/person/[id]', params: { id: 'fake-member', name: 'Fake Owner' } });
    await unlocked(t, <PersonScreen />);
    await screen.findByTestId('doc-row-p1');
    await waitFor(() => expect(audit()).toEqual([]));
  });
});

describe('200% text (P10)', () => {
  it("a person's initial on a chip grows with its letter: no fixed size to cut it", async () => {
    await renderApp(<Chip label="Sam" leading="S" onPress={() => undefined} testID="chip" />);
    const circle = screen.getByText('S').parent;
    const style = StyleSheet.flatten(circle?.props.style) ?? {};
    expect(style).toEqual(expect.objectContaining({ minWidth: 28, minHeight: 28 }));
    expect(style.width).toBeUndefined();
    expect(style.height).toBeUndefined();
  });
});
