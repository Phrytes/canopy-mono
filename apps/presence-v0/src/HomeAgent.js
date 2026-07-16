/**
 * HomeAgent — issues presence attestations to a prover that proves
 * (a) WiFi-associated AND (b) LAN-reachable.
 *
 * Lives on the household's always-on machine (Mac mini, Raspberry Pi,
 * etc.).  Receives requests from prover agents via the SDK transport
 * layer; the LAN-reachability claim is implicit in the request having
 * arrived without going through the relay.
 *
 * Composition:
 *   - L1b ItemStore for the audit trail of issued attestations
 *
 * Transport routing (LAN vs relay distinction) is handled by the
 * caller — they supply the request via `requestAttestation()` along
 * with metadata describing how the request arrived.  This keeps the
 * V0 code unit-testable without spinning up real BLE/mDNS.
 */

import { ItemStore } from '@onderling/item-store';
import { MemorySource } from '@onderling/core';
import { ulid } from '@onderling/item-store';

const DEFAULT_TTL_MS = 5 * 60 * 1000;

export class HomeAgent {
  /** @type {string} */ #homeWebid;
  /** @type {string} */ #locationId;
  /** @type {ItemStore} */ #attestationLog;
  /** @type {number} */ #ttlMs;
  /** @type {() => number} */ #now;

  /**
   * @param {object} args
   * @param {string} args.homeWebid           webid of the home agent (issuer)
   * @param {string} args.locationId          household identifier (e.g. 'household-de-roos')
   * @param {ItemStore} [args.attestationLog]  optional shared item-store; auto-created if absent
   * @param {number} [args.ttlMs=DEFAULT_TTL_MS]
   * @param {() => number} [args.now]
   */
  constructor({ homeWebid, locationId, attestationLog, ttlMs, now } = {}) {
    if (!homeWebid)  throw new TypeError('HomeAgent: homeWebid required');
    if (!locationId) throw new TypeError('HomeAgent: locationId required');
    this.#homeWebid  = homeWebid;
    this.#locationId = locationId;
    this.#attestationLog = attestationLog ?? new ItemStore({ dataSource: new MemorySource(), rootContainer: 'mem://presence/' });
    this.#ttlMs = ttlMs ?? DEFAULT_TTL_MS;
    this.#now   = now ?? (() => Date.now());
  }

  /**
   * Issue a presence attestation.  Refuses if either signal is
   * missing — the V0 contract is "both signals required."
   *
   * @param {object} args
   * @param {string} args.subject               webid of the prover
   * @param {object} args.signals
   * @param {boolean} args.signals.wifiAssociated
   * @param {boolean} args.signals.lanReachable
   *   The prover already verified these on its side; the home agent
   *   re-checks lanReachable by inspecting how the request arrived
   *   (caller-supplied; substrate doesn't peek at transport routing
   *   internals — V0 design choice).
   * @returns {Promise<import('./types.js').AttestationToken | {error: 'denied', reason: string}>}
   */
  async requestAttestation({ subject, signals }) {
    if (!subject) {
      throw Object.assign(new Error('requestAttestation: subject required'), { code: 'BAD_REQUEST' });
    }
    if (!signals?.wifiAssociated) {
      return { error: 'denied', reason: 'wifi-not-associated' };
    }
    if (!signals?.lanReachable) {
      return { error: 'denied', reason: 'not-lan-reachable' };
    }

    const issuedAt = this.#now();
    const expiresAt = issuedAt + this.#ttlMs;
    const token = {
      id:       ulid(),
      subject,
      issuer:   this.#homeWebid,
      location: this.#locationId,
      issuedAt,
      expiresAt,
      signals: { wifi: 'associated', lan: 'direct' },
    };

    // Audit log entry — every issued attestation lands in the
    // item-store as a "presence-claim" item.  Allows after-the-fact
    // queries: "show me all presence attestations issued today."
    await this.#attestationLog.addItems(
      [{
        type: 'presence-claim',
        text: `${subject} present at ${this.#locationId}`,
        notes: JSON.stringify({ tokenId: token.id, expiresAt }),
        source: { presence: { tokenId: token.id, location: this.#locationId } },
      }],
      { actor: this.#homeWebid, actorDisplayName: 'home-agent' },
    );

    return token;
  }

  /**
   * Verify a previously-issued attestation token.  Returns
   * `{valid: true, token}` on success or `{valid: false, reason}` on
   * any failure (expired, unknown issuer, etc.).
   *
   * @param {object} token
   * @returns {{valid: boolean, reason?: string, token?: object}}
   */
  verify(token) {
    if (!token || typeof token !== 'object') {
      return { valid: false, reason: 'malformed' };
    }
    if (token.issuer !== this.#homeWebid) {
      return { valid: false, reason: 'unknown-issuer' };
    }
    if (token.location !== this.#locationId) {
      return { valid: false, reason: 'wrong-location' };
    }
    if (typeof token.expiresAt !== 'number' || token.expiresAt <= this.#now()) {
      return { valid: false, reason: 'expired' };
    }
    return { valid: true, token };
  }

  /**
   * Read the audit log.  Useful for "presence in the last N days"
   * queries.
   */
  async listAttestations(filter) {
    return this.#attestationLog.listClosed({ ...filter });
  }

  /**
   * Read currently-open (not-yet-archived) attestation log entries.
   * Items here are still "open" because we don't mark them complete
   * — they're a one-way audit trail.
   */
  async listOpen() {
    return this.#attestationLog.listOpen({ type: 'presence-claim' });
  }
}
