/**
 * OfflineTransport — no-op transport used when no network interface is
 * available at agent start.
 *
 * Lets the agent reach `ready` state immediately; any attempt to send via
 * this transport fails fast with a clear message. Secondary transports
 * (relay, BLE, mDNS) can still join at runtime and the routing strategy
 * should prefer them.
 *
 * See EXTRACTION-PLAN.md §7 Group M.
 */
import { Transport } from './Transport.js';

export class OfflineTransport extends Transport {
  /**
   * @param {object|import('../identity/AgentIdentity.js').AgentIdentity} opts
   *   Either `{ identity }` or the identity itself (convenience).
   */
  constructor(opts = {}) {
    const identity = opts?.pubKey ? opts : opts.identity;
    if (!identity?.pubKey) {
      throw new Error('OfflineTransport requires identity with a pubKey');
    }
    super({ address: identity.pubKey, identity });
  }

  async connect()    {}
  async disconnect() {}

  /**
   * Routing hint (Group EE): offline transport never claims reach so it's
   * only selected by RoutingStrategy as the explicit null-fallback (via
   * Agent.transportFor → primary).  Returning false here keeps it out of
   * the normal candidate list.
   */
  canReach(_peerId) { return false; }

  async _put(to) {
    const hint = typeof to === 'string' && to.length ? to.slice(0, 16) : 'unknown';
    throw new Error(`Agent is offline — no transport can reach ${hint}`);
  }
}
