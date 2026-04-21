/**
 * RoutingStrategy — selects the best transport for a given peer + action.
 *
 * Transport priority (high → low):
 *   internal > local > mdns > rendezvous > relay > nkn > mqtt > ble
 *
 * Selection logic:
 *   1. If a PeerGraph record exists for the peer:
 *        - If type === 'a2a' → only 'a2a' transport
 *        - If type === 'native'|'hybrid' → pick by priority / latency / filter
 *   2. Check FallbackTable for measured latency; prefer fastest healthy transport.
 *   3. Apply transportFilter (config allowlist).
 *   4. Apply pattern filter (streaming, bulk, bidi).
 *
 * `transports` is a Map<name, Transport> supplied by the consumer.
 * For single-transport agents pass `{ [name]: transport }`.
 */
import { FallbackTable } from './FallbackTable.js';

/** Canonical priority order (index 0 = highest priority). */
export const TRANSPORT_PRIORITY = [
  'internal', 'local', 'mdns', 'rendezvous', 'relay', 'nkn', 'mqtt', 'ble', 'a2a',
];

export class RoutingStrategy {
  #transports;    // Map<name, Transport>
  #peerGraph;     // PeerGraph | null
  #fallback;      // FallbackTable
  #config;        // { transportFilter?: string[] }

  /**
   * @param {object} opts
   * @param {Map<string, object>|object} opts.transports  — name→Transport map (or plain object)
   * @param {object}  [opts.peerGraph]    — PeerGraph instance (optional)
   * @param {object}  [opts.fallbackTable]
   * @param {object}  [opts.config]       — { transportFilter?: string[] }
   */
  constructor({ transports = {}, peerGraph = null, fallbackTable = null, config = {} }) {
    this.#transports = transports instanceof Map
      ? transports
      : new Map(Object.entries(transports));
    this.#peerGraph = peerGraph;
    this.#fallback  = fallbackTable ?? new FallbackTable();
    this.#config    = config;
  }

  get fallbackTable() { return this.#fallback; }
  get peerGraph()     { return this.#peerGraph; }

  /**
   * Select the best transport instance for a given peer.
   *
   * @param {string} peerId
   * @param {object} [opts]
   * @param {string}   [opts.pattern]             — 'streaming' | 'bulk' | 'bidi'
   * @param {string[]} [opts.preferredTransports] — names to try first (in order)
   * @returns {{ name: string, transport: object }|null}
   */
  async selectTransport(peerId, opts = {}) {
    const { pattern, preferredTransports } = opts;
    const filter   = pattern ? { [pattern]: true } : {};

    // ── Lookup PeerGraph for type hint ───────────────────────────────────────
    let peerType = 'native';
    if (this.#peerGraph) {
      const record = await this.#peerGraph.get(peerId);
      if (record) peerType = record.type ?? 'native';
    }

    if (peerType === 'a2a') {
      const t = this.#transports.get('a2a');
      return t ? { name: 'a2a', transport: t } : null;
    }

    // ── Build candidate list ─────────────────────────────────────────────────
    const allowFilter = this.#config.transportFilter;
    const available   = [...this.#transports.keys()].filter(n => {
      if (n === 'a2a') return false;
      if (allowFilter && !allowFilter.includes(n)) return false;
      return true;
    });

    // Try FallbackTable first — if we have latency data for this peer.
    const ftBest = this.#fallback.getBest(peerId, filter, available);
    if (ftBest) {
      const t = this.#transports.get(ftBest);
      if (t) return { name: ftBest, transport: t };
    }

    // ── Preferred list ───────────────────────────────────────────────────────
    if (preferredTransports) {
      for (const name of preferredTransports) {
        if (available.includes(name) && !this.#fallback.isDegraded(peerId, name)) {
          const t = this.#transports.get(name);
          if (t) return { name, transport: t };
        }
      }
    }

    // ── Default priority order ────────────────────────────────────────────────
    const ordered = TRANSPORT_PRIORITY.filter(n => available.includes(n) && n !== 'a2a');
    for (const name of ordered) {
      if (this.#fallback.isDegraded(peerId, name)) continue;
      const t = this.#transports.get(name);
      if (t) return { name, transport: t };
    }

    // All degraded — return highest-priority anyway.
    for (const name of ordered) {
      const t = this.#transports.get(name);
      if (t) return { name, transport: t };
    }

    return null;
  }

  /**
   * Called when a transport fails for a peer.
   * Marks it degraded in FallbackTable for 30 seconds.
   *
   * @param {string} peerId
   * @param {string} transportName
   * @param {number} [durationMs=30000]
   */
  onTransportFailure(peerId, transportName, durationMs = 30_000) {
    this.#fallback.markDegraded(peerId, transportName, Date.now() + durationMs);
  }
}
