/**
 * Sources.js — multi-source registry helpers.
 *
 * A "source" is a pod root the archive knows how to walk.  Sources live
 * in the SQLite db (table `sources`) — that's where the durable list
 * lives.  This module provides the higher-level operations on top of
 * `Db`'s raw inserts.
 *
 * v0 doesn't authenticate sources — `addSource` just records the pod root
 * and a friendly name.  Real-pod auth is future work; for v0 the pod is
 * the FsBackedMockPodClient.
 */

/**
 * Normalize a pod root: ensure trailing slash, basic shape check.
 */
export function normalizePodRoot(podRoot) {
  if (typeof podRoot !== 'string' || podRoot.length === 0) {
    throw new Error('podRoot is required');
  }
  return podRoot.endsWith('/') ? podRoot : `${podRoot}/`;
}

/**
 * Derive a default name from a pod root if the user didn't supply one.
 *   https://alice.example/notes/  →  alice.example
 *   https://alice.example/        →  alice.example
 */
export function defaultNameFor(podRoot) {
  try {
    const u = new URL(podRoot);
    return u.hostname || 'source';
  } catch {
    return 'source';
  }
}

/**
 * Add a source to the db.  Throws on duplicate `podRoot` or duplicate
 * `name` within a source set.
 *
 * @param {import('./Db.js').Db} db
 * @param {{ name?: string, podRoot: string }} input
 */
export function addSource(db, { name, podRoot }) {
  const normalized = normalizePodRoot(podRoot);

  const existingByRoot = db.getSourceByPodRoot(normalized);
  if (existingByRoot) {
    const err = new Error(`source already registered for pod root: ${normalized}`);
    err.code = 'SOURCE_EXISTS';
    throw err;
  }

  const finalName = name && name.length > 0 ? name : defaultNameFor(normalized);
  const existingByName = db.getSourceByName(finalName);
  if (existingByName) {
    const err = new Error(`source name already in use: ${finalName}`);
    err.code = 'NAME_TAKEN';
    throw err;
  }

  return db.addSource({ name: finalName, podRoot: normalized });
}

/**
 * Resolve a source from a CLI selector — accepts numeric id or a name.
 *
 * @param {import('./Db.js').Db} db
 * @param {string} selector
 * @returns {object|null}
 */
export function resolveSource(db, selector) {
  if (selector == null) return null;
  if (/^\d+$/.test(String(selector))) {
    return db.getSourceById(Number(selector));
  }
  return db.getSourceByName(String(selector));
}
