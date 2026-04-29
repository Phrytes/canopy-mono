/**
 * conflictId — reversible mapping between a conflict's relPath and a URL-safe ID.
 *
 * The SyncEngine doesn't allocate stable IDs for conflicts (a conflict is
 * identified by its file's `relPath`).  The REST surface needs IDs that
 * survive in URL params, so we base64url-encode the relPath.
 */

export function conflictIdFromRelPath(relPath) {
  const buf = Buffer.from(String(relPath ?? ''), 'utf8');
  return buf.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function relPathFromConflictId(id) {
  if (typeof id !== 'string' || id.length === 0) return null;
  // Restore base64 padding.
  const b64 = id.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  try {
    return Buffer.from(padded, 'base64').toString('utf8');
  } catch {
    return null;
  }
}
