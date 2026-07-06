// canopy-chat v2 — kring chat SEND primitives, shared by web (circleApp.js) and mobile
// (CircleLauncherScreen.js). The optimistic-append EVENT shape and the best-effort fan-out (with δ.2
// delivery-state transitions) were duplicated near-identically on both platforms; this is the one copy
// (web↔mobile consolidation Phase 2). Platform-neutral: the caller injects the RAW 3-arg callSkill, the
// δ.2 deliveryState map, and an `onChange` rerender hook (web `rerender()` / RN `setDeliveryTick`).

/**
 * Build the optimistic kring chat-message event for the local (append-only) EventLog. The same `msgId`
 * is later passed to `broadcastKringFanOut`, so receiver-side dedup suppresses any mirrored echo.
 *
 * @param {{msgId:string, ts:number, circleId:string, actor:string, text:string, buttons?:Array, scope?:string, embeds?:Array}} a
 */
export function kringChatMessageEvent({ msgId, ts, circleId, actor, text, buttons, scope, embeds }) {
  return {
    id: msgId, ts, app: 'kring', type: 'chat-message', actor,
    // `scope` ('self' | 'kring') — is this message private to you or shared with the
    // whole kring (a data property; the badge is one presentation of it). See messageScope.js.
    // `embeds` ([{type,ref,title?}]) — cross-object references this message carries (a bot
    // reply pointing at the task/event it just acted on); rendered as "See also" chips.
    payload: {
      circleId, text, kind: 'chat-message',
      ...(buttons?.length ? { buttons } : {}),
      ...(scope ? { scope } : {}),
      ...(embeds?.length ? { embeds } : {}),
    },
  };
}

/**
 * Best-effort fan-out of a kring chat message to the circle's members via stoop's
 * `broadcastKringMessage`, tracking δ.2 delivery state (pending → sent | failed). Uses the RAW 3-arg
 * callSkill (app-targeted at stoop) — the 2-arg *resolving* callSkill arg-shifts (op→'stoop') and never
 * delivers. Fire-and-forget for callers; returns the promise so tests can await it.
 *
 * @param {object} a
 * @param {(app:string, op:string, args:object)=>Promise<any>} a.rawCallSkill
 * @param {string} a.circleId
 * @param {string} a.msgId
 * @param {string} a.text
 * @param {number} a.ts
 * @param {{set:(id:string, state:string|null)=>void}} a.deliveryStateMap
 * @param {()=>void} [a.onChange]   rerender hook fired on each state transition
 * @returns {Promise<void>}
 */
// Per-recipient failure reasons that retrying can NEVER fix (vs a transient
// transport/offline error). A fan-out that ONLY hit these is `undeliverable`
// (the UI shows it, but offers no pointless retry); anything else is `failed`
// (retryable). `recipient-pubkey-unknown` = the member has no published key, so
// there's nobody to encrypt to until they publish one.
export const PERMANENT_FANOUT_REASONS = new Set(['recipient-pubkey-unknown']);

/**
 * Classify a `broadcastKringMessage` result → a delivery state.
 *   'sent'          — no per-recipient errors.
 *   'failed'        — a whole-op error OR at least one TRANSIENT recipient error (retryable).
 *   'undeliverable' — every recipient error is permanent (retry can't help) — NOT retryable.
 * @returns {'sent'|'failed'|'undeliverable'}
 */
export function classifyFanOut(r) {
  if (r?.error) return 'failed';                 // chat-unavailable / members-unavailable → transient
  const errors = Array.isArray(r?.errors) ? r.errors : [];
  if (errors.length === 0) return 'sent';
  if (errors.some((e) => !PERMANENT_FANOUT_REASONS.has(e?.reason))) return 'failed';
  return 'undeliverable';                         // all permanent
}

export function broadcastKringFanOut({ rawCallSkill, circleId, msgId, text, ts, deliveryStateMap, onChange }) {
  if (typeof rawCallSkill !== 'function') return Promise.resolve();
  const mark = (state) => { deliveryStateMap.set(msgId, state); onChange?.(); };
  mark('pending');
  return Promise.resolve()
    .then(() => rawCallSkill('stoop', 'broadcastKringMessage', { groupId: circleId, text, msgId, ts }))
    .then((r) => {
      const state = classifyFanOut(r);
      if (state !== 'sent') console.info('[kring-chat] fan-out', state, '—', r?.error ?? r?.errors);
      mark(state);
    })
    .catch((err) => { console.warn('[kring-chat] fan-out failed:', err?.message ?? err); mark('failed'); });
}
