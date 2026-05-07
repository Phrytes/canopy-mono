/**
 * ProverAgent — phone-side agent that proves presence to a home agent.
 *
 * Flow:
 *   1. checkWifi() — did the OS confirm we're on a WiFi network?
 *   2. probeHomeAgent(homeWebid) — does our SDK transport reach
 *      the home agent via LAN-direct (mDNS / BLE), not via relay?
 *   3. If both yes: send a `requestAttestation` to the home agent.
 *      Home agent issues a token; prover holds it for short TTL.
 *
 * The prover doesn't talk to the home agent directly in V0 — it
 * uses a caller-supplied "transport" callback that resolves to the
 * home agent's `requestAttestation`.  This is what lets tests stub
 * everything without real BLE.
 *
 * Production: the transport function uses the SDK's existing
 * `transportFor(peerId)` to invoke the home agent's
 * `requestAttestation` skill.
 */

export class ProverAgent {
  /** @type {string} */ #subjectWebid;
  /** @type {string} */ #homeWebid;
  /** @type {import('./types.js').LocalPresenceProbe} */ #probe;
  /** @type {(args: object) => Promise<object>} */ #invokeHomeAgent;

  /**
   * @param {object} args
   * @param {string} args.subjectWebid                     this user's webid
   * @param {string} args.homeWebid                        target home agent's webid
   * @param {import('./types.js').LocalPresenceProbe} args.probe
   * @param {(args: {subject, signals}) => Promise<object>} args.invokeHomeAgent
   *   Production: skill-call into home agent's requestAttestation
   *   over the SDK transport.  Tests pass a direct callback.
   */
  constructor({ subjectWebid, homeWebid, probe, invokeHomeAgent }) {
    if (!subjectWebid) throw new TypeError('ProverAgent: subjectWebid required');
    if (!homeWebid)    throw new TypeError('ProverAgent: homeWebid required');
    if (!probe)        throw new TypeError('ProverAgent: probe required');
    if (typeof invokeHomeAgent !== 'function') {
      throw new TypeError('ProverAgent: invokeHomeAgent (function) required');
    }
    this.#subjectWebid    = subjectWebid;
    this.#homeWebid       = homeWebid;
    this.#probe           = probe;
    this.#invokeHomeAgent = invokeHomeAgent;
  }

  /**
   * Run the V0 attestation flow.  Returns either a valid token or
   * an error result describing why the request couldn't be issued.
   *
   * @returns {Promise<
   *   import('./types.js').AttestationToken |
   *   {error: 'wifi-not-associated' | 'not-lan-reachable' | 'denied' | 'transport', reason?: string}
   * >}
   */
  async attest() {
    // 1. WiFi check
    const wifi = await this.#probe.checkWifi();
    if (!wifi?.associated) {
      return { error: 'wifi-not-associated' };
    }

    // 2. LAN-reachability probe via SDK transport routing
    const probe = await this.#probe.probeHomeAgent(this.#homeWebid);
    if (!probe?.reachable || probe.transport !== 'lan') {
      return { error: 'not-lan-reachable', reason: `transport=${probe?.transport ?? 'unknown'}` };
    }

    // 3. Ask home agent for attestation
    let result;
    try {
      result = await this.#invokeHomeAgent({
        subject: this.#subjectWebid,
        signals: { wifiAssociated: true, lanReachable: true },
      });
    } catch (err) {
      return { error: 'transport', reason: err?.message ?? String(err) };
    }

    return result;
  }
}
