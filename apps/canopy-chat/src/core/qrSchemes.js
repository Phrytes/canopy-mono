/**
 * QR URI schemes recognised by canopy-chat (web + mobile).
 *
 * Lifted out of src/renderer.js 2026-05-27 so the mobile chat-shell
 * can also detect QR-payload fields in record bubbles + render them
 * via @canopy/react-native/qr/view.  The list is the canonical
 * registry: any new scheme added here is auto-recognised by both
 * renderers + the mobile scanner classifier.
 *
 * Platform: neutral (pure data + a string-prefix test).
 */

export const QR_URI_PREFIXES = Object.freeze([
  'stoop-contact://',
  'stoop-invite://',
  'canopy-chat://',    // future: chat-shell-level invites
]);

/**
 * @param {string} v
 * @returns {boolean} true if `v` looks like one of our QR-payload URIs.
 */
export function isQrUri(v) {
  return typeof v === 'string'
    && QR_URI_PREFIXES.some((p) => v.startsWith(p));
}
