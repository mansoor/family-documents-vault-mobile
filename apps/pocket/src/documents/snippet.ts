/**
 * A search result's snippet (4.12): the vault marks what matched with
 * `<em>`; nothing else in it is markup. It becomes plain text runs, bold
 * where it matched — never rendered as markup, whatever else it contains.
 */
export function snippetParts(snippet: string): { text: string; bold: boolean }[] {
  const parts: { text: string; bold: boolean }[] = [];
  let bold = false;
  for (const piece of snippet.split(/(<\/?em>)/)) {
    if (piece === '<em>') bold = true;
    else if (piece === '</em>') bold = false;
    else if (piece) parts.push({ text: piece, bold });
  }
  return parts;
}
