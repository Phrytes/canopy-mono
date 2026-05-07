/**
 * theme — colour + spacing constants for Stoop V3 mobile.
 *
 * Mirrors the desktop palette (`apps/stoop/web/style.css` — green
 * Stoop brand, neutrals for surfaces, red for danger). Kept tiny:
 * one source of truth so screens don't drift from each other.
 */

export const COLORS = Object.freeze({
  // Brand
  primary:        '#2e7d32',  // stoop-green
  primaryDark:    '#1b5e20',
  primaryLight:   '#a5d6a7',

  // Surfaces
  background:     '#fafafa',
  surface:        '#ffffff',
  surfaceMuted:   '#f0f0f0',

  // Text
  text:           '#1a1a1a',
  textMuted:      '#5e5e5e',
  textInverse:    '#ffffff',

  // Borders + dividers
  border:         '#e0e0e0',

  // Status
  danger:         '#c62828',
  warning:        '#ef6c00',
  success:        '#2e7d32',
  info:           '#0277bd',

  // Special
  shadow:         'rgba(0, 0, 0, 0.08)',
  overlay:        'rgba(0, 0, 0, 0.55)',
});

export const SPACING = Object.freeze({
  xs:  4,
  sm:  8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
});

export const RADII = Object.freeze({
  sm: 4,
  md: 8,
  lg: 16,
  pill: 999,
});

export const FONT_SIZES = Object.freeze({
  xs:  12,
  sm:  14,
  md:  16,
  lg:  18,
  xl:  22,
  xxl: 28,
});
