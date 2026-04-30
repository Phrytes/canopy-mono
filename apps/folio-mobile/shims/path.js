/**
 * Minimal POSIX `path` shim for RN.  Replaces Node's `path` module with
 * pure-JS POSIX helpers.  RN's filesystem (expo-file-system) is always
 * `/`-separated, so no platform branches needed.
 *
 * Covers what the @canopy/core + apps/folio chain destructures from
 * `path` (and `path.posix`):
 *   - sep, join, dirname, basename, extname
 *   - posix.<above>     — `path.posix` namespace; identical surface
 *
 * The empty-shim approach (used for `fs`, `crypto`, etc. via
 * `node-builtins.js`) doesn't work for `path` because PathMap.js does
 *
 *   export const joinRel = posix.join;
 *
 * at top-level — i.e. evaluates `posix.join` at module-load time.  An
 * empty shim makes `posix` undefined → "Cannot read property 'join' of
 * undefined" before any user code runs.
 *
 * See ../docs/SOLID-RN-NOTES.md for the broader pattern.
 */

const sep = '/';

function join(...segs) {
  if (segs.length === 0) return '.';
  const cleaned = [];
  let leading = '';
  for (const s of segs) {
    if (typeof s !== 'string' || s.length === 0) continue;
    if (cleaned.length === 0 && s.startsWith('/')) leading = '/';
    const stripped = s.replace(/^\/+|\/+$/g, '');
    if (stripped.length > 0) cleaned.push(stripped);
  }
  if (cleaned.length === 0) return leading || '.';
  return leading + cleaned.join('/');
}

function dirname(p) {
  if (typeof p !== 'string' || p.length === 0) return '.';
  const trimmed = p.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  if (idx < 0) return '.';
  if (idx === 0) return '/';
  return trimmed.slice(0, idx);
}

function basename(p, ext) {
  if (typeof p !== 'string') return '';
  const trimmed = p.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  let name = idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
  if (typeof ext === 'string' && name.endsWith(ext)) name = name.slice(0, -ext.length);
  return name;
}

function extname(p) {
  if (typeof p !== 'string') return '';
  const base = basename(p);
  const idx = base.lastIndexOf('.');
  return idx > 0 ? base.slice(idx) : '';
}

const posix = { sep, join, dirname, basename, extname };
// Some libs do `path.posix.posix` (rare but legal).
posix.posix = posix;

module.exports = {
  sep, join, dirname, basename, extname, posix,
  // for `import path from 'path'` style consumers
  default: { sep, join, dirname, basename, extname, posix },
};
