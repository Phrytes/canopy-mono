/**
 * basis-mobile v2 — Onderling theme (RN).
 *
 * Derives from the canonical token object (apps/basis/src/v2/theme.js,
 * re-exported as THEME/THEME_DARK) so web + mobile share one source of truth.
 *
 * Dark mode (2026-07-17): the palette is picked ONCE at module load from the
 * OS scheme (Appearance is synchronous), because the v2 screens build their
 * StyleSheets at module load — everything downstream captures the right
 * palette with zero refactor. Consequences, on purpose:
 *  - an OS theme change mid-run applies on next app start;
 *  - the in-app light/dark TOGGLE is web-only for now (mobile needs the
 *    theme-context refactor first) — listed in
 *    docs/conventions/web-mobile-exceptions.md with that exit path.
 *
 * Bulletin design: headings are bold SYSTEM sans (undefined fontFamily =
 * RN system default); Source Serif is gone with the linen theme.
 */
import { Appearance } from 'react-native';
import { THEME, THEME_DARK } from '@onderling-app/basis';

const FONT = {
  serif:     undefined, // system sans — bulletin headings are bold sans
  serifBody: undefined,
  mono:      'monospace',
};

const wrap = (tokens) => ({
  color:  tokens.color,
  radius: tokens.radius,
  space:  tokens.space,
  font:   FONT,
});

export const themeLight = wrap(THEME);
export const themeDark = wrap(THEME_DARK);

const scheme = typeof Appearance?.getColorScheme === 'function' ? Appearance.getColorScheme() : 'light';
export const theme = scheme === 'dark' ? themeDark : themeLight;

export default theme;
