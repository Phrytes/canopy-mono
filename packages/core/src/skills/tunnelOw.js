/**
 * tunnelOw — OW pass-through for an open tunnel (Group CC).
 *
 * Plaintext mode (CC3a):
 *   Payload: [DataPart({ tunnelId, inner: { type, taskId, parts? } })]
 *   Only the session's `aliceAddr` may push.  Bob rewrites inner.taskId
 *   to carolTaskId and forwards as a raw OW.  Carol's OWs flow back via
 *   Task listeners on Bob's carolTask (see tunnelOpen.js).
 *
 * Sealed mode (CC3b):
 *   Payload: [DataPart({ tunnelId, sealedInner: { sealed, nonce } })]
 *   EITHER endpoint may push (Carol has no Bob-side Task to hang her
 *   OWs off in sealed mode, so she pushes via tunnel-ow too).  Bob has
 *   no K — he forwards as a `sealed-tunnel-ow` OW (type carried in the
 *   OW header, not in the ciphertext).  The receiver decrypts with K
 *   and re-dispatches the inner through handleTaskOneWay.
 *
 * See `Design-v3/hop-tunnel.md § 5.2` (plaintext) and § 7 (sealed).
 */
import { Parts, DataPart } from '../Parts.js';

/**
 * Register the tunnel-ow skill on the given agent.  Requires a prior
 * `registerTunnelOpen(agent)` — the two share `agent._tunnelSessions`.
 *
 * Idempotent.
 *
 * @param {import('../Agent.js').Agent} agent
 */
export function registerTunnelOw(agent) {
  const sessions = agent._tunnelSessions;
  if (!sessions) {
    throw new Error(
      'registerTunnelOw: registerTunnelOpen must be called first ' +
      '(or use agent.enableTunnelForward()).',
    );
  }
  if (agent.skills?.get?.('tunnel-ow')) return;

  agent.register('tunnel-ow', async ({ parts, from }) => {
    const d = Parts.data(parts) ?? {};
    const { tunnelId, inner, sealedInner } = d;
    if (!tunnelId || (!inner?.type && !sealedInner)) {
      return [DataPart({ error: 'missing tunnelId or inner / sealedInner' })];
    }

    const row = sessions.get(tunnelId);
    if (!row) {
      return [DataPart({ error: 'unknown-tunnel' })];
    }

    // ── Sealed mode: EITHER endpoint may push, Bob forwards opaque. ────────
    if (sealedInner) {
      if (!row.sealed) {
        return [DataPart({ error: 'sealed-payload-on-plaintext-tunnel' })];
      }
      const isAlice = from === row.aliceAddr;
      const isCarol = from === row.carolAddr;
      if (!isAlice && !isCarol) {
        return [DataPart({ error: 'tunnel-denied: not tunnel owner' })];
      }
      const dstAddr = isAlice ? row.carolAddr : row.aliceAddr;
      if (!sealedInner.sealed || !sealedInner.nonce) {
        return [DataPart({ error: 'sealedInner missing sealed/nonce' })];
      }

      try {
        const t = typeof agent.transportFor === 'function'
          ? await agent.transportFor(dstAddr)
          : agent.transport;
        await t.sendOneWay(dstAddr, {
          type:     'sealed-tunnel-ow',
          tunnelId,
          sealed:   sealedInner.sealed,
          nonce:    sealedInner.nonce,
        });
        return [DataPart({ forwarded: true, sealed: true })];
      } catch (err) {
        return [DataPart({ error: `tunnel-forward-failed: ${err?.message ?? err}` })];
      }
    }

    // ── Plaintext mode: only the session's Alice may push. ────────────────
    if (row.sealed) {
      return [DataPart({ error: 'plaintext-payload-on-sealed-tunnel' })];
    }
    if (from !== row.aliceAddr) {
      return [DataPart({ error: 'tunnel-denied: not tunnel owner' })];
    }

    const rewritten = { ...inner, taskId: row.carolTaskId };
    if (inner.type === 'cancel') sessions.markClosing(tunnelId, 'alice-cancel');

    try {
      const t = typeof agent.transportFor === 'function'
        ? await agent.transportFor(row.carolAddr)
        : agent.transport;
      await t.sendOneWay(row.carolAddr, rewritten);
      return [DataPart({ forwarded: true })];
    } catch (err) {
      return [DataPart({ error: `tunnel-forward-failed: ${err?.message ?? err}` })];
    }
  }, {
    visibility:  'authenticated',
    description: 'Forward a task-scoped OW through an open tunnel',
  });
}
