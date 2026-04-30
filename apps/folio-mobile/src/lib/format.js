/**
 * format — pure formatters used across UI surfaces.  Lives in lib/ so
 * unit tests can exercise the date / byte / mtime conversions without
 * loading any React or React Native.
 */

/**
 * Human-friendly "n minutes ago" / "1 day ago" string for a unix-ms
 * timestamp.  Returns `null` when given a falsy / non-positive input
 * so callers can choose their own placeholder.
 *
 * @param {number|null|undefined} ts
 * @returns {string|null}
 */
export function formatRelativeAgo(ts) {
  if (typeof ts !== 'number' || ts <= 0) return null;
  const ms = Date.now() - ts;
  if (ms < 0) return 'just now';
  const s = Math.floor(ms / 1000);
  if (s < 5)  return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/**
 * Coarser sibling for FileRow's mtime label — uses "min ago", "h ago",
 * "d ago" with the leading number padded by a space.
 *
 * @param {number|null|undefined} ts
 * @returns {string}
 */
export function formatMtime(ts) {
  if (typeof ts !== 'number' || ts <= 0) return '—';
  const ms = Date.now() - ts;
  if (ms < 60_000)     return 'just now';
  if (ms < 3_600_000)  return `${Math.floor(ms / 60_000)} min ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} h ago`;
  return `${Math.floor(ms / 86_400_000)} d ago`;
}

/**
 * Pretty-print a byte count.  Returns `''` for null / negative input.
 *
 * @param {number|null|undefined} n
 * @returns {string}
 */
export function formatBytes(n) {
  if (typeof n !== 'number' || n < 0) return '';
  if (n < 1024)        return `${n} B`;
  if (n < 1_048_576)   return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1_048_576).toFixed(1)} MB`;
}
