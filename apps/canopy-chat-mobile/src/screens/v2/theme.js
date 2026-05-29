/**
 * canopy-chat-mobile v2 — Onderling theme (RN).
 *
 * Derives from the canonical token object (apps/canopy-chat/src/v2/theme.js,
 * re-exported as THEME) so web + mobile share one source of truth. Colors /
 * radius / spacing pass straight through. `font` family names are filled in
 * by Phase 4.2 (expo-font load in App.js); until then they're undefined →
 * RN falls back to the system serif/sans, which is the graceful default.
 */
import { Platform } from 'react-native';
import { THEME } from '@canopy-app/canopy-chat';

// Platform serif — always present, so headings render serif with NO font
// load (a runtime useFonts load of Source Serif 4 once hung boot at a black
// screen on device when it never resolved). Android → Noto Serif; iOS →
// Georgia. Embedding Source Serif 4 at build time is a later polish step.
const SERIF = Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' });

export const theme = {
  color:  THEME.color,
  radius: THEME.radius,
  space:  THEME.space,
  font: {
    serif:     SERIF,
    serifBody: SERIF,
    mono:      'monospace',
  },
};

export default theme;
