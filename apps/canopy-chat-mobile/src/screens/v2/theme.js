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

export const theme = {
  color:  THEME.color,
  radius: THEME.radius,
  space:  THEME.space,
  font: {
    serif:     undefined, // → 'SourceSerif4-SemiBold' (Phase 4.2)
    serifBody: undefined, // → 'SourceSerif4-Regular'  (Phase 4.2)
    mono:      'monospace',
  },
};

export default theme;
