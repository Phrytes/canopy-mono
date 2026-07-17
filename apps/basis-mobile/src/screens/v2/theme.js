/**
 * basis-mobile v2 — Onderling theme (RN).
 *
 * Derives from the canonical token object (apps/basis/src/v2/theme.js,
 * re-exported as THEME) so web + mobile share one source of truth. Colors /
 * radius / spacing pass straight through.
 *
 * Bulletin design (2026-07, full adoption): headings are bold SYSTEM sans —
 * the Source Serif expo-font load is gone (the linen-era serif lives on in
 * theme-linen.js on the app side). The `serif`/`serifBody` keys are kept so
 * the v2 screens need no edits: an undefined fontFamily is RN's system
 * default, which is exactly the bulletin's sans. `themeDark` mirrors
 * THEME_DARK for the upcoming dark-mode wiring (Appearance API).
 */
import { THEME, THEME_DARK } from '@onderling-app/basis';

export const theme = {
  color:  THEME.color,
  radius: THEME.radius,
  space:  THEME.space,
  font: {
    serif:     undefined, // system sans — bulletin headings are bold sans
    serifBody: undefined,
    mono:      'monospace',
  },
};

export const themeDark = {
  color:  THEME_DARK.color,
  radius: THEME_DARK.radius,
  space:  THEME_DARK.space,
  font:   theme.font,
};

export default theme;
