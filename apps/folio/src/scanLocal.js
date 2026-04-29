/**
 * scanLocal — walk a local directory recursively, returning one entry per
 * file (containers / dirs are not returned).
 *
 * Each entry:
 *   { relPath, absPath, mtimeMs, sha256, size }
 *
 * `relPath` is POSIX-style (forward slashes) so it can be compared against
 * pod URIs without platform normalization.  Hidden files / directories
 * and `.canopy/` are skipped via `pathMap.shouldSync` /
 * `pathMap.shouldSkipDir`.
 *
 * sha256 is computed over the raw bytes.  Streaming for very large files
 * is the obvious follow-up; v1 reads the whole file (memory-bounded by
 * the 100 MB convention threshold + pathMap.shouldSync filter — a Phase B
 * concern).
 */

import { promises as fs } from 'node:fs';
import { join, sep as pathSep } from 'node:path';
import { createHash } from 'node:crypto';

import { PathMap } from './PathMap.js';

/**
 * @param {string} rootPath
 * @param {{ pathMap?: PathMap }} [opts]
 * @returns {Promise<Array<{ relPath: string, absPath: string, mtimeMs: number, sha256: string, size: number }>>}
 */
export async function scanLocal(rootPath, opts = {}) {
  if (!rootPath) throw new Error('scanLocal: rootPath is required');
  const pathMap = opts.pathMap ?? new PathMap({ localRoot: rootPath, podRoot: 'urn:scan:' });

  // Bail-out: root doesn't exist → empty list.
  try {
    const st = await fs.stat(rootPath);
    if (!st.isDirectory()) {
      throw new Error(`scanLocal: not a directory: ${rootPath}`);
    }
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }

  const out = [];
  await walk(rootPath, '', out, pathMap);
  return out;
}

async function walk(absDir, relDir, out, pathMap) {
  let dirents;
  try {
    dirents = await fs.readdir(absDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EACCES') return;
    throw err;
  }
  for (const ent of dirents) {
    const childRel = relDir === '' ? ent.name : `${relDir}/${ent.name}`;
    const childAbs = join(absDir, ent.name);
    if (ent.isDirectory()) {
      if (pathMap.shouldSkipDir(childRel)) continue;
      await walk(childAbs, childRel, out, pathMap);
      continue;
    }
    if (!ent.isFile()) continue;          // skip symlinks, sockets, etc. for v1
    if (!pathMap.shouldSync(childRel)) continue;
    const meta = await fileMeta(childAbs);
    if (meta == null) continue;           // race: file went away
    out.push({
      relPath: childRel,                  // POSIX-style
      absPath: childAbs,
      mtimeMs: meta.mtimeMs,
      sha256:  meta.sha256,
      size:    meta.size,
    });
  }
}

async function fileMeta(absPath) {
  let st;
  try { st = await fs.stat(absPath); }
  catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  // sha256 over file bytes.  v1 reads the whole file; large-file streaming
  // is a Phase B concern (the 100 MB convention is a soft cap).
  let buf;
  try { buf = await fs.readFile(absPath); }
  catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  const hash = createHash('sha256').update(buf).digest('hex');
  return { mtimeMs: Math.floor(st.mtimeMs), sha256: hash, size: st.size };
}

// Re-export pathSep for tests that need to construct platform-correct paths.
export const _pathSep = pathSep;
