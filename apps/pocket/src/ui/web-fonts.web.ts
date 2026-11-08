import {
  Figtree_400Regular,
  Figtree_500Medium,
  Figtree_600SemiBold,
  Figtree_700Bold,
} from '@expo-google-fonts/figtree';
import { Fraunces_600SemiBold } from '@expo-google-fonts/fraunces';

/**
 * The web build (development and the browser tests) loads the typefaces
 * at runtime, under the names fonts.ts draws with: the same names Android
 * gives the embedded files.
 */
export const WEB_FONTS: Record<string, number> = {
  Figtree_400Regular,
  Figtree_500Medium,
  Figtree_600SemiBold,
  Figtree_700Bold,
  Fraunces_600SemiBold,
};
