/**
 * messaging.js — simple message send/receive.
 *
 * sendMessage: tries AS (acknowledged), falls back to OW on timeout.
 * handleMessage: dispatches inbound OW/AS to agent 'message' event.
 */
import { Parts } from '../Parts.js';

/**
 * Send a message to a peer. Tries acknowledged delivery; falls back to OW.
 *
 * @param {import('../Agent.js').Agent} agent
 * @param {string}   peerId
 * @param {Array|*}  partsOrValue
 * @param {object}   [opts]
 * @param {number}   [opts.ackTimeout=5000]
 * @param {boolean}  [opts.requireAck=false]  — throw if no ACK received
 */
export async function sendMessage(agent, peerId, partsOrValue, opts = {}) {
  const parts = Parts.wrap(partsOrValue);
  const { ackTimeout = 5_000, requireAck = false } = opts;
  // Per-peer routing — `agent.transport` is the primary slot which on
  // mobile is the InternalTransport (self-loop only).
  const t = await agent.transportFor(peerId);
  try {
    await t.sendAck(peerId, { type: 'message', parts }, ackTimeout);
  } catch (err) {
    if (requireAck) throw err;
    // Fall back to fire-and-forget over the same transport.
    await t.sendOneWay(peerId, { type: 'message', parts });
  }
}

/**
 * Handle an inbound OW or AS message envelope.
 * Emits 'message' on the agent.
 *
 * @param {import('../Agent.js').Agent} agent
 * @param {object} envelope
 */
export function handleMessage(agent, envelope) {
  const parts = envelope.payload?.parts ?? [];
  agent.emit('message', {
    from:  envelope._from,
    parts,
  });
}
