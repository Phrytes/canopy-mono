/**
 * applyConflict — write a conflicted file in place, with git-style markers.
 * After this, the file contains both versions; the user resolves by editing
 * in their normal markdown editor.
 *
 *   <<<<<<< YOURS (local 2026-04-29 14:32)
 *   ...your version...
 *   =======
 *   ...remote version...
 *   >>>>>>> THEIRS (pod 2026-04-29 14:35)
 *
 * Idempotency: if the existing file content already contains the conflict
 * markers (a pre-applied conflict that the user hasn't resolved yet), we
 * do NOT double-mark.  We re-write the existing file verbatim — the
 * user's hands-off-until-resolved guarantee.
 *
 * Folio.C1 — adapter-aware: takes an optional `fs` adapter (default Node).
 */

import { fsNode }       from './adapters/fsNode.js';
import { dirnamePosix } from './adapters/pathPosix.js';

const CONFLICT_HEAD = '<<<<<<<';
const CONFLICT_MID  = '=======';
const CONFLICT_TAIL = '>>>>>>>';
// Match only Folio's own conflict signature so user content that happens to
// contain `<<<<<<<` (e.g. shell output, tutorials, git transcripts) is not
// misclassified as a Folio conflict.  Folio always writes `<<<<<<< YOURS`
// at the head of a conflict; git uses `<<<<<<< HEAD` or branch names, so
// the `YOURS` keyword (with word boundary) is unambiguously Folio.
const CONFLICT_RE   = /^<{7} YOURS\b/m;

/**
 * @param {string} absPath
 * @param {string} localText
 * @param {string} remoteText
 * @param {{ localTimestamp?: number, remoteTimestamp?: number, fs?: import('./adapters/index.js').FsAdapter }} [opts]
 */
export async function applyConflict(absPath, localText, remoteText, opts = {}) {
  const fs = opts.fs ?? fsNode;
  // Idempotency: if the file on disk already has conflict markers, don't
  // double-mark.  This protects against a re-run of runOnce while the user
  // is mid-edit.
  let existing = '';
  try { existing = await fs.readFileText(absPath, 'utf8'); }
  catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  if (existing && CONFLICT_RE.test(existing)) {
    return; // already conflicted; leave alone
  }

  const localTs  = formatTs(opts.localTimestamp);
  const remoteTs = formatTs(opts.remoteTimestamp);
  const merged =
    `${CONFLICT_HEAD} YOURS (local ${localTs})\n` +
    ensureTrailingNewline(localText) +
    `${CONFLICT_MID}\n` +
    ensureTrailingNewline(remoteText) +
    `${CONFLICT_TAIL} THEIRS (pod ${remoteTs})\n`;

  await fs.mkdir(dirnamePosix(absPath), { recursive: true });
  await fs.writeFile(absPath, merged, { encoding: 'utf8' });
}

function ensureTrailingNewline(s) {
  const v = String(s ?? '');
  return v.endsWith('\n') ? v : `${v}\n`;
}

function formatTs(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return 'unknown';
  const d = new Date(ms);
  // YYYY-MM-DD HH:MM (UTC) — locale-stable for tests.
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
  );
}

/** Test helper — exposed so tests can detect conflict-marked content. */
export function hasConflictMarkers(text) {
  return typeof text === 'string' && CONFLICT_RE.test(text);
}
