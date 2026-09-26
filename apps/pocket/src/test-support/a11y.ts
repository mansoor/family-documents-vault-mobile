import { colours, TAP_MIN } from '@fdv/shared';
import { screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

type Instance = NonNullable<typeof screen.root>;

function slop(hitSlop: unknown, a: 'top' | 'left', b: 'bottom' | 'right'): number {
  if (typeof hitSlop === 'number') return hitSlop * 2;
  const h = (hitSlop ?? {}) as Record<string, number | undefined>;
  return (h[a] ?? 0) + (h[b] ?? 0);
}

function label(i: Instance): string {
  return String(i.props.accessibilityLabel ?? i.props['aria-label'] ?? '').trim();
}

function describeIt(i: Instance): string {
  return `${i.type}${i.props.testID ? `#${i.props.testID}` : ''}${label(i) ? ` "${label(i)}"` : ''}`;
}

/**
 * Everything on the screen a finger can use: it says what it is, it has a
 * name a screen reader can read out, and it is at least 44 dp each way
 * once its hit slop is counted. Returns what falls short, in words.
 */
export function audit(): string[] {
  const root = screen.root;
  if (!root) return ['nothing rendered'];
  const problems: string[] = [];

  const pressables = root.queryAll(
    (n) =>
      n.props.accessible === true &&
      typeof n.props.onClick === 'function' &&
      typeof n.props.onChangeText !== 'function',
  );
  if (pressables.length === 0) problems.push('no pressables found: the audit is not looking at anything');
  for (const p of pressables) {
    if (!p.props.accessibilityRole && !p.props.role) problems.push(`${describeIt(p)} has no role`);
    if (!label(p)) problems.push(`${describeIt(p)} has no label`);
    const style = StyleSheet.flatten(p.props.style) ?? {};
    const tall = Number(style.height ?? style.minHeight ?? 0) + slop(p.props.hitSlop, 'top', 'bottom');
    if (tall < TAP_MIN) problems.push(`${describeIt(p)} is ${tall} dp tall with its hit slop`);
    const setWidth = style.width ?? style.minWidth;
    if (setWidth !== undefined) {
      const wide = Number(setWidth) + slop(p.props.hitSlop, 'left', 'right');
      if (wide < TAP_MIN) problems.push(`${describeIt(p)} is ${wide} dp wide with its hit slop`);
    }
  }

  for (const f of root.queryAll((n) => typeof n.props.onChangeText === 'function')) {
    if (!label(f)) problems.push(`${describeIt(f)} is a field with no label`);
  }
  for (const s of root.queryAll(
    (n) => typeof n.props.onValueChange === 'function' || String(n.type).endsWith('Switch'),
  )) {
    if (!label(s)) problems.push(`${describeIt(s)} is a switch with no label`);
  }
  // A status is never colour alone (4.17): whatever is filled with a
  // status colour says in words what it means, or is labelled.
  for (const v of root.queryAll((n) => {
    const bg = (StyleSheet.flatten(n.props.style) ?? {}).backgroundColor;
    return typeof bg === 'string' && STATUS.has(bg.toLowerCase());
  })) {
    const words = v.queryAll(
      (n) =>
        n.type === 'Text' &&
        ([] as unknown[])
          .concat(n.props.children)
          .some((c) => (typeof c === 'string' && c.trim() !== '') || typeof c === 'number'),
    );
    const read = label(v) !== '' && (v.props.accessible === true || !!v.props.accessibilityRole);
    if (words.length === 0 && !read) problems.push(`${describeIt(v)} shows a status by colour alone`);
  }
  return problems;
}

/** The colours that mean something: fine, a warning, a danger. */
const STATUS = new Set(
  [colours.ok, colours.warn, colours.warnSoft, colours.danger, colours.dangerSoft].map((c) => c.toLowerCase()),
);
