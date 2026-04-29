/**
 * diff — pure function over two scan results.
 *
 * Inputs:
 *   localScan: from scanLocal — { relPath, absPath, mtimeMs, sha256, size }
 *   podScan:   from scanPod   — { relPath, podUri,  mtimeMs, sha256, size, etag? }
 *   knownState: optional previous-sync map keyed by relPath:
 *               { [relPath]: { sha256, syncedAt } }
 *
 * Output buckets:
 *   toUpload   — entries to push local → pod (new locally, or local edited
 *                while pod is unchanged from last common state)
 *   toDownload — entries to pull pod → local (new on pod, or pod edited
 *                while local is unchanged from last common state)
 *   toDelete   — entries that should be removed.  In v1 this is filled by
 *                the SyncEngine via TombstoneStore; the diff function only
 *                surfaces files present-in-state-but-missing-on-both-sides
 *                (signal to the caller to evict from state).
 *   conflicts  — both sides changed since the last common state (or no
 *                common state and content differs) → enter conflict-resolution.
 *
 * Conflict rule:
 *   IF relPath in both sides AND localSha !== podSha:
 *     - if no knownState for this relPath → conflict
 *     - if localSha === knownState.sha256 (local unchanged) → toDownload (pod won)
 *     - if podSha   === knownState.sha256 (pod unchanged)   → toUpload   (local won)
 *     - else → conflict (both changed)
 *
 * The diff is symmetric — re-running it on the same inputs produces the
 * same output.  No side effects.
 */

/**
 * @typedef {object} DiffEntry
 * @property {string}  relPath
 * @property {string=} absPath        — set when present locally
 * @property {string=} podUri         — set when present on pod
 * @property {string=} sha256         — set if known (always for present sides)
 * @property {number=} mtimeMs
 * @property {number=} size
 * @property {string=} etag
 */

/**
 * @typedef {object} ConflictEntry
 * @property {string}  relPath
 * @property {string}  absPath
 * @property {string}  podUri
 * @property {string}  localSha256
 * @property {string}  remoteSha256
 * @property {number}  localMtimeMs
 * @property {number}  remoteMtimeMs
 * @property {string=} etag
 */

/**
 * @param {Array<{relPath:string, absPath:string, mtimeMs:number, sha256:string, size:number}>} localScan
 * @param {Array<{relPath:string, podUri:string,  mtimeMs:number, sha256:string, size:number, etag?:string}>} podScan
 * @param {Record<string, { sha256: string, syncedAt: number }>} [knownState]
 * @returns {{ toUpload: DiffEntry[], toDownload: DiffEntry[], toDelete: DiffEntry[], conflicts: ConflictEntry[] }}
 */
export function diff(localScan, podScan, knownState = {}) {
  const localByRel = indexBy(localScan, 'relPath');
  const podByRel   = indexBy(podScan,   'relPath');

  const toUpload   = [];
  const toDownload = [];
  const toDelete   = [];
  const conflicts  = [];

  // Walk every relPath we know about on either side, plus any in knownState
  // (so we surface files that were synced but disappeared from both sides).
  const allRels = new Set([
    ...Object.keys(localByRel),
    ...Object.keys(podByRel),
    ...Object.keys(knownState ?? {}),
  ]);

  for (const rel of allRels) {
    const l = localByRel[rel];
    const p = podByRel[rel];
    const k = knownState?.[rel];

    // Both present.
    if (l && p) {
      if (l.sha256 === p.sha256) continue;                  // identical — nothing to do
      if (!k) {
        // No common ancestor → conflict (true concurrent creation with diverging content).
        conflicts.push(makeConflict(l, p));
        continue;
      }
      const localChanged  = l.sha256 !== k.sha256;
      const remoteChanged = p.sha256 !== k.sha256;
      if (localChanged && !remoteChanged) {
        toUpload.push({ ...l });
        continue;
      }
      if (!localChanged && remoteChanged) {
        toDownload.push({ ...p });
        continue;
      }
      // Both changed (or neither, but content differs from each other —
      // shouldn't happen if k is consistent; treat as conflict for safety).
      conflicts.push(makeConflict(l, p));
      continue;
    }

    // Local-only.
    if (l && !p) {
      // If state says we synced this file before, then pod-side disappeared
      // → could mean another device deleted it (deleteCompletely).  v1 treats
      // local-only with prior state as toUpload (we don't have a delete intent
      // here without an explicit tombstone).  A future enhancement is to track
      // pod-side tombstones; for v1 we re-upload, which is the safer default
      // for note content (no silent loss of an edit).
      toUpload.push({ ...l });
      continue;
    }

    // Pod-only.
    if (p && !l) {
      // Same logic mirror: if known and previously synced, the user may have
      // deleted locally without `deleteLocal` (rm). v1 pulls it back — Phase B
      // can add an explicit "I deleted that, please tombstone" UX.
      toDownload.push({ ...p });
      continue;
    }

    // Neither side has it but state remembers it → caller can evict from state.
    toDelete.push({ relPath: rel, sha256: k?.sha256 });
  }

  return { toUpload, toDownload, toDelete, conflicts };
}

function indexBy(arr, key) {
  const out = {};
  for (const x of arr ?? []) out[x[key]] = x;
  return out;
}

function makeConflict(l, p) {
  return {
    relPath:        l.relPath,
    absPath:        l.absPath,
    podUri:         p.podUri,
    localSha256:    l.sha256,
    remoteSha256:   p.sha256,
    localMtimeMs:   l.mtimeMs,
    remoteMtimeMs:  p.mtimeMs,
    etag:           p.etag,
  };
}
