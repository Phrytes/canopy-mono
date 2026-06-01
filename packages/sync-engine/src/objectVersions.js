/**
 * objectVersions.js — Phase 9 (γ.2): version capture for keyed JSON blobs.
 *
 * Companion to `versions.js`: that module versions FILES on a real
 * filesystem (under `<localRoot>/.folio/versions/<relPath>/`).  This
 * module versions logical OBJECTS identified by a string `key` — the
 * caller never names a path, never touches `fs`.  It exists so the
 * kring stores (circlePolicy / kringRecipe / circleRules) can snapshot
 * every save into a per-key history slot regardless of whether the
 * write actually lands in localStorage, AsyncStorage, or a pod tier —
 * the capture happens ABOVE the storage tier.
 *
 * The full file-oriented machinery in `versions.js` would be overkill
 * here:
 *   - No filesystem (the host wires localStorage / AsyncStorage).
 *   - No sidecar `.sha256` files (sha is stored on the entry itself).
 *   - No 5-second debounce (the kring-store write path is debounced
 *     by the caller; γ.2's contract is "every save snapshots").
 *   - No global byte budget — see the rationale block below.
 *
 * What this module DOES preserve from the versions.js contract:
 *   - sha256 of `JSON.stringify(value)` is the content fingerprint.
 *   - Capturing an identical-sha value back-to-back is a no-op
 *     (returns the existing latest entry, does not bloat history).
 *   - Per-key retention cap (default 50) drops oldest beyond N on
 *     every capture.
 *   - List ordering is newest-first by `ts`.
 *
 * Storage adapter shape (the caller injects this):
 *
 *   storage = {
 *     // Return the current array of entries for `key`, or [] when absent.
 *     // Implementations MUST tolerate corrupt JSON by returning [].
 *     getList(key)         → Promise<Array<{ts, sha256, value}>>
 *
 *     // Persist a new entries array for `key` (replaces the whole list).
 *     // The caller passes the post-prune array; this is a single-write op.
 *     setList(key, entries) → Promise<void>
 *   }
 *
 * The `{getList, setList}` shape (rather than an `append`/`prune` split)
 * keeps the persistence atomic from the storage's perspective — one
 * read, one write per capture — which matches what localStorage and
 * AsyncStorage can offer without race-prone partial updates.
 *
 * Budget cap — INTENTIONALLY UNENFORCED HERE
 * ------------------------------------------
 * versions.js carries a `DEFAULT_VERSIONS_BUDGET_MB` (100 MB) global
 * cap on top of per-file retention.  We don't replicate that here:
 *
 *   - Per-key retention of 50 entries × typical kring blob size (under
 *     10 KB normalised JSON) → ~500 KB per circle per store.  Three
 *     stores × a few dozen circles still fits in low-MB territory,
 *     well within localStorage's 5–10 MB origin quota and AsyncStorage's
 *     typical multi-MB ceiling.
 *   - Adding a cross-key byte budget would require walking every key
 *     on every capture (the storage adapter has no enumeration API),
 *     which contradicts the "one read, one write per capture" shape.
 *
 * γ.3 (the 3-way merge pass) may revisit this if telemetry shows the
 * history trending high; the contract here is forward-compatible
 * (callers don't see the budget, so adding one later is non-breaking).
 */

import { sha256Of } from './versions.js';

/** Per-key cap.  Matches versions.js's DEFAULT_VERSIONS_PER_FILE. */
export const DEFAULT_OBJECT_VERSIONS_PER_KEY = 50;

/**
 * Capture a snapshot of `value` under `key` via the injected `storage`.
 *
 * Behaviour:
 *   - Hashes `JSON.stringify(value)` (sha256) — the same fingerprint
 *     versions.js uses for content identity.
 *   - If the most recent entry has the same sha, returns that entry
 *     untouched (no write).  This dedupes idempotent saves (the kring
 *     stores normalise + persist on every edit; persisting the same
 *     normalised value twice should not bloat the history).
 *   - Otherwise prepends `{ts, sha256, value}` to the list, prunes to
 *     `retention.perKey` (default 50), and persists.
 *
 * @param {object} args
 * @param {{getList:Function, setList:Function}} args.storage
 * @param {string} args.key
 * @param {*}      args.value           value to snapshot (must be JSON-safe)
 * @param {number} [args.now]           override `Date.now()` (test seam)
 * @param {{perKey?:number}} [args.retention]
 * @returns {Promise<{captured:boolean, ts:number, sha256:string, value:*}>}
 *   `captured: false` when the value was deduped against the latest entry.
 *   On dedup, `ts`/`sha256`/`value` reflect the EXISTING latest entry.
 */
export async function captureObjectVersion({ storage, key, value, now, retention } = {}) {
  if (!storage || typeof storage.getList !== 'function' || typeof storage.setList !== 'function') {
    throw new TypeError('captureObjectVersion: storage must implement {getList, setList}');
  }
  if (typeof key !== 'string' || !key) {
    throw new TypeError('captureObjectVersion: key must be a non-empty string');
  }
  const perKey = Number.isFinite(retention?.perKey) && retention.perKey > 0
    ? Math.floor(retention.perKey)
    : DEFAULT_OBJECT_VERSIONS_PER_KEY;

  // JSON.stringify is the canonical fingerprint.  Values that don't
  // round-trip through JSON (functions, BigInt, undefined) are out of
  // scope — the kring stores only ever pass normalised plain-object
  // policy/recipe/rules blobs.
  const serialised = JSON.stringify(value);
  const sha = sha256Of(serialised);
  const at  = typeof now === 'number' && Number.isFinite(now) ? now : Date.now();

  const list = await readListSafe(storage, key);
  const newest = list[0];
  if (newest && newest.sha256 === sha) {
    // Idempotent save — return the existing latest entry without writing.
    return { captured: false, ts: newest.ts, sha256: newest.sha256, value: newest.value };
  }

  // Round-trip the value through JSON so the stored snapshot can never
  // accidentally hold a reference the caller mutates after capture.
  const snapshotValue = serialised === undefined ? null : JSON.parse(serialised);
  const entry = { ts: at, sha256: sha, value: snapshotValue };

  // Prepend (newest-first) and prune oldest beyond perKey.
  const next = [entry, ...list].slice(0, perKey);

  await storage.setList(key, next);

  return { captured: true, ts: entry.ts, sha256: entry.sha256, value: entry.value };
}

/**
 * List all captured versions for `key`, newest-first.  Returns []
 * when no history exists.  Tolerates a corrupt / non-array stored
 * value (returns []).
 */
export async function listObjectVersions({ storage, key } = {}) {
  if (!storage || typeof storage.getList !== 'function') {
    throw new TypeError('listObjectVersions: storage must implement getList');
  }
  if (typeof key !== 'string' || !key) return [];
  return readListSafe(storage, key);
}

/**
 * Return the newest captured version for `key`, or `null` when no
 * history exists.  Convenience over `listObjectVersions(...)[0]`.
 */
export async function getLatestObjectVersion({ storage, key } = {}) {
  const list = await listObjectVersions({ storage, key });
  return list.length > 0 ? list[0] : null;
}

/**
 * Read + normalise the stored list.  Coerces non-arrays to [], drops
 * entries that don't carry `{ts:number, sha256:string}` (value may be
 * any JSON-safe shape; missing values become null on the way out so
 * callers don't see `undefined`).  Re-sorts newest-first defensively
 * — the writer always prepends, but a hand-edited storage blob could
 * be in any order.
 */
async function readListSafe(storage, key) {
  let raw;
  try { raw = await storage.getList(key); }
  catch { return []; }
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue;
    const ts = Number(e.ts);
    if (!Number.isFinite(ts)) continue;
    if (typeof e.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(e.sha256)) continue;
    out.push({ ts, sha256: e.sha256, value: e.value === undefined ? null : e.value });
  }
  out.sort((a, b) => b.ts - a.ts);
  return out;
}
