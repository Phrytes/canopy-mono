/**
 * basis v2 — ε.2: per-group catch-up strategy router (substrate).
 *
 * Today's catch-up code is one-size-fits-all: every reconnect pings peers
 * regardless of where the kring's data actually lives.  The kring's
 * `policy.pod` axis (`'shared' | 'personal' | 'hybrid' | 'none'`) already
 * encodes that — this module is the substrate that branches on it:
 *
 *   - pod: 'shared'   → range-query the pod (pod is authority; no peer
 *                       consent needed for member reads).
 *   - pod: 'personal' → peer-to-peer catch-up (today's path).
 *   - pod: 'hybrid'   → both: pod primary + peers as backfill.
 *   - pod: 'none'     → peer-to-peer (no pod to query).
 *
 * This slice is pure decision logic + a thin dispatcher.  Actual
 * implementations of the 'pod' / 'hybrid' paths are deferred to ε.3
 * (small follow-up: a pod range-query skill); the 'peer' path reuses
 * what exists today via an injected handler.  ε.1 (chatMessageInbox)
 * lands first, then ε.1 + ε.2 are wired together into the hosts so
 * the strategy router doesn't multiply insertion points.
 *
 * Pure JS — no I/O, no clock, no random.  Deterministic for tests.
 */

import { CIRCLE_POLICY_ENUMS } from './circlePolicy.js';

/**
 * The pod-axis values catchUpStrategy knows about.  Sourced from
 * circlePolicy.CIRCLE_POLICY_ENUMS.pod so this module can't drift
 * away from the canonical policy shape.
 *
 * @type {ReadonlyArray<'none' | 'shared' | 'personal' | 'hybrid'>}
 */
export const KNOWN_POD_AXES = Object.freeze([...CIRCLE_POLICY_ENUMS.pod]);

/**
 * The catch-up strategies this dispatcher can route to.
 *
 * - 'pod'    — pod range-query only.
 * - 'peer'   — peer-to-peer catch-up only (today's path).
 * - 'hybrid' — pod primary + peers as backfill.
 * - 'none'   — explicit no-op (caller logs "skipped" the same way
 *              today's `[catch-up] skipped` log does).
 *
 * @type {ReadonlyArray<'pod' | 'peer' | 'hybrid' | 'none'>}
 */
export const CATCH_UP_STRATEGIES = Object.freeze(['pod', 'peer', 'hybrid', 'none']);

/**
 * Decision logic: given a kring policy, return the right catch-up
 * strategy.  Single source of truth for the pod-axis → strategy
 * mapping; ε.3-5 plug their implementations in via {@link scheduleCatchUp}
 * below.
 *
 * Forward-compat: unknown / missing pod axes fall back to 'peer' — the
 * existing path is the safest default for an unknown axis (it won't
 * try to hit a pod that may not exist).
 *
 * @param {object|null|undefined} policy  — circle policy doc (the `circle.policy.*` shape).
 * @returns {'pod' | 'peer' | 'hybrid' | 'none'}
 */
export function pickCatchUpStrategy(policy) {
  const podAxis = policy?.pod;
  switch (podAxis) {
    case 'shared':   return 'pod';
    case 'personal': return 'peer';
    case 'hybrid':   return 'hybrid';
    case 'none':     return 'peer';   // no pod → peer is the only option
    default:         return 'peer';   // forward-compat: unknown axis → safest existing path
  }
}

/**
 * Dispatcher: route a catch-up request through the right backend based
 * on the policy.  Substrate-shaped — implementations are injected via
 * `handlers`, so this module stays I/O-free and the actual pod /
 * peer code can land in ε.3+ without touching this file again.
 *
 * Failure semantics:
 *   - missing handler → result entry with status='deferred' (the
 *     follow-up slice hasn't wired its implementation yet).
 *   - handler throws  → result entry with status='error' + reason.
 *   - handler returns → result entry with status='ok' + result.
 *
 * Both paths are awaited sequentially for 'hybrid' (pod first, then
 * peer as backfill) — keeps the trace order predictable and avoids
 * thundering both backends at once on reconnect.
 *
 * @param {object}   args
 * @param {string}   args.circleId
 * @param {object}   args.policy
 * @param {object}   args.handlers
 * @param {Function} [args.handlers.podRangeQuery] — `({circleId, sinceTs}) => Promise<*>` — ε.3 implements.
 * @param {Function} [args.handlers.peerCatchUp]   — `({circleId, sinceTs}) => Promise<*>` — wraps existing stoop catch-up.
 * @param {object}   [args.opts]
 * @param {number}   [args.opts.sinceTs]           — defaults to 0 (full history; receiver caps via ε.4 later).
 * @returns {Promise<{strategy: 'pod'|'peer'|'hybrid'|'none', results: Array<{path: 'pod'|'peer', status: 'ok'|'deferred'|'error', result?: *, reason?: string}>}>}
 */
export async function scheduleCatchUp({ circleId, policy, handlers, opts = {} } = {}) {
  const strategy = pickCatchUpStrategy(policy);
  const sinceTs  = Number.isFinite(opts.sinceTs) ? opts.sinceTs : 0;
  const results  = [];

  const runPod = async () => {
    if (typeof handlers?.podRangeQuery !== 'function') {
      return { path: 'pod', status: 'deferred', reason: 'no podRangeQuery handler (ε.3)' };
    }
    try {
      const r = await handlers.podRangeQuery({ circleId, sinceTs });
      return { path: 'pod', status: 'ok', result: r };
    } catch (err) {
      return { path: 'pod', status: 'error', reason: String(err?.message ?? err) };
    }
  };

  const runPeer = async () => {
    if (typeof handlers?.peerCatchUp !== 'function') {
      return { path: 'peer', status: 'deferred', reason: 'no peerCatchUp handler' };
    }
    try {
      const r = await handlers.peerCatchUp({ circleId, sinceTs });
      return { path: 'peer', status: 'ok', result: r };
    } catch (err) {
      return { path: 'peer', status: 'error', reason: String(err?.message ?? err) };
    }
  };

  if (strategy === 'pod')    results.push(await runPod());
  if (strategy === 'peer')   results.push(await runPeer());
  if (strategy === 'hybrid') { results.push(await runPod()); results.push(await runPeer()); }
  // 'none' → empty results array; caller logs "skipped" the same way
  // today's [catch-up] skipped does.

  return { strategy, results };
}
