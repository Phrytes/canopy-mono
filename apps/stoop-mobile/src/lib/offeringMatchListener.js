/**
 * offeringMatchListener — pure helpers for the OfferingMatchInboxScreen.
 *
 * Stoop V3 Phase 40.20 (2026-05-08).
 *
 * The mobile OfferingMatchInboxScreen subscribes to
 * `agent.on('offering-match-suggestion', ...)` events that the bundle
 * emits via the OfferingMatch substrate's `appHandler` bridge.  Each
 * event carries `{request, decide}` — `request` is the published
 * payload + a `fromExtraAudience` flag (Phase 40.20 substrate
 * extension), `decide('claim'|'decline')` is the substrate-supplied
 * resolution callback.
 *
 * This module exposes pure-data helpers — the live event handler
 * lives inside the screen component.
 */

/**
 * Source-scope chip label.  Maps the substrate's `scope` +
 * `fromExtraAudience` fields onto a human-readable origin badge.
 *
 * @param {object} request
 * @returns {'group' | 'contact' | 'hop' | 'unknown'}
 */
export function classifyOrigin(request) {
  if (!request) return 'unknown';
  if (!request.fromExtraAudience) return 'group';
  // Within extra-audience, distinguish contacts vs hops by scope.
  // SDK request payload carries `scope`. When the broadcaster set
  // 'group+contacts+hops', the receiver doesn't know which sub-bucket
  // they fell into, so we render 'contact' as the default extra-
  // audience label and 'hop' only when the request payload explicitly
  // tags it.  (Future substrate extension can disambiguate via a
  // per-pubkey roster lookup; for V1 we lean on the broadcaster's
  // tag.)
  const tag = request.payload?.originTag;
  if (tag === 'hop') return 'hop';
  return 'contact';
}

/**
 * Append a fresh suggestion to a bounded list, dropping the oldest
 * when over `max`. Pure; useful for the inbox state machine.
 *
 * @param {Array<object>} list
 * @param {object} entry
 * @param {number} [max=50]
 */
export function appendSuggestion(list, entry, max = 50) {
  if (!entry) return list;
  const next = [entry, ...(list ?? [])];
  if (next.length <= max) return next;
  return next.slice(0, max);
}

/**
 * De-duplicate suggestions by `request.requestId`. Most-recent wins.
 *
 * @param {Array<object>} list
 * @returns {Array<object>}
 */
export function dedupSuggestions(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out  = [];
  for (const e of list) {
    const id = e?.request?.requestId;
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    out.push(e);
  }
  return out;
}
