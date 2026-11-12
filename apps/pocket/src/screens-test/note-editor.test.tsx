import { extractTextFromImage } from 'expo-text-extractor';
import { scanDocument } from '@preeternal/react-native-document-scanner-plugin';
import { fireEvent, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { NoteEditor } from '../documents/note-editor';
import { audit } from '../test-support/a11y';
import { installed, renderApp } from '../test-support/render';

/**
 * The notes editor on the phone (the owner's ask of 12 Nov 2026): the web's
 * toolbar on the note's words, Write and Preview, and Scan text.
 */

function Harness(props: { start?: string }) {
  const [words, setWords] = useState(props.start ?? '');
  return <NoteEditor label="Words" value={words} onChange={setWords} testID="words" />;
}

beforeEach(() => installed());

describe('the notes editor', () => {
  it('the toolbar acts on the words; Preview draws them as the note will be', async () => {
    await renderApp(<Harness start="Boiler" />);
    const box = await screen.findByTestId('words');
    await fireEvent(box, 'selectionChange', { nativeEvent: { selection: { start: 0, end: 6 } } });
    await fireEvent.press(screen.getByTestId('words-bold'));
    expect(screen.getByTestId('words').props.value).toBe('**Boiler**');
    await fireEvent.press(screen.getByTestId('words-heading2'));
    expect(screen.getByTestId('words').props.value).toBe('## **Boiler**');
    expect(screen.getByTestId('words-toolbar').props.accessibilityRole).toBe('toolbar');
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByTestId('words-preview'));
    expect(await screen.findByTestId('words-shown')).toHaveTextContent('Boiler');
    expect(screen.queryByTestId('words')).toBeNull();
    await fireEvent.press(screen.getByTestId('words-write'));
    expect(await screen.findByTestId('words')).toBeTruthy();
  });

  it('Scan text: a page read on the phone, its words put in where the cursor is', async () => {
    jest.mocked(scanDocument).mockResolvedValueOnce({ status: 'success', scannedImages: ['/tmp/page.jpg'] } as never);
    jest.mocked(extractTextFromImage).mockResolvedValueOnce(['Gate code 4821', '']);
    await renderApp(<Harness start="Where things are" />);
    const box = await screen.findByTestId('words');
    await fireEvent(box, 'selectionChange', { nativeEvent: { selection: { start: 16, end: 16 } } });
    await fireEvent.press(screen.getByTestId('words-scan'));
    await screen.findByDisplayValue('Where things are\nGate code 4821');
    expect(extractTextFromImage).toHaveBeenCalledWith('file:///tmp/page.jpg');
  });

  it('a page with no words on it: said, and nothing put in', async () => {
    jest.mocked(scanDocument).mockResolvedValueOnce({ status: 'success', scannedImages: ['file:///tmp/blank.jpg'] } as never);
    jest.mocked(extractTextFromImage).mockResolvedValueOnce(['  ']);
    await renderApp(<Harness start="x" />);
    await fireEvent.press(await screen.findByTestId('words-scan'));
    expect(await screen.findByTestId('words-scan-said')).toHaveTextContent(/No words were found/);
    expect(screen.getByTestId('words').props.value).toBe('x');
  });
});
