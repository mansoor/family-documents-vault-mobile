import {
  colours,
  noteLinkAllowed,
  noteTreeText,
  parseNotes,
  radii,
  type NoteBlock,
  type NoteInline,
} from '@fdv/shared';
import * as Linking from 'expo-linking';
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, Text as RNText, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Text } from '../ui';

/**
 * A document's note on the phone (5.36), read only. `@fdv/shared` reads it
 * into a tree (5.35) and the tree is drawn here as the phone's own Text —
 * never as HTML, which nothing here can draw: a `<script>`, an image or a
 * `javascript:` link typed into a note shows as the characters it is.
 *
 * A link goes only to https, http or mailto, shows the address it goes to,
 * and asks before anything opens it. The address is drawn as the web draws
 * it (5.35, X535-02): `noteLinkAllowed` first — no control, format (a
 * right-to-left override, a zero-width space) or separator character, and
 * no name before an http(s) host — then the URL parser's own form of it,
 * isolated from the direction of the words round it.
 *
 * Unlike a browser's, the phone's URL parser (Expo's whatwg-url-minimum)
 * does not turn a host in another script into punycode: it gives back
 * `https://\u0430pple.com` (a Cyrillic \u0430, which looks like a Latin
 * a) as written, and decodes a host written with `%` escapes into the same.
 * So a web address whose host, as the parser gives it back, is not plain
 * ASCII — letters, digits, dots and hyphens, an IPv4 or IPv6 address, a
 * port — is kept as the text it was written as, never a link: nothing it
 * could open is shown as somewhere else. (A browser's parser gives
 * punycode, which is plain ASCII: there the link is drawn as the web draws
 * it.)
 */

/** A web address as the parser gives it back, with a plain ASCII host: after it, only a path, a query or a fragment. */
const PLAIN_WEB = /^https?:\/\/(?:[a-z0-9-]+(?:\.[a-z0-9-]+)*\.?|\[[0-9a-f:.]+\])(?::\d{1,5})?(?:[/?#]|$)/;

/** Unicode's isolates: what is inside takes no direction from what is round it, and gives none. */
const LTR_ISOLATE = '\u2066';
const FIRST_STRONG_ISOLATE = '\u2068';
const POP_ISOLATE = '\u2069';

/**
 * Where a note's link goes, as it will be opened and shown: the URL
 * parser's own form, for a host in plain ASCII; null for anything that is
 * to stay text.
 */
export function noteAddress(href: string): string | null {
  if (!noteLinkAllowed(href)) return null;
  let address: string;
  try {
    address = new URL(href).href;
  } catch {
    return null;
  }
  return /^https?:/.test(address) && !PLAIN_WEB.test(address) ? null : address;
}

/** A link's words, as their plain text. */
const wordsOf = (nodes: NoteInline[]) =>
  noteTreeText({ blocks: [{ type: 'paragraph', blankBefore: 0, children: nodes }] });

/** A note, drawn: its links ask before they open. */
export function NoteText(props: { source: string }) {
  const { t } = useTranslation();
  const tree = useMemo(() => parseNotes(props.source), [props.source]);
  const [asking, setAsking] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const open = async (address: string) => {
    setAsking(null);
    setFailed(false);
    try {
      await Linking.openURL(address);
    } catch {
      setFailed(true);
    }
  };

  const inline = (nodes: NoteInline[], key = ''): ReactNode[] =>
    nodes.map((node, i) => {
      const k = `${key}${i}`;
      switch (node.type) {
        case 'text':
          return <Fragment key={k}>{node.text}</Fragment>;
        case 'break':
          return <Fragment key={k}>{'\n'}</Fragment>;
        case 'strong':
          return (
            <RNText key={k} style={styles.strong}>
              {inline(node.children, `${k}.`)}
            </RNText>
          );
        case 'em':
          return (
            <RNText key={k} style={styles.em}>
              {inline(node.children, `${k}.`)}
            </RNText>
          );
        case 'link': {
          // The parser makes no other link; asked again where it is drawn.
          const address = noteAddress(node.href);
          const words = wordsOf(node.children);
          if (!address) return <Fragment key={k}>{words ? `${words} (${node.href})` : node.href}</Fragment>;
          const shown = `${LTR_ISOLATE}${address}${POP_ISOLATE}`;
          return (
            <RNText
              key={k}
              testID="note-link"
              accessibilityRole="link"
              accessibilityHint={t('notes.linkHint')}
              onPress={() => setAsking(address)}
              style={styles.link}
            >
              {node.children.length > 0 ? (
                <>
                  {FIRST_STRONG_ISOLATE}
                  {inline(node.children, `${k}.`)}
                  {POP_ISOLATE}
                  {` (${shown})`}
                </>
              ) : (
                shown
              )}
            </RNText>
          );
        }
      }
    });

  const block = (b: NoteBlock, i: number) => {
    switch (b.type) {
      case 'heading':
        return (
          <Text key={i} weight="700" role="header">
            {inline(b.children)}
          </Text>
        );
      case 'paragraph':
        return <Text key={i}>{inline(b.children)}</Text>;
      case 'list':
        return (
          <View key={i} style={styles.list}>
            {b.items.map((item, n) => (
              <View key={n} style={styles.item} testID="note-item">
                {item.checked === null ? (
                  <Text>{b.ordered ? `${b.start + n}.` : '•'}</Text>
                ) : (
                  // A checklist's box, shown and never ticked here: said as words.
                  <View
                    accessible
                    accessibilityLabel={item.checked ? t('notes.done') : t('notes.toDo')}
                    testID={item.checked ? 'note-box-done' : 'note-box-to-do'}
                  >
                    <Text>{item.checked ? '☑' : '☐'}</Text>
                  </View>
                )}
                <Text style={styles.flex}>{inline(item.children)}</Text>
              </View>
            ))}
          </View>
        );
    }
  };

  return (
    <View style={styles.note} testID="note">
      {tree.blocks.map(block)}
      {failed ? (
        <Text tone="danger" role="alert">
          {t('notes.openFailed')}
        </Text>
      ) : null}
      <OpenLink address={asking} onOpen={(a) => void open(a)} onCancel={() => setAsking(null)} />
    </View>
  );
}

/** "Open https://… in your browser?": nothing opens until the person says so. */
function OpenLink(props: { address: string | null; onOpen: (address: string) => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { address } = props;
  const mail = address?.toLowerCase().startsWith('mailto:') ?? false;
  const shown = address ? `${LTR_ISOLATE}${address}${POP_ISOLATE}` : '';
  return (
    <Modal visible={address !== null} transparent animationType="fade" onRequestClose={props.onCancel}>
      <View style={styles.scrim}>
        <Pressable
          accessible={false}
          importantForAccessibility="no"
          onPress={props.onCancel}
          style={StyleSheet.absoluteFill}
        />
        <View
          style={[styles.sheet, { paddingBottom: 20 + insets.bottom }]}
          accessibilityViewIsModal
          testID="note-link-question"
        >
          <Text variant="screen">
            {mail ? t('notes.openMail', { address: shown }) : t('notes.openWeb', { address: shown })}
          </Text>
          <Button
            testID="note-link-open"
            label={t('notes.open')}
            onPress={() => (address ? props.onOpen(address) : undefined)}
          />
          <Button testID="note-link-cancel" kind="quiet" label={t('common.cancel')} onPress={props.onCancel} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  note: { gap: 8 },
  strong: { fontWeight: '700' },
  em: { fontStyle: 'italic' },
  link: { color: colours.accent, textDecorationLine: 'underline' },
  list: { gap: 4 },
  item: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  flex: { flex: 1 },
  scrim: { flex: 1, backgroundColor: colours.scrim, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colours.bg,
    padding: 20,
    gap: 12,
    borderTopLeftRadius: radii.l,
    borderTopRightRadius: radii.l,
  },
});
