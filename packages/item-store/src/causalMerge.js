/**
 * causalMerge — origin-timestamp + writer-id causal LWW for inbound item ingest (Objective L).
 *
 * THE PROBLEM (v0 was last-received-wins): `CircleItemStore.put` re-stamped `updatedAt` to the local ingest
 * time, so when a peer's item arrived it overwrote the local copy purely because it arrived LATER — even when
 * the local copy was causally NEWER. Arrival order clobbered causal order.
 *
 * THE FIX (this module): decide the winner by the item's ORIGIN clock, not by arrival. Each item already carries
 * `updatedAt` (the origin's write time — an ISO string or epoch number) and `updatedBy` (the writer id). Those
 * two fields ARE a coarse causal coordinate, so no new item field is required: the refinement is that inbound
 * ingest PRESERVES `updatedAt`/`updatedBy` from the payload instead of re-stamping them (see CircleItemStore.put
 * `origin:true`), and this comparator picks the causally-newer side.
 *
 * DESIGN CHOICE — origin-timestamp + writer-id causal LWW, NOT a full per-writer version vector.
 *   • Guarantees: an inbound item that is causally OLDER (earlier origin `updatedAt`) can NOT overwrite a newer
 *     local edit; a causally-NEWER inbound wins; two truly concurrent edits (equal `updatedAt`) resolve by a
 *     DETERMINISTIC tiebreak on writer id — so every peer converges to the SAME survivor regardless of the order
 *     envelopes arrived. That is exactly what stops arrival-order clobbering.
 *   • Limits: this is last-WRITER-wins at ITEM granularity, not a field-level merge — the losing side of a true
 *     concurrent edit is dropped whole (its distinct fields are not merged in). A full version vector (per-writer
 *     counters) would additionally DETECT concurrency vs causal descent and enable a 3-way field merge, but it is
 *     heavier (every writer must maintain + ship a counter map, and ingest must merge vectors). `sync-engine`'s
 *     `objectDiff` does a 3-way field merge but requires a per-item "last common state" (base) history, which the
 *     CircleItemStore substrate does not keep per item (`objectVersions` history is wired for the kring stores,
 *     not items). So reusing it here would mean inventing that base-state store — out of scope for the smallest
 *     correct fix. This LWW is the documented first step; upgrading to a vector is additive on top of it.
 *
 * BACKWARD COMPATIBILITY: a payload with no parseable `updatedAt` can not be causally ordered, so it falls back
 * to today's last-received-wins ('incoming' always applies). Items therefore ingest unchanged when a peer hasn't
 * been upgraded to send origin metadata — the change is additive, never a crash.
 */

/**
 * The causal coordinate of an item: `{ at, by }`.
 *   at — numeric origin clock parsed from `updatedAt` (epoch number as-is, ISO string via Date.parse);
 *        `NaN` when absent/unparseable (⇒ "no comparable clock").
 *   by — writer id (`updatedBy`) used only as the concurrency tiebreak; `''` when absent.
 * @param {object} item
 * @returns {{ at: number, by: string }}
 */
export function causalRank(item) {
  const raw = item == null ? undefined : item.updatedAt;
  let at = NaN;
  if (typeof raw === 'number') at = raw;
  else if (typeof raw === 'string') at = Date.parse(raw);
  const by = (item && typeof item.updatedBy === 'string') ? item.updatedBy : '';
  return { at, by };
}

/**
 * Decide which side to keep when an inbound item meets the local copy.
 *
 * @param {object|null|undefined} local     the currently-stored item (has a stamped `updatedAt`), or null/absent
 * @param {object} incoming                 the inbound PAYLOAD (its `updatedAt` is the origin clock, if present)
 * @returns {'incoming'|'local'}
 *   - no local                          → 'incoming' (first arrival / create)
 *   - incoming has no comparable clock  → 'incoming' (backward-compat last-received-wins)
 *   - local has no comparable clock     → 'incoming' (local predates metadata; accept the clock-bearing update)
 *   - incoming.updatedAt >  local       → 'incoming' (causally newer wins)
 *   - incoming.updatedAt <  local       → 'local'    (causally OLDER inbound must NOT clobber)
 *   - equal updatedAt, higher writer id → 'incoming' (deterministic concurrency tiebreak)
 *   - otherwise (fully equal / lower)   → 'local'    (idempotent: no rewrite, no churn)
 */
export function causalWinner(local, incoming) {
  if (!local) return 'incoming';
  const L = causalRank(local);
  const I = causalRank(incoming);
  const iHas = Number.isFinite(I.at);
  const lHas = Number.isFinite(L.at);
  if (!iHas) return 'incoming';   // incoming un-ordered → last-received-wins fallback
  if (!lHas) return 'incoming';   // local predates origin metadata → accept the update
  if (I.at > L.at) return 'incoming';
  if (I.at < L.at) return 'local';
  // Concurrent (identical origin clock): deterministic tiebreak on writer id so every
  // peer converges to the same survivor irrespective of arrival order. Ties (same writer,
  // idempotent redelivery) keep local — a no-op.
  return I.by > L.by ? 'incoming' : 'local';
}
