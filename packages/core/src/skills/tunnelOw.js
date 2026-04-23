/**
 * tunnelOw — OW pass-through for an open tunnel (Group CC).
 *
 * The bridge (Bob) registers this skill; Alice calls it every time she
 * wants to push a task-scoped OW (cancel, task-input) to Carol through
 * the tunnel identified by tunnelId.  Carol-side OWs flow back to Alice
 * via Task listeners in tunnelOpen.js — they do NOT go through this
 * skill.
 *
 * Payload shape:
 *   [DataPart({ tunnelId, inner: { type, taskId, parts? } })]
 *
 * Bob's job:
 *   1. Look up the session row by tunnelId.
 *   2. Reject if the caller is not the session's Alice side
 *      (prevents a rogue peer from writing into someone else's tunnel).
 *   3. Rewrite inner.taskId from aliceTaskId → carolTaskId.
 *   4. Send the rewritten OW to Carol via sendOneWay.
 *   5. Observe terminal OWs (cancel) and mark the session closing.
 *
 * See `Design-v3/hop-tunnel.md § 5.2`.
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
    const { tunnelId, inner } = d;
    if (!tunnelId || !inner?.type) {
      return [DataPart({ error: 'missing tunnelId or inner' })];
    }

    const row = sessions.get(tunnelId);
    if (!row) {
      return [DataPart({ error: 'unknown-tunnel' })];
    }

    // Only the tunnel's Alice side may push OWs through this path.
    // (Carol's OWs flow back via the Task listeners in tunnelOpen.js.)
    if (from !== row.aliceAddr) {
      return [DataPart({ error: 'tunnel-denied: not tunnel owner' })];
    }

    // Rewrite taskId so Carol's side sees her own.
    const rewritten = { ...inner, taskId: row.carolTaskId };

    // If this is a terminal OW from Alice, mark the session closing.
    // We keep forwarding in-flight OWs; Bob drops the row once his
    // local carolTask emits its own terminal (task-result / cancelled /
    // expired) — that's handled by the listeners in tunnelOpen.js.
    if (inner.type === 'cancel') {
      sessions.markClosing(tunnelId, 'alice-cancel');
    }

    try {
      await agent.transport.sendOneWay(row.carolAddr, rewritten);
      return [DataPart({ forwarded: true })];
    } catch (err) {
      return [DataPart({ error: `tunnel-forward-failed: ${err?.message ?? err}` })];
    }
  }, {
    visibility:  'authenticated',
    description: 'Forward a task-scoped OW through an open tunnel',
  });
}
