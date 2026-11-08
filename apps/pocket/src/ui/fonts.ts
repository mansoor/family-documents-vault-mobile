import { type as typeScale } from '@fdv/shared';
import type { TextStyle } from 'react-native';

/**
 * The project's two typefaces (@fdv/shared's `type.families`): Fraunces
 * for what heads a screen, Figtree for everything else. Each weight is a
 * family of its own, named by its file, as Android names an embedded font
 * (app.config.ts, expo-font) and as the web build registers it at runtime
 * (app/_layout.tsx). The family carries the weight, so `fontWeight` is
 * never set beside it: Android and the browser would embolden it again.
 */
export type Weight = '400' | '500' | '600' | '700';

const BODY: Record<Weight, string> = {
  '400': `${typeScale.families.body}_400Regular`,
  '500': `${typeScale.families.body}_500Medium`,
  '600': `${typeScale.families.body}_600SemiBold`,
  '700': `${typeScale.families.body}_700Bold`,
};

/** Fraunces comes in one weight here: a heading's. */
const DISPLAY = `${typeScale.families.display}_600SemiBold`;

/** The style that sets a typeface: Figtree at `weight`, or Fraunces for a heading. */
export function font(weight: Weight = '400', display = false): Pick<TextStyle, 'fontFamily'> {
  return { fontFamily: display ? DISPLAY : BODY[weight] };
}

/** Every family the app draws with, by name: what the web build loads before it draws. */
export const FAMILIES = [...Object.values(BODY), DISPLAY] as const;
