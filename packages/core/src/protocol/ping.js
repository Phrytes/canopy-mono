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
    await agent.transport.sendAck(peerId, { type: 'ping' }, timeout);
    return Date.now() - t0;
  } catch {
    return null;
  }
}
