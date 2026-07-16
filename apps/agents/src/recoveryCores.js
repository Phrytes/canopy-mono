/**
 * agents — data-recovery cores (P3, PLAN-pod-versioning-history-recovery).
 *
 * "Restore corrupted / lost data": pure cores over an injected
 * `versionStoreFor(circleId)` resolver — the host composition supplies the
 * platform's resolver (web: `circleVersioning.getCircleVersionStore`;
 * mobile: its RN twin), so the cores stay platform-blind and web ≡ mobile
 * by construction. Each circle pod's `@onderling/versioning` store holds the
 * DISPLACED bytes (overwrites · peer-updates · dropped concurrent forks ·
 * deletes) its pseudo-pod captured.
 *
 * Store shape here: `{ versionStoreFor?: (circleId) => store|null }` —
 * carried on the same injected store object as `{registry, tokens}` (see
 * wireSkills). Missing resolver / unknown circle → honest
 * `{ok:false, error}` (never a throw for a boundary miss).
 *
 * These ops live on the agents surface deliberately: J5/J7's recovery arc
 * is "revoke the misbehaving agent → restore what it touched" — one
 * surface, both halves. The manifest is the contract; relocating the ops
 * later (e.g. a dedicated my-data app) is cheap.
 */

/** Resolve the circle's version store, or null. */
function storeForCircle(store, circleId) {
  const resolve = store?.versionStoreFor;
  if (typeof resolve !== 'function') return null;
  if (typeof circleId !== 'string' || circleId.length === 0) return null;
  return resolve(circleId) ?? null;
}

/**
 * listDataVersions — without `uri`: every resource in the circle's pod
 * that has history (`listSeries`: uri · latestMs · count). With `uri`:
 * that resource's versions, newest-first (ts · id · sha256 · size ·
 * writer) — the pick-list for a restore.
 *
 * VIEW-PIPELINE ADDITIVE KEY (P3 UI slice): both list modes ALSO expose
 * the rows as `items: [{id, label, …row}]` — the shape the chat-shell
 * list renderer reads for `shape:'list'` sections (see basis
 * `realAgent.js` "the chat-shell renderer expects {items:[{id,label,…}]}"
 * + `screenModel.js` `buildScreenModel({items})`).  The domain keys
 * (`series` / `versions`) stay authoritative and unchanged — `items` is
 * a projection of the same rows, never a replacement.
 *   • series mode:   id ← uri,        label ← uri (row = the resource)
 *   • versions mode: id ← version id, label ← ISO(ts) · id (the pick-list)
 */
export async function listDataVersions(store, args = {}) {
  const versions = storeForCircle(store, args?.circleId);
  if (!versions) {
    return { ok: false, error: 'no-version-store', circleId: args?.circleId ?? null };
  }
  if (typeof args?.uri === 'string' && args.uri.length > 0) {
    const rows = await versions.list(args.uri);
    return {
      ok:       true,
      circleId: args.circleId,
      uri:      args.uri,
      versions: rows,
      items:    rows.map((v) => ({
        ...v,
        label: `${new Date(v.ts).toISOString()} · ${v.id}`,
      })),
    };
  }
  const series = await versions.listSeries();
  return {
    ok:       true,
    circleId: args.circleId,
    series,
    items:    series.map((s) => ({ ...s, id: s.uri, label: s.uri })),
  };
}

/**
 * restoreDataVersion — roll `uri` back to the snapshot at `version`
 * (numeric ts or full "<ts>-<writer>" id). UNDOABLE: the store snapshots
 * the current live content first (`snapshotMsBeforeRestore`), so a wrong
 * restore is itself restorable.
 */
export async function restoreDataVersion(store, args = {}) {
  const versions = storeForCircle(store, args?.circleId);
  if (!versions) {
    return { ok: false, error: 'no-version-store', circleId: args?.circleId ?? null };
  }
  const uri = args?.uri;
  const version = args?.version;
  if (typeof uri !== 'string' || uri.length === 0 || version == null || version === '') {
    return { ok: false, error: 'uri-and-version-required' };
  }
  try {
    const res = await versions.restore(uri, version);
    return { ok: true, circleId: args.circleId, ...res };
  } catch (err) {
    // Boundary misses (VERSION_NOT_FOUND / NOT_VERSIONABLE) come back as
    // structured errors, mirroring how callSkill surfaces skill errors.
    return { ok: false, error: err?.code ?? 'RESTORE_FAILED', message: err?.message ?? String(err) };
  }
}

export const RECOVERY_CORES = Object.freeze({
  listDataVersions,
  restoreDataVersion,
});
