/**
 * ping.js — round-trip latency measurement.
 *
 * Uses AS (AckSend) so Transport handles the ACK automatically.
 * Returns latency in ms, or null on timeout.
 */

/**
 * @param {import('../Agent.js').Agent} agent
 * @param {string} peerId
 * @param {number} [timeout=5000]
 * @returns {Promise<number|null>} round-trip ms, or null on timeout
 */
export async function ping(agent, peerId, timeout = 5_000) {
  const t0 = Date.now();
  try {
    // Per-peer routing — `agent.transport` is the primary slot
    // (InternalTransport on mobile) and only handles self-loop;
    // ping'ing a remote peer through it would silently drop.
    const t = await agent.transportFor(peerId);
    await t.sendAck(peerId, { type: 'ping' }, timeout);
    return Date.now() - t0;
  } catch {
    return null;
  }
}
