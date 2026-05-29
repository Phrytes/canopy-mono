/**
 * canopy-chat-mobile v2 — Onderling theme (RN).
 *
 * Derives from the canonical token object (apps/canopy-chat/src/v2/theme.js,
 * re-exported as THEME) so web + mobile share one source of truth. Colors /
 * radius / spacing pass straight through. `font` family names are filled in
 * by Phase 4.2 (expo-font load in App.js); until then they're undefined →
 * RN falls back to the system serif/sans, which is the graceful default.
 */
import { THEME } from '@canopy-app/canopy-chat';

// Source Serif 4 — loaded NON-blocking via useFonts in App.js
// (@expo-google-fonts/source-serif-4). The family names below are the
// useFonts keys, so they resolve deterministically once loaded. Render is
// NOT gated on the load (that once hung boot at a black screen); until the
// font resolves, RN briefly falls back to the system default.
export const theme = {
  color:  THEME.color,
  radius: THEME.radius,
  space:  THEME.space,
  font: {
    serif:     'SourceSerif4_600SemiBold',
    serifBody: 'SourceSerif4_400Regular',
    mono:      'monospace',
  },
};

export default theme;
