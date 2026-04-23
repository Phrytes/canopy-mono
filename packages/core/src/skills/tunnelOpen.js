/**
 * tunnelOpen — open a hop-aware task tunnel (Group CC).
 *
 * The bridge (Bob) registers this skill; Alice calls it to ask Bob to
 * open a long-lived bidirectional session for an inner skill call to
 * Carol.  Unlike `relay-forward` (one-shot, awaits terminal), this
 * kicks off `agent.call(...)` — which returns a Task immediately — and
 * responds to Alice right away with `{ tunnelId, aliceTaskId }`.
 *
 * Task-scoped OWs from Carol are forwarded back to Alice by listening
 * on the local Task object (stream-chunk, input-required, done).
 * Task-scoped OWs from Alice (cancel, task-input) are forwarded to
 * Carol via the paired `tunnel-ow` skill (see tunnelOw.js).
 *
 * See `Design-v3/hop-tunnel.md § 5` for the wire protocol and §6-§7
 * for origin-sig + sealed-mode decisions.
 */
import { Parts, DataPart } from '../Parts.js';
import { genId }            from '../Envelope.js';
import { TIER_LEVEL }       from '../permissions/TrustRegistry.js';
import { TunnelSessions }   from './tunnelSessions.js';

/**
 * Register the tunnel-open skill on the given agent.
 *
 * Idempotent — the second call returns the same session table so the
 * convenience method `agent.enableTunnelForward()` and a manual call
 * play nicely together.
 *
 * @param {import('../Agent.js').Agent} agent
 * @param {object} [opts]
 * @param {'never'|'authenticated'|'trusted'|`group:${string}`|'always'} [opts.policy]
 *        If omitted, reads `agent.config.get('policy.allowTunnelFor')`,
 *        then falls back to `policy.allowRelayFor`, then 'never'.
 * @returns {TunnelSessions} the session table backing this skill
 */
export function registerTunnelOpen(agent, opts = {}) {
  const existing = agent._tunnelSessions;
  if (existing) return existing;

  const sessions = new TunnelSessions();
  sessions.start();
  agent._tunnelSessions = sessions;

  const policyOverride = opts.policy;

  agent.register('tunnel-open', async ({ parts, from }) => {
    // ── Policy ───────────────────────────────────────────────────────────────
    const policy =
      policyOverride
      ?? agent.config?.get?.('policy.allowTunnelFor')
      ?? agent.config?.get?.('policy.allowRelayFor')
      ?? 'never';

    if (policy === 'never') {
      return [DataPart({ error: 'tunnel-not-enabled' })];
    }
    if (policy === 'authenticated') {
      if (!agent.security?.getPeerKey?.(from)) {
        return [DataPart({ error: 'tunnel-denied: not authenticated' })];
      }
    } else if (policy === 'trusted') {
      const tierName  = await agent.trustRegistry?.getTier?.(from) ?? 'public';
      const tierLevel = TIER_LEVEL[tierName] ?? 0;
      if (tierLevel < TIER_LEVEL.trusted) {
        return [DataPart({ error: 'tunnel-denied: trust tier too low' })];
      }
    } else if (typeof policy === 'string' && policy.startsWith('group:')) {
      const groupId  = policy.slice('group:'.length);
      const hasProof = await agent.security?.groupManager?.hasValidProof?.(from, groupId) ?? false;
      if (!hasProof) {
        return [DataPart({ error: `tunnel-denied: not a member of group ${groupId}` })];
      }
    }

    // ── Input validation ─────────────────────────────────────────────────────
    const d = Parts.data(parts);
    if (!d?.targetPubKey) return [DataPart({ error: 'missing targetPubKey' })];
    if (!d?.skill)        return [DataPart({ error: 'missing skill' })];

    const record = await agent.peers?.get?.(d.targetPubKey);
    if (!record || !record.reachable) {
      return [DataPart({ error: 'target-unreachable' })];
    }
    if (d.targetPubKey === from) {
      return [DataPart({ error: 'tunnel-loop: target is the caller' })];
    }

    // ── Kick off the inner call (returns a pre-terminal Task) ────────────────
    const payload = Parts.wrap(d.payload ?? []);

    let carolTask;
    try {
      carolTask = agent.call(d.targetPubKey, d.skill, payload, {
        origin:    from,                        // caller's pubKey
        originSig: d.originSig ?? null,
        originTs:  d.originTs  ?? null,
        timeout:   d.timeout   ?? 30_000,
      });
    } catch (err) {
      return [DataPart({ error: `tunnel-call-failed: ${err?.message ?? err}` })];
    }

    // ── Session row ──────────────────────────────────────────────────────────
    // Alice passes her local taskId so incoming OWs from us can be dispatched
    // to her outer Task without aliasing.  Fall back to generating one if
    // the caller didn't supply it (keeps the skill usable from tests and
    // low-level tooling).
    const tunnelId    = genId();
    const aliceTaskId = typeof d.aliceTaskId === 'string' && d.aliceTaskId
      ? d.aliceTaskId
      : genId();

    const row = sessions.add({
      tunnelId,
      aliceAddr:    from,
      aliceTaskId,
      carolAddr:    d.targetPubKey,
      carolTaskId:  carolTask.taskId,
      carolTask,
      originPubKey: from,
      originSig:    d.originSig ?? null,
      originTs:     d.originTs  ?? null,
      sealed:       !!d.sealed,
      ttlMs:        d.ttlMs ?? undefined,
    });

    // ── Bridge Carol-side OWs back to Alice ──────────────────────────────────
    // Bob's local Task receives stream-chunk / input-required / done
    // naturally via handleTaskOneWay — we just listen and retransmit with
    // taskId rewritten to aliceTaskId.
    carolTask.on('stream-chunk', (chunkParts) => {
      _forwardOW(agent, row, {
        type:   'stream-chunk',
        taskId: aliceTaskId,
        parts:  chunkParts,
      });
    });

    carolTask.on('input-required', (irParts) => {
      _forwardOW(agent, row, {
        type:   'input-required',
        taskId: aliceTaskId,
        parts:  irParts,
      });
    });

    carolTask.on('done', (snap) => {
      _forwardOW(agent, row, {
        type:   'tunnel-result',
        taskId: aliceTaskId,
        status: snap.state,          // 'completed' | 'cancelled' | 'expired'
        parts:  snap.parts ?? [],
        error:  snap.error,
      });
      sessions.drop(tunnelId, snap.state);
    });

    carolTask.on('failed', (error) => {
      _forwardOW(agent, row, {
        type:   'tunnel-result',
        taskId: aliceTaskId,
        status: 'failed',
        parts:  [],
        error,
      });
      sessions.drop(tunnelId, 'failed');
    });

    carolTask.on('expired', () => {
      _forwardOW(agent, row, {
        type:   'tunnel-result',
        taskId: aliceTaskId,
        status: 'expired',
        parts:  [],
      });
      sessions.drop(tunnelId, 'expired');
    });

    carolTask.on('cancelled', () => {
      _forwardOW(agent, row, {
        type:   'tunnel-result',
        taskId: aliceTaskId,
        status: 'cancelled',
        parts:  [],
      });
      sessions.drop(tunnelId, 'cancelled');
    });

    // Reply RS to Alice immediately.
    return [DataPart({ tunnelId, aliceTaskId, carolTaskId: carolTask.taskId })];
  }, {
    visibility:  'authenticated',
    description: 'Open a bidirectional task tunnel to an indirectly reachable peer',
  });

  return sessions;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function _forwardOW(agent, row, payload) {
  try {
    // Pick the right transport for Alice's address — agent.transport is the
    // primary, which may not reach her if the bridge is multi-homed (common
    // in the bridge use case).  transportFor respects the agent's routing.
    const t = typeof agent.transportFor === 'function'
      ? await agent.transportFor(row.aliceAddr)
      : agent.transport;
    await t.sendOneWay(row.aliceAddr, payload);
  } catch { /* best-effort; Alice's own timeouts cover chronic unreachability */ }
}
