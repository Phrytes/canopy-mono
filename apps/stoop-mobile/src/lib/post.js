/**
 * post — pure helpers for PostCard (attachment URI resolution + time-ago).
 *
 * Lives outside the JSX component file so vitest can import it without
 * needing JSX-in-`.js` support.
 */

/**
 * Resolve a Stoop attachment to a renderable image URI. Handles:
 *   - Native pickers' `{uri}` shape.
 *   - Wire-shape `{thumbnail: {dataB64, mime}, ...}` (Phase 39).
 *   - Top-level `{dataB64, mime}` (chat single-image attachments).
 *
 * Returns `null` when nothing is renderable.
 *
 * @param {object} att
 * @returns {string|null}
 */
export function attachmentUri(att) {
  if (!att) return null;
  if (typeof att.uri === 'string') return att.uri;
  const thumb = att.thumbnail ?? att;
  if (typeof thumb?.dataB64 === 'string') {
    const mime = thumb.mime ?? 'image/jpeg';
    return `data:${mime};base64,${thumb.dataB64}`;
  }
  return null;
}

/**
 * Render a post's createdAt timestamp as a short relative-time
 * label.  Coarse (no localisation, no plurals) — Stoop's UI shows
 * these next to a full ISO timestamp on tap.
 *
 * @param {number} t   epoch-ms
 * @returns {string|null}
 */
export function timeAgo(t, now = Date.now()) {
  if (typeof t !== 'number' || !Number.isFinite(t)) return null;
  const diff = now - t;
  if (diff < 0) return null;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w`;
}
