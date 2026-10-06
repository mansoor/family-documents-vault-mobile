import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import * as Linking from 'expo-linking';
import { StyleSheet } from 'react-native';
import { DocumentDetail } from '../documents/detail';
import { noteAddress } from '../documents/notes';
import { audit } from '../test-support/a11y';
import { libraryDoc, unlocked } from '../test-support/lookup';
import { installed } from '../test-support/render';
import { resetRoutes } from '../test-support/router';
import { testVault, type TestVault } from '../test-support/vault';

jest.mock(
  'expo-router',
  () => jest.requireActual<typeof import('../test-support/router')>('../test-support/router').routerMock,
);
jest.mock('expo-linking', () => ({ openURL: jest.fn(async () => true) }));

const ORIGIN = 'https://vault.test';
/** Unicode's isolates: round an address (left to right), and round a link's words (their own direction). */
const LRI = String.fromCodePoint(0x2066);
const FSI = String.fromCodePoint(0x2068);
const PDI = String.fromCodePoint(0x2069);
/** A right-to-left override: what follows reads backwards. */
const RLO = String.fromCodePoint(0x202e);
/** A Cyrillic small a (U+0430), which looks like a Latin a. */
const CYRILLIC_A = String.fromCodePoint(0x430);
const LOOK_ALIKE = `https://${CYRILLIC_A}pple.com/id`;

beforeEach(() => {
  installed();
  resetRoutes();
  jest.mocked(Linking.openURL).mockClear();
});

/** A document whose note is `notes`, from a vault of 0.5.35 or later (it says when a note changed). */
async function withNote(notes: string, t: TestVault = testVault([ORIGIN])) {
  libraryDoc(t, {
    id: 'water',
    title: 'Water bill',
    notes,
    notes_updated_at: '2026-09-25T15:12:00Z',
    notes_updated_by_name: 'Sarah',
  });
  await unlocked(t, <DocumentDetail id="water" />);
  return within(await screen.findByTestId('note'));
}

describe("a document's note (5.36)", () => {
  it('is drawn from the shared tree as Text: bold, italic, a heading, lists and a checklist that cannot be ticked', async () => {
    const note = await withNote(
      [
        '### Where it is',
        'The **blue** folder, *top* shelf.',
        '- the bill',
        '- the meter photo',
        '1. pay',
        '2. file',
        '- [x] read the meter',
        '- [ ] ring them',
      ].join('\n'),
    );
    expect(note.getByRole('header')).toHaveTextContent('Where it is');
    expect(StyleSheet.flatten(note.getByText('blue').props.style)).toEqual(
      expect.objectContaining({ fontWeight: '700' }),
    );
    expect(StyleSheet.flatten(note.getByText('top').props.style)).toEqual(
      expect.objectContaining({ fontStyle: 'italic' }),
    );
    expect(note.getAllByTestId('note-item')).toHaveLength(6);
    expect(note.getByText('1.')).toBeTruthy();
    expect(note.getByText('2.')).toBeTruthy();
    expect(note.getAllByText('•')).toHaveLength(2);
    // A checklist's boxes are said in words, and are nothing to press.
    expect(note.getByTestId('note-box-done').props.accessibilityLabel).toBe('Done');
    expect(note.getByTestId('note-box-to-do').props.accessibilityLabel).toBe('To do');
    expect(note.getByTestId('note-box-done').props.onClick).toBeUndefined();
    expect(note.queryByRole('checkbox')).toBeNull();
    // Who changed it, and when, as the vault says it.
    expect(screen.getByTestId('document-notes-edited')).toHaveTextContent(/^Edited 25 Sept 2026, .+ by Sarah$/);
    expect(screen.getByTestId('document-notes')).toHaveTextContent(/^Notes/);
    expect(audit()).toEqual([]);
  });

  it("a note's link asks first", async () => {
    const note = await withNote('Pay at [the council](HTTPS://Council.EXAMPLE:443/pay) or mail@example.test.');
    const link = note.getByTestId('note-link');
    // Its address is shown with its words, as it will be opened: the URL parser's own form.
    expect(link).toHaveTextContent(`${FSI}the council${PDI} (${LRI}https://council.example/pay${PDI})`);
    expect(link.props.accessibilityRole).toBe('link');
    await fireEvent.press(link);
    // Asked, and nothing opened yet.
    const question = within(await screen.findByTestId('note-link-question'));
    expect(question.getByText(`Open ${LRI}https://council.example/pay${PDI} in your browser?`)).toBeTruthy();
    expect(Linking.openURL).not.toHaveBeenCalled();
    expect(audit()).toEqual([]);
    // Cancel is an answer: nothing opens.
    await fireEvent.press(screen.getByTestId('note-link-cancel'));
    await waitFor(() => expect(screen.queryByTestId('note-link-question')).toBeNull());
    expect(Linking.openURL).not.toHaveBeenCalled();
    // Open opens what was shown.
    await fireEvent.press(note.getByTestId('note-link'));
    await fireEvent.press(await screen.findByTestId('note-link-open'));
    expect(Linking.openURL).toHaveBeenCalledWith('https://council.example/pay');
  });

  it('a mailto link asks too, for the email app', async () => {
    const note = await withNote('[Write to us](mailto:help@example.test)');
    await fireEvent.press(note.getByTestId('note-link'));
    const question = within(await screen.findByTestId('note-link-question'));
    expect(question.getByText(`Open ${LRI}mailto:help@example.test${PDI} in your email app?`)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('note-link-open'));
    expect(Linking.openURL).toHaveBeenCalledWith('mailto:help@example.test');
  });

  it('a note with <script> shows as text', async () => {
    const note = await withNote('<script>alert(1)</script> and <img src=x onerror=alert(2)> **still bold**');
    expect(screen.getByTestId('note')).toHaveTextContent(
      '<script>alert(1)</script> and <img src=x onerror=alert(2)> still bold',
    );
    expect(StyleSheet.flatten(note.getByText('still bold').props.style)).toEqual(
      expect.objectContaining({ fontWeight: '700' }),
    );
    expect(note.queryByTestId('note-link')).toBeNull();
  });

  it('javascript: and data: links stay text, exactly as written', async () => {
    const note = await withNote('[click](javascript:alert(1)) [see](data:text/html,hi) javascript:alert(2)');
    expect(screen.getByTestId('note')).toHaveTextContent(
      '[click](javascript:alert(1)) [see](data:text/html,hi) javascript:alert(2)',
    );
    expect(note.queryByTestId('note-link')).toBeNull();
    expect(note.queryByRole('link')).toBeNull();
  });

  it('a right-to-left override inside a link: never part of one, and the address before it is isolated', async () => {
    // "the form" going to .../<RLO>txt.exe, which reads as .../exe.txt: not a link with those words.
    const note = await withNote(`[the form](https://example.com/${RLO}txt.exe) and https://bank.example@evil.example/`);
    // The shared parser stops a written-out address at the override; a name before a host is no link at all.
    const links = note.getAllByTestId('note-link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveTextContent(`${LRI}https://example.com/${PDI}`);
    expect(screen.getByTestId('note')).toHaveTextContent(
      `[the form](${LRI}https://example.com/${PDI}${RLO}txt.exe) and https://bank.example@evil.example/`,
    );
    // Asked of the phone's own drawing too: an address with an override in it is none.
    expect(noteAddress(`https://example.com/${RLO}txt.exe`)).toBeNull();
    expect(noteAddress(`https://example.com/${String.fromCodePoint(0x200b)}txt`)).toBeNull();
    // What opens is what was shown.
    await fireEvent.press(links[0] as NonNullable<(typeof links)[0]>);
    await fireEvent.press(await screen.findByTestId('note-link-open'));
    expect(Linking.openURL).toHaveBeenCalledWith('https://example.com/');
  });

  it('a Cyrillic look-alike host stays text, never a link to somewhere it does not look like', async () => {
    // The same host, written out and with escapes; and the real one.
    const note = await withNote(`[Apple](${LOOK_ALIKE}) or https://%D0%B0pple.com/id or https://apple.com/id`);
    // Only the plain one is a link.
    const links = note.getAllByTestId('note-link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveTextContent(`${LRI}https://apple.com/id${PDI}`);
    expect(screen.getByTestId('note')).toHaveTextContent(
      `Apple (${LOOK_ALIKE}) or https://%D0%B0pple.com/id or ${LRI}https://apple.com/id${PDI}`,
    );
  });

  it("why: the phone's URL parser, here as on the phone, leaves such a host as written; a browser's makes it punycode", () => {
    // Jest runs with Expo's runtime, whose URL is the phone's (whatwg-url-minimum, no Unicode hosts).
    expect(new URL(LOOK_ALIKE).href).toBe(LOOK_ALIKE);
    expect(new URL('https://%D0%B0pple.com/id').href).toBe(LOOK_ALIKE);
    const { URL: Browsers } = jest.requireActual<typeof import('node:url')>('node:url');
    expect(new Browsers(LOOK_ALIKE).href).toBe('https://xn--pple-43d.com/id');
    // So such a host is text here; a plain one is as the web shows it.
    expect(noteAddress(LOOK_ALIKE)).toBeNull();
    expect(noteAddress('https://%D0%B0pple.com/id')).toBeNull();
    expect(noteAddress(`https://b${String.fromCodePoint(0xfc)}cher.example/`)).toBeNull();
    expect(noteAddress('HTTPS://Example.COM:443/a?c=d#e')).toBe('https://example.com/a?c=d#e');
    expect(noteAddress('http://192.168.1.20:8080/x')).toBe('http://192.168.1.20:8080/x');
    // An address the parser cannot read at all is no link either.
    expect(noteAddress('http://example.com:99999/')).toBeNull();
    expect(noteAddress('mailto:help@example.test')).toBe('mailto:help@example.test');
  });

  it('nothing new appears on an older vault: no note is drawn without its change stamp', async () => {
    const t = testVault([ORIGIN]);
    // A vault before 0.5.35 has notes as plain text, and says nothing of when they changed.
    libraryDoc(t, { id: 'water', title: 'Water bill', notes: 'Paid by **direct debit**' });
    await unlocked(t, <DocumentDetail id="water" />);
    expect(await screen.findByText('Water bill')).toBeTruthy();
    await screen.findByTestId('version-1');
    expect(screen.queryByTestId('document-notes')).toBeNull();
    expect(screen.queryByText(/direct debit/)).toBeNull();
  });
});
