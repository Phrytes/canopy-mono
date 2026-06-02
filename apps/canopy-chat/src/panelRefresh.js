/**
 * canopy-chat — shared record-panel auto-refresh helpers (E3 / §B#10).
 *
 * When an item changes, any OPEN record / mini-page / embed-card panel
 * showing that item is stale and should re-fetch itself.  The web side
 * drives this from the EventRouter's `item-changed` delivery; the mobile
 * side drives it from the post-mutation reply (no EventRouter on RN).
 * Both share this pure matching + safety logic so the two stay in lock-
 * step.
 *
 * Pure / portable: zero DOM, zero RN, zero storage.
 */

/**
 * Verbs whose ops are safe to RE-RUN for an auto-refresh (pure reads).
 * A panel that was the reply to a MUTATION (e.g. `addTask` → a record of
 * the new task) must never be re-run on a later item-changed — that
 * would re-execute the mutation.  Anything not in this set keeps the
 * static "(stale)" badge instead of auto-refreshing.
 */
export const REFRESHABLE_VERBS = Object.freeze(
  new Set(['list', 'get', 'view', 'show', 'record', 'open', 'snapshot', 'find', 'brief']),
);

/**
 * Does a rendered reply represent an open panel showing `itemRef`'s item?
 * Matches record / mini-page panels by `payload.{id,type}` and embed-card
 * panels by `embed.itemRef.{id,app,type}` — the same predicate the web
 * thread store's `openPanelsForItemRef` used inline.
 *
 * @param {object} rendered  a RenderedReply
 * @param {{app?: string, type?: string|null, id: string}} itemRef
 * @returns {boolean}
 */
export function panelMatchesItemRef(rendered, itemRef) {
  if (!rendered || !itemRef || itemRef.id == null) return false;
  if ((rendered.kind === 'record' || rendered.kind === 'mini-page')
      && rendered.payload?.id === itemRef.id
      && (rendered.payload?.type ?? null) === (itemRef.type ?? null)) {
    return true;
  }
  if (rendered.kind === 'embed-card'
      && rendered.embed?.itemRef?.id === itemRef.id
      && rendered.embed?.itemRef?.app === itemRef.app
      && rendered.embed?.itemRef?.type === itemRef.type) {
    return true;
  }
  return false;
}

/**
 * Derive an `itemRef` from a dispatch reply so the post-mutation refresh
 * (mobile) knows which item changed.  Returns `null` when the reply has
 * no identifiable item (e.g. a plain text ack).
 *
 * @param {object} reply         a dispatch Reply (`{payload, ...}`)
 * @param {string} [appOrigin]   the op's app origin (fills `itemRef.app`)
 * @returns {{app: string|null, type: string|null, id: string} | null}
 */
export function itemRefFromReply(reply, appOrigin) {
  const p = reply?.payload;
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  const id = p.id ?? p.itemId;
  if (id == null || id === '') return null;
  return { app: appOrigin ?? p.app ?? null, type: p.type ?? null, id };
}

/**
 * Walk every thread and collect the open panel messages that show the
 * changed item AND are safe to auto-refresh (read-verb sourceDispatch /
 * sourceOp).  Used by the mobile post-mutation path; mirrors the web
 * EventRouter loop (which excludes the dispatching thread).
 *
 * Message shape is tolerated across web (`message.rendered`, `sourceOp`)
 * and mobile (`message.rendered`, `sourceDispatch`).
 *
 * @param {Array<{id: string, messages: Array<object>}>} threads
 *   thread list (e.g. mobile `listThreads(state)` output).
 * @param {object} args
 * @param {{app?: string, type?: string|null, id: string}} args.itemRef
 * @param {string}  [args.excludeThreadId]  thread to skip (the dispatching one)
 * @param {(opId: string) => boolean} [args.isRefreshable]
 *   gate on the panel's source op; defaults to "always refreshable".
 * @returns {Array<{threadId: string, message: object, sourceDispatch: object|null}>}
 */
export function collectStalePanels(threads, { itemRef, excludeThreadId, isRefreshable } = {}) {
  const out = [];
  if (!itemRef || !Array.isArray(threads)) return out;
  for (const thread of threads) {
    if (!thread || thread.id === excludeThreadId) continue;
    for (const m of thread.messages ?? []) {
      if (m.lifecycleState && m.lifecycleState !== 'live') continue;
      const rendered = m.rendered ?? null;
      if (!panelMatchesItemRef(rendered, itemRef)) continue;
      const src = m.sourceDispatch ?? m.sourceOp ?? null;
      const opId = src?.opId;
      if (!opId) continue;                          // no source → can't refresh
      if (isRefreshable && !isRefreshable(opId)) continue;
      out.push({ threadId: thread.id, message: m, sourceDispatch: src });
    }
  }
  return out;
}
