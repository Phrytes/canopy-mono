/**
 * PeerDiscovery — coordinates peer acquisition via multiple entry points.
 *
 * Entry points:
 *   discoverByQR(qrPayload)             — parse QR string/JSON → hello or A2A fetch
 *   discoverByUrl(httpsUrl)             — fetch A2A agent card (stub; needs Group H)
 *   discoverByIntroduction(card, from)  — upsert card + optionally hello
 *   discoverByGroupBootstrap(list, adm) — call discoverByIntroduction for each member
 *
 * Also manages the peer-list skill registration (gossip responder side) and
 * wires PingScheduler + GossipProtocol when started.
 */
import { DataPart } from '../Parts.js';
import { PingScheduler }  from './PingScheduler.js';
import { GossipProtocol } from './GossipProtocol.js';

export class PeerDiscovery {
  #agent;
  #peerGraph;
  #pingScheduler;
  #gossipProtocol;
  #opts;

  /**
   * @param {object} opts
   * @param {import('../Agent.js').Agent}              opts.agent
   * @param {import('./PeerGraph.js').PeerGraph}       opts.peerGraph
   * @param {number} [opts.pingIntervalMs=30000]
   * @param {number} [opts.gossipIntervalMs=60000]
   * @param {number} [opts.maxGossipPeers=8]          — cards per gossip round
   * @param {boolean} [opts.autoHello=true]           — hello on introduction
   */
  constructor(opts) {
    const {
      agent,
      peerGraph,
      pingIntervalMs   = 30_000,
      gossipIntervalMs = 60_000,
      maxGossipPeers   = 8,
      autoHello        = true,
    } = opts;

    this.#agent     = agent;
    this.#peerGraph = peerGraph;
    this.#opts      = { autoHello };

    this.#pingScheduler = new PingScheduler({
      agent,
      peerGraph,
      intervalMs: pingIntervalMs,
    });

    this.#gossipProtocol = new GossipProtocol({
      agent,
      peerGraph,
      discovery:        this,
      intervalMs:       gossipIntervalMs,
      maxPeersPerRound: maxGossipPeers,
    });
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Start ping + gossip loops and register the 'peer-list' skill.
   */
  async start() {
    this.#registerPeerListSkill();
    this.#pingScheduler.start();
    this.#gossipProtocol.start();
  }

  /** Stop all background activity. */
  async stop() {
    this.#pingScheduler.stop();
    this.#gossipProtocol.stop();
  }

  // ── Discovery entry points ────────────────────────────────────────────────

  /**
   * Parse a QR payload and discover the peer.
   * Supported formats:
   *   - JSON string with { pubKey, address, ... }  → discoverByIntroduction + hello
   *   - Plain address string                        → hello directly
   *   - JSON string with { url }                   → discoverByUrl (stub)
   *
   * @param {string|object} qrPayload
   */
  async discoverByQR(qrPayload) {
    let parsed = qrPayload;
    if (typeof qrPayload === 'string') {
      try   { parsed = JSON.parse(qrPayload); }
      catch { parsed = { address: qrPayload.trim() }; }
    }

    if (parsed.url) {
      return this.discoverByUrl(parsed.url);
    }

    if (parsed.pubKey || parsed.address) {
      const address = parsed.address ?? parsed.pubKey;
      const card = {
        // Use pubKey as primary key if present; otherwise fall back to address as url.
        ...(parsed.pubKey ? { pubKey: parsed.pubKey } : { url: address }),
        label:      parsed.label,
        type:       'native',
        transports: parsed.transports ?? (parsed.address ? { relay: { url: parsed.address } } : {}),
      };
      return this.discoverByIntroduction(card, null, { address });
    }

    throw new Error('Unrecognised QR payload format');
  }

  /**
   * Fetch an A2A agent card from an HTTPS URL.
   * STUB — requires Group H (A2ATransport).  Throws NotImplementedError for now.
   *
   * @param {string} httpsUrl
   */
  async discoverByUrl(httpsUrl) {
    throw Object.assign(
      new Error(`discoverByUrl: A2A card fetch not yet implemented (${httpsUrl})`),
      { code: 'NOT_IMPLEMENTED' },
    );
  }

  /**
   * Upsert a peer card into the graph and optionally initiate a hello handshake.
   *
   * @param {object} card                — PeerRecord shape
   * @param {string|null} introducerPubKey
   * @param {object} [opts]
   * @param {string} [opts.address]      — transport address to use for hello
   */
  async discoverByIntroduction(card, introducerPubKey, opts = {}) {
    if (!card || (!card.pubKey && !card.url)) return null;

    // Upsert into graph.
    const record = await this.#peerGraph.upsert({
      ...card,
      type: card.type ?? 'native',
    });

    // Register pubKey in security layer if we have it.
    if (card.pubKey && opts.address) {
      this.#agent.addPeer(opts.address, card.pubKey);
    }

    // Attempt hello if autoHello is on and we have an address.
    if (this.#opts.autoHello && card.pubKey) {
      const address = opts.address ?? card.pubKey;
      try {
        await this.#agent.hello(address, 5_000);
      } catch {
        // Hello failure is non-fatal — peer may be offline.
      }
    }

    return record;
  }

  /**
   * Discover multiple peers from a bootstrap member list (e.g. a group roster).
   *
   * @param {object[]} memberList    — array of PeerRecord cards
   * @param {string}   adminPubKey   — group admin who vouches for the list
   */
  async discoverByGroupBootstrap(memberList, adminPubKey) {
    const results = [];
    for (const card of memberList) {
      const record = await this.discoverByIntroduction(card, adminPubKey).catch(() => null);
      if (record) results.push(record);
    }
    return results;
  }

  // ── Getters (for testing / introspection) ─────────────────────────────────

  get peerGraph()      { return this.#peerGraph; }
  get pingScheduler()  { return this.#pingScheduler; }
  get gossipProtocol() { return this.#gossipProtocol; }

  // ── Private ────────────────────────────────────────────────────────────────

  #registerPeerListSkill() {
    // Avoid double-registration if start() is called multiple times.
    if (this.#agent.skills.get('peer-list')) return;

    this.#agent.register('peer-list', async ({ from }) => {
      // Return only peers with discoverable !== false.
      const peers = (await this.#peerGraph.all())
        .filter(p => p.discoverable !== false)
        .map(({ pubKey, url, type, label, skills, transports, discoverable }) =>
          ({ pubKey, url, type, label, skills, transports, discoverable }),
        );
      return [DataPart({ peers })];
    });
  }
}
