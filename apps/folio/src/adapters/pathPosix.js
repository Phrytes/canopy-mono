/**
 * pathPosix — pure-string POSIX path helpers.
 *
 * Folio's relPaths are POSIX-style (forward slashes) by convention; the
 * RN driver runs on `expo-file-system`, whose `documentDirectory` URI is
 * always `/`-separated.  Importing `node:path` from the RN bundle pulls
 * Node-only code into the JS bundle, which we want to avoid.
 *
 * These helpers cover the operations SyncEngine + helpers actually need:
 * `join`, `dirname`, `basename`, `extname`.  They're intentionally minimal:
 * no normalization of `..` segments, no platform branches, no `resolve`.
 *
 * Contract:
 *   - Always uses '/' as the separator on input AND output.
 *   - Empty / falsy segments in `join` are skipped, matching `node:path.join`.
 *   - A single leading '/' in `join` is preserved when the FIRST segment
 *     starts with '/'.  No clever absolute-path arithmetic.
 */

/**
 * Join one or more POSIX path segments with '/'.
 *
 *   joinPosix('a', 'b', 'c')         // 'a/b/c'
 *   joinPosix('/a', 'b/c', 'd')      // '/a/b/c/d'
 *   joinPosix('a', '', 'b')          // 'a/b'      — empty segments skipped
 *   joinPosix('a/', '/b/', '/c')     // 'a/b/c'    — slash deduped
 *   joinPosix('/')                   // '/'
 *   joinPosix()                      // ''
 *
 * @param  {...string} segs
 * @returns {string}
 */
export function joinPosix(...segs) {
  if (segs.length === 0) return '';
  // Preserve a single leading slash from the first non-empty segment.
  let firstNonEmpty = -1;
  for (let i = 0; i < segs.length; i++) {
    if (typeof segs[i] === 'string' && segs[i].length > 0) {
      firstNonEmpty = i;
      break;
    }
  }
  if (firstNonEmpty === -1) return '';
  const leading = segs[firstNonEmpty].startsWith('/') ? '/' : '';
  const cleaned = [];
  for (const seg of segs) {
    if (typeof seg !== 'string' || seg.length === 0) continue;
    // Strip leading + trailing slashes from each segment so we can
    // re-glue with a single '/' between every pair.  An all-slash
    // segment (e.g. '/') reduces to '' and is dropped.
    const stripped = seg.replace(/^\/+/, '').replace(/\/+$/, '');
    if (stripped.length === 0) continue;
    cleaned.push(stripped);
  }
  if (cleaned.length === 0) return leading || '';
  return `${leading}${cleaned.join('/')}`;
}

/**
 * POSIX dirname — return everything before the last '/' in a path.
 *
 *   dirnamePosix('a/b/c.md')   // 'a/b'
 *   dirnamePosix('/a/b/c.md')  // '/a/b'
 *   dirnamePosix('a.md')       // ''
 *   dirnamePosix('/a.md')      // '/'
 *   dirnamePosix('')           // ''
 *
 * @param {string} p
 * @returns {string}
 */
export function dirnamePosix(p) {
  if (typeof p !== 'string' || p.length === 0) return '';
  const trimmed = p.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  if (idx === -1) return '';
  if (idx === 0) return '/';
  return trimmed.slice(0, idx);
}

/**
 * POSIX basename — return the final segment after the last '/'.
 * Optional `ext` argument strips a trailing extension if present.
 *
 *   basenamePosix('a/b/c.md')        // 'c.md'
 *   basenamePosix('a/b/c.md', '.md') // 'c'
 *   basenamePosix('a/b/')            // 'b'
 *   basenamePosix('')                // ''
 *
 * @param {string} p
 * @param {string} [ext]
 * @returns {string}
 */
export function basenamePosix(p, ext) {
  if (typeof p !== 'string' || p.length === 0) return '';
  const trimmed = p.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  let base = idx === -1 ? trimmed : trimmed.slice(idx + 1);
  if (typeof ext === 'string' && ext.length > 0 && base.endsWith(ext)) {
    base = base.slice(0, base.length - ext.length);
  }
  return base;
}

/**
 * POSIX extname — return the file extension including the leading dot,
 * or '' when there is no extension.
 *
 *   extnamePosix('a/b/c.md')   // '.md'
 *   extnamePosix('a/b/c')      // ''
 *   extnamePosix('a/.hidden')  // ''        — leading-dot files have no ext
 *   extnamePosix('a/b/c.tar.gz') // '.gz'
 *   extnamePosix('')           // ''
 *
 * @param {string} p
 * @returns {string}
 */
export function extnamePosix(p) {
  const base = basenamePosix(p);
  // Leading-dot file with no further dot → no extension.
  if (base.length === 0) return '';
  // Find the last dot.  If it's the FIRST char (e.g. '.hidden'), no extension.
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return base.slice(dot);
}
