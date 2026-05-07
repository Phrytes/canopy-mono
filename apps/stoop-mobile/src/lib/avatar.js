/**
 * avatar — pure helpers for AvatarCircle (initials + palette colour).
 *
 * Lives outside the JSX component file so vitest can import it without
 * needing JSX-in-`.js` support.
 */

export const PALETTE = Object.freeze([
  '#5d4037', '#0277bd', '#388e3c', '#e64a19',
  '#7b1fa2', '#0097a7', '#fbc02d', '#455a64',
]);

/**
 * Pick the up-to-two-letter initials from a display name.
 * Falls back to '·' for empty / non-string input so the avatar
 * never renders an empty pill.
 */
export function initials(name) {
  if (typeof name !== 'string' || name.trim().length === 0) return '·';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '·';
}

/**
 * Deterministic background colour derived from the name. Two callers
 * passing the same name always get the same colour.
 */
export function paletteFor(name) {
  if (typeof name !== 'string' || name.length === 0) return PALETTE[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}
